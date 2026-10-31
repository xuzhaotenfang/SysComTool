import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { ChildProcess } from 'node:child_process';
import { RunManager } from '../services/llama/runs';

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  kill(): boolean;
}

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4321;
  child.kill = () => true;
  return child;
}

function makeManager(maxConcurrent: number, children: FakeChild[]): RunManager {
  let sequence = 0;
  return new RunManager({
    maxConcurrent,
    idFactory: () => `run-${(sequence += 1)}`,
    terminate: () => undefined,
    now: () => 1000,
    spawn: () => {
      const child = makeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    },
  });
}

const spec = (label: string) => ({ label, execPath: 'llama-cli', args: ['-m', 'm.gguf'] });

test('超过并发上限的任务进入排队，有槽位自动启动', () => {
  const children: FakeChild[] = [];
  const manager = makeManager(2, children);

  manager.start(spec('a'));
  manager.start(spec('b'));
  manager.start(spec('c'));

  assert.deepEqual(
    manager.snapshots().map((run) => run.status),
    ['running', 'running', 'queued'],
  );
  assert.equal(children.length, 2);

  children[0].emit('close', 0);

  assert.deepEqual(
    manager.snapshots().map((run) => run.status),
    ['succeeded', 'running', 'running'],
  );
  assert.equal(children.length, 3);
  manager.dispose();
});

test('输出累积到快照并实时广播', () => {
  const children: FakeChild[] = [];
  const manager = makeManager(1, children);
  const chunks: string[] = [];
  manager.onOutput((_id, chunk) => chunks.push(chunk));

  manager.start(spec('a'));
  children[0].stdout.emit('data', Buffer.from('hello '));
  children[0].stderr.emit('data', Buffer.from('world'));

  assert.equal(manager.snapshots()[0].output, 'hello world');
  assert.deepEqual(chunks, ['hello ', 'world']);
  manager.dispose();
});

test('终止排队中的任务会标记为取消，不占用槽位', () => {
  const children: FakeChild[] = [];
  const manager = makeManager(1, children);

  manager.start(spec('a'));
  const second = manager.start(spec('b'));
  manager.cancel(second.id);

  assert.deepEqual(
    manager.snapshots().map((run) => run.status),
    ['running', 'cancelled'],
  );
  assert.equal(children.length, 1);
  manager.dispose();
});

test('非零退出码标记为失败并记录退出码', () => {
  const children: FakeChild[] = [];
  const manager = makeManager(1, children);

  manager.start(spec('a'));
  children[0].emit('close', 2);

  const [snapshot] = manager.snapshots();
  assert.equal(snapshot.status, 'failed');
  assert.equal(snapshot.exitCode, 2);
  manager.dispose();
});

test('启动异常不会抛到调用方', () => {
  const manager = new RunManager({
    maxConcurrent: 1,
    spawn: () => {
      throw new Error('找不到可执行文件');
    },
    terminate: () => undefined,
  });

  manager.start(spec('a'));

  const [snapshot] = manager.snapshots();
  assert.equal(snapshot.status, 'failed');
  assert.match(snapshot.output, /找不到可执行文件/);
  manager.dispose();
});

test('移除与清空只作用于已结束的任务', () => {
  const children: FakeChild[] = [];
  const manager = makeManager(2, children);

  const running = manager.start(spec('a'));
  manager.start(spec('b'));
  children[1].emit('close', 0);

  manager.remove(running.id);
  assert.equal(manager.snapshots().length, 2);

  manager.clearFinished();
  assert.deepEqual(
    manager.snapshots().map((run) => run.status),
    ['running'],
  );
  manager.dispose();
});

test('长输出的快照只保留尾部', () => {
  const children: FakeChild[] = [];
  const manager = new RunManager({
    maxConcurrent: 1,
    outputLimit: 4096,
    idFactory: () => 'run-x',
    terminate: () => undefined,
    spawn: () => {
      const child = makeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    },
  });

  manager.start(spec('a'));
  children[0].stdout.emit('data', Buffer.from('0'.repeat(5000)));
  children[0].stdout.emit('data', Buffer.from('TAIL'));

  const [snapshot] = manager.snapshots();
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.output.length, 4096);
  assert.ok(snapshot.output.endsWith('TAIL'));
  manager.dispose();
});
