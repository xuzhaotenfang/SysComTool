import assert from 'node:assert/strict';
import test from 'node:test';
import { FeatureHost, describeError } from '../core/host';
import type { Feature, FeatureContext, HostApi, Logger } from '../core/types';

function makeContext(): { ctx: FeatureContext; logs: string[] } {
  const logs: string[] = [];
  const logger: Logger = {
    info: (message) => logs.push(`info:${message}`),
    warn: (message) => logs.push(`warn:${message}`),
    error: (message) => logs.push(`error:${message}`),
    debug: (message) => logs.push(`debug:${message}`),
    show: () => undefined,
  };
  const ctx: FeatureContext = {
    logger,
    extensionVersion: '0.1.0-test',
    getConfig: <T,>(_key: string, fallback: T): T => fallback,
  };
  return { ctx, logs };
}

function makeApi(): {
  api: HostApi;
  handlers: Map<string, (...args: unknown[]) => unknown>;
  errors: string[];
} {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const errors: string[] = [];
  const api: HostApi = {
    registerCommand: (id, handler) => {
      handlers.set(id, handler);
      return { dispose: () => void handlers.delete(id) };
    },
    notifyError: (message) => errors.push(message),
  };
  return { api, handlers, errors };
}

function feature(id: string, run: Feature['run'], title = '演示'): Feature {
  return { id, title, run };
}

test('注册全部合法功能', () => {
  const { ctx } = makeContext();
  const { api, handlers } = makeApi();
  const host = new FeatureHost(api, ctx);

  const report = host.registerAll([feature('syscomtool.a', () => undefined), feature('syscomtool.b', () => undefined)]);

  assert.deepEqual(report.registered, ['syscomtool.a', 'syscomtool.b']);
  assert.deepEqual(report.failed, []);
  assert.deepEqual([...handlers.keys()], ['syscomtool.a', 'syscomtool.b']);
});

test('执行命令会调用对应功能并记日志', async () => {
  const { ctx, logs } = makeContext();
  const { api, handlers } = makeApi();
  const host = new FeatureHost(api, ctx);
  let calls = 0;

  host.registerAll([feature('syscomtool.a', () => void (calls += 1), '甲')]);
  await handlers.get('syscomtool.a')!();

  assert.equal(calls, 1);
  assert.ok(logs.some((line) => line.includes('运行功能：甲')));
});

test('非法 id 记为失败且不注册', () => {
  const { ctx } = makeContext();
  const { api, handlers } = makeApi();
  const host = new FeatureHost(api, ctx);

  const report = host.registerAll([feature('Bad Id', () => undefined)]);

  assert.deepEqual(report.registered, []);
  assert.equal(report.failed.length, 1);
  assert.match(report.failed[0].reason, /不合法/);
  assert.equal(handlers.size, 0);
});

test('重复 id 只注册第一个', () => {
  const { ctx } = makeContext();
  const { api } = makeApi();
  const host = new FeatureHost(api, ctx);

  const report = host.registerAll([feature('syscomtool.dup', () => undefined), feature('syscomtool.dup', () => undefined)]);

  assert.deepEqual(report.registered, ['syscomtool.dup']);
  assert.equal(report.failed.length, 1);
  assert.match(report.failed[0].reason, /重复/);
});

test('缺少 title 记为失败', () => {
  const { ctx } = makeContext();
  const { api } = makeApi();
  const host = new FeatureHost(api, ctx);

  const report = host.registerAll([{ id: 'syscomtool.x', title: '  ', run: () => undefined }]);

  assert.equal(report.failed.length, 1);
  assert.match(report.failed[0].reason, /title/);
});

test('功能抛错不会冒泡，转成日志与提示', async () => {
  const { ctx, logs } = makeContext();
  const { api, handlers, errors } = makeApi();
  const host = new FeatureHost(api, ctx);

  host.registerAll([
    feature('syscomtool.boom', () => {
      throw new Error('炸了');
    }, '爆炸'),
  ]);

  await assert.doesNotReject(async () => handlers.get('syscomtool.boom')!());

  assert.ok(logs.some((line) => line.startsWith('error:') && line.includes('炸了')));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /爆炸.*炸了/);
});

test('异步功能的拒绝也会被捕获', async () => {
  const { ctx } = makeContext();
  const { api, handlers, errors } = makeApi();
  const host = new FeatureHost(api, ctx);

  host.registerAll([feature('syscomtool.async', async () => Promise.reject(new Error('异步炸')), '异步')]);
  await handlers.get('syscomtool.async')!();

  assert.equal(errors.length, 1);
  assert.match(errors[0], /异步炸/);
});

test('dispose 之后命令被注销', () => {
  const { ctx } = makeContext();
  const { api, handlers } = makeApi();
  const host = new FeatureHost(api, ctx);

  host.registerAll([feature('syscomtool.a', () => undefined)]);
  host.dispose();

  assert.equal(handlers.size, 0);
});

test('describeError 兼容非 Error 值', () => {
  assert.equal(describeError(new Error('x')), 'x');
  assert.equal(describeError('字符串'), '字符串');
  assert.equal(describeError(42), '42');
});
