import assert from 'node:assert/strict';
import test from 'node:test';
import { pythonCandidates } from '../services/chart/python';
import { RENDER_SCRIPT } from '../services/chart/renderScript';

test('默认按 python → py -3 → python3 顺序探测', () => {
  const candidates = pythonCandidates('');

  assert.deepEqual(
    candidates.map((candidate) => `${candidate.command} ${candidate.args.join(' ')}`.trim()),
    ['python', 'py -3', 'python3'],
  );
});

test('设置里指定的 Python 排在第一位', () => {
  const candidates = pythonCandidates('D:\\Python311\\python.exe');

  assert.equal(candidates[0].command, 'D:\\Python311\\python.exe');
  assert.equal(candidates.length, 4);
});

test('空白配置不会变成候选', () => {
  const candidates = pythonCandidates('   ');

  assert.equal(candidates[0].command, 'python');
  assert.equal(candidates.length, 3);
});

test('渲染脚本包含关键步骤', () => {
  assert.ok(RENDER_SCRIPT.includes('import matplotlib'));
  assert.ok(RENDER_SCRIPT.includes('matplotlib.use("Agg")'));
  assert.ok(RENDER_SCRIPT.includes('savefig(out_path'));
  assert.ok(RENDER_SCRIPT.includes('json.load'));
  assert.ok(RENDER_SCRIPT.includes('monotone_curve'));
});

test('渲染脚本不依赖任何模板插值（避免注入）', () => {
  assert.ok(!RENDER_SCRIPT.includes('${'));
  assert.ok(!RENDER_SCRIPT.includes('__SPEC__'));
});

test('中文字体回退列表里包含常见字体', () => {
  for (const font of ['Microsoft YaHei', 'SimHei', 'Noto Sans CJK SC']) {
    assert.ok(RENDER_SCRIPT.includes(font), font);
  }
});
