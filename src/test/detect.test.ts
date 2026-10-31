import assert from 'node:assert/strict';
import test from 'node:test';
import { isExecutableName, parseVersionOutput, profileName } from '../services/llama/detect';

test('解析 llama.cpp 的 --version 输出', () => {
  const info = parseVersionOutput(
    'version: 4615 (6d1c3e1)\nbuilt with MSVC 19.40.33813.0 for x64',
  );

  assert.equal(info.version, '4615');
  assert.equal(info.build, 'MSVC 19.40.33813.0 for x64');
  assert.ok(info.raw.includes('4615'));
});

test('只有版本行时，用括号里的哈希当构建号', () => {
  const info = parseVersionOutput('version: b4321 (abcdef0)');

  assert.equal(info.version, 'b4321');
  assert.equal(info.build, 'abcdef0');
});

test('认不出的输出不报错，raw 保留', () => {
  const info = parseVersionOutput('llama-cli: some unexpected banner');

  assert.equal(info.version, undefined);
  assert.ok(info.raw.includes('unexpected'));
});

test('识别常见可执行文件名', () => {
  assert.ok(isExecutableName('llama-cli.exe'));
  assert.ok(isExecutableName('llama-cli'));
  assert.ok(isExecutableName('llama-server.exe'));
  assert.ok(isExecutableName('main.exe'));
  assert.ok(!isExecutableName('llama-cli.lib'));
  assert.ok(!isExecutableName('llama-cli.cpp'));
  assert.ok(!isExecutableName('benchmark.exe'));
});

test('选项名字带上版本号', () => {
  assert.equal(profileName('C:\\llama\\bin\\llama-cli.exe', '4615'), 'llama-cli.exe (4615)');
  assert.equal(profileName('C:\\llama\\bin\\main.exe'), 'main.exe');
});

test('两种路径分隔符都认（跨平台）', () => {
  assert.equal(profileName('/opt/llama/llama-cli', '4615'), 'llama-cli (4615)');
  assert.ok(isExecutableName('C:\\llama\\bin\\llama-cli.exe'));
  assert.ok(isExecutableName('/opt/llama/bin/llama-server'));
  assert.ok(!isExecutableName('/opt/llama/llama-cli.so'));
});
