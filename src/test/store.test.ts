import assert from 'node:assert/strict';
import test from 'node:test';
import type * as vscode from 'vscode';
import { Store } from '../services/store';

class FakeMemento {
  private readonly data = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.data.has(key) ? this.data.get(key) : defaultValue) as T | undefined;
  }

  update(key: string, value: unknown): Promise<void> {
    this.data.set(key, structuredClone(value));
    return Promise.resolve();
  }

  keys(): readonly string[] {
    return [...this.data.keys()];
  }

  setKeysForSync(): void {
    // 测试用，不需要同步
  }
}

function makeStore(): Store {
  return new Store(new FakeMemento() as unknown as vscode.Memento);
}

const profileInput = (name: string, execPath: string) => ({
  name,
  execPath,
  dirPath: execPath.replace(/[\\/][^\\/]+$/, ''),
});

test('同一路径重复保存只留一条，id 不变', async () => {
  const store = makeStore();

  const first = await store.saveLlamaProfile(profileInput('llama-cli', 'C:\\llama\\bin\\llama-cli.exe'));
  const second = await store.saveLlamaProfile({
    ...profileInput('llama-cli (4615)', 'c:\\LLAMA\\bin\\llama-cli.exe'),
    version: '4615',
  });

  const state = store.state();
  assert.equal(state.llamaProfiles.length, 1);
  assert.equal(second.id, first.id);
  assert.equal(second.version, '4615');
  assert.equal(state.activeProfileId, first.id);
});

test('删除后 active 回落到剩下的一个', async () => {
  const store = makeStore();
  const a = await store.saveLlamaProfile(profileInput('a', 'C:\\a\\llama-cli.exe'));
  const b = await store.saveLlamaProfile(profileInput('b', 'C:\\b\\llama-cli.exe'));

  await store.removeLlamaProfile(b.id);

  assert.deepEqual(store.state().llamaProfiles.map((item) => item.id), [a.id]);
  assert.equal(store.state().activeProfileId, a.id);
});

test('最近模型去重、最新在前、最多 8 条', async () => {
  const store = makeStore();

  await store.addRecentModel('C:\\m\\a.gguf');
  await store.addRecentModel('C:\\m\\b.gguf');
  await store.addRecentModel('c:\\m\\A.GGUF');

  const first = store.state().recentModels;
  assert.deepEqual(first, ['c:\\m\\A.GGUF', 'C:\\m\\b.gguf']);

  for (let index = 0; index < 10; index += 1) {
    await store.addRecentModel(`C:\\m\\m${index}.gguf`);
  }
  assert.equal(store.state().recentModels.length, 8);
  assert.equal(store.state().recentModels[0], 'C:\\m\\m9.gguf');
});

test('并发写入不会互相覆盖', async () => {
  const store = makeStore();

  await Promise.all([
    store.saveLlamaProfile(profileInput('a', 'C:\\a\\llama-cli.exe')),
    store.saveLlamaProfile(profileInput('b', 'C:\\b\\llama-cli.exe')),
    store.addRecentModel('C:\\m\\a.gguf'),
  ]);

  const state = store.state();
  assert.equal(state.llamaProfiles.length, 2);
  assert.deepEqual(state.recentModels, ['C:\\m\\a.gguf']);
});

test('记录更新检查时间', async () => {
  const store = makeStore();

  await store.markUpdateCheck('0.3.0');

  const state = store.state();
  assert.equal(state.lastNotifiedVersion, '0.3.0');
  assert.ok((state.lastUpdateCheckAt ?? 0) > 0);
});
