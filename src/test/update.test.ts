import assert from 'node:assert/strict';
import test from 'node:test';
import { compareVersions, normalizeVersion, parseRelease, pickVsixAsset } from '../services/update/check';

const release = {
  tag_name: 'v0.3.0',
  html_url: 'https://github.com/xuzhaotenfang/SysComTool/releases/tag/v0.3.0',
  body: '更新说明',
  assets: [
    { name: 'syscomtool-0.3.0.vsix', browser_download_url: 'https://example.com/a.vsix', size: 1024 },
    { name: 'syscomtool-0.3.0.vsix.sha256', browser_download_url: 'https://example.com/a.sha256' },
  ],
};

test('normalizeVersion 去掉前缀', () => {
  assert.equal(normalizeVersion('v1.2.3'), '1.2.3');
  assert.equal(normalizeVersion('1.2'), '1.2');
  assert.equal(normalizeVersion('v0.3.0-beta.1'), '0.3.0');
});

test('compareVersions 补齐位数后逐段比较', () => {
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('v0.2.0', '0.2'), 0);
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(compareVersions('0.1', '0.1.0'), 0);
});

test('解析 release payload', () => {
  const parsed = parseRelease(release);

  assert.ok(parsed);
  assert.equal(parsed.version, '0.3.0');
  assert.equal(parsed.url, release.html_url);
  assert.equal(parsed.assets.length, 2);
});

test('不完整的 payload 返回 undefined', () => {
  assert.equal(parseRelease(null), undefined);
  assert.equal(parseRelease({}), undefined);
  assert.equal(parseRelease({ tag_name: 42 }), undefined);
});

test('只挑 .vsix，跳过校验文件', () => {
  const parsed = parseRelease(release);
  assert.ok(parsed);

  const asset = pickVsixAsset(parsed);
  assert.equal(asset?.name, 'syscomtool-0.3.0.vsix');
});

test('多个平台包时优先当前平台', () => {
  const parsed = parseRelease({
    tag_name: 'v1.0.0',
    assets: [
      { name: 'syscomtool-1.0.0-linux-x64.vsix', browser_download_url: 'https://example.com/linux.vsix' },
      { name: 'syscomtool-1.0.0-win32-x64.vsix', browser_download_url: 'https://example.com/win.vsix' },
    ],
  });
  assert.ok(parsed);

  assert.equal(pickVsixAsset(parsed, 'win32-x64')?.name, 'syscomtool-1.0.0-win32-x64.vsix');
  assert.equal(pickVsixAsset(parsed, 'linux-x64')?.name, 'syscomtool-1.0.0-linux-x64.vsix');
});

test('没有 vsix 资产时返回 undefined', () => {
  const parsed = parseRelease({ tag_name: 'v1.0.0', assets: [{ name: 'a.zip', browser_download_url: 'https://x/y.zip' }] });
  assert.ok(parsed);

  assert.equal(pickVsixAsset(parsed), undefined);
});
