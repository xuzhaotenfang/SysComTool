import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildArgs,
  DEFAULT_PARAMS,
  shellQuote,
  splitExtraArgs,
  toShellCommand,
  validateParams,
} from '../services/llama/command';

const target = {
  execPath: 'C:\\llama\\build\\bin\\llama-cli.exe',
  modelPath: 'C:\\models\\qwen.gguf',
};

test('默认参数只生成 -m', () => {
  assert.deepEqual(buildArgs(target, DEFAULT_PARAMS), ['-m', target.modelPath]);
});

test('输入为空（或只有空白）表示不传这个参数', () => {
  const args = buildArgs(target, { ...DEFAULT_PARAMS, nPredict: '  ', threads: '', gpuLayers: ' ' });
  assert.deepEqual(args, ['-m', target.modelPath]);
});

test('填了的参数按固定顺序追加', () => {
  const args = buildArgs(target, {
    ...DEFAULT_PARAMS,
    nPredict: '64',
    ctxSize: '2048',
    threads: '8',
    gpuLayers: '99',
    temperature: '0.7',
  });

  assert.deepEqual(args, [
    '-m',
    target.modelPath,
    '-n',
    '64',
    '-c',
    '2048',
    '-t',
    '8',
    '-ngl',
    '99',
    '--temp',
    '0.7',
  ]);
});

test('提示词原样传入，不 trim 内容', () => {
  const prompt = '第一行\n第二行 末尾有空格 ';
  const args = buildArgs(target, { ...DEFAULT_PARAMS, prompt });
  assert.deepEqual(args.slice(2), ['-p', prompt]);
});

test('额外参数支持单双引号', () => {
  assert.deepEqual(splitExtraArgs('--foo "a b" \'c d\' --n 1'), ['--foo', 'a b', 'c d', '--n', '1']);
  assert.deepEqual(splitExtraArgs('   '), []);
  assert.deepEqual(splitExtraArgs('--empty ""'), ['--empty', '']);
});

test('非数字参数会被指出来', () => {
  const problems = validateParams(target, { ...DEFAULT_PARAMS, threads: 'abc' });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /线程数/);
});

test('缺少可执行文件或模型时逐条报告', () => {
  const problems = validateParams({}, DEFAULT_PARAMS);

  assert.equal(problems.length, 2);
  assert.match(problems.join(), /可执行文件/);
  assert.match(problems.join(), /模型/);
});

test('shellQuote 只在需要时加引号', () => {
  assert.equal(shellQuote('plain'), 'plain');
  assert.equal(shellQuote('C:\\models\\a.gguf'), 'C:\\models\\a.gguf');
  assert.equal(shellQuote('a b'), "'a b'");
  assert.equal(shellQuote("it's"), "'it''s'");
  assert.equal(shellQuote(''), "''");
});

test('toShellCommand 把换行压成空格，避免终端里断行', () => {
  const command = toShellCommand('C:\\llama\\llama-cli.exe', ['-m', target.modelPath, '-p', 'a\nb']);

  assert.ok(command.includes("'a b'"));
  assert.ok(!command.includes('\n'));
  assert.ok(command.startsWith('C:\\llama\\llama-cli.exe'));
});
