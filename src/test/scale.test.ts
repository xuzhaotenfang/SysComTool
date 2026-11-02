import assert from 'node:assert/strict';
import test from 'node:test';
import { lttb, niceNumber, niceScale, sortByX } from '../services/chart/scale';

test('niceNumber 取整到 1/2/5 × 10^n', () => {
  assert.equal(niceNumber(1.2, true), 1);
  assert.equal(niceNumber(1.6, true), 2);
  assert.equal(niceNumber(3.2, true), 5);
  assert.equal(niceNumber(8, true), 10);
  assert.equal(niceNumber(0.023, true), 0.02);
});

test('刻度覆盖数据范围，且间距均匀', () => {
  const scale = niceScale(3, 97, 6);

  assert.ok(scale.min <= 3);
  assert.ok(scale.max >= 97);
  assert.ok(scale.ticks.length >= 3);

  const gaps = scale.ticks.slice(1).map((tick, index) => tick - scale.ticks[index]);
  for (const gap of gaps) {
    assert.ok(Math.abs(gap - gaps[0]) < 1e-9, `间距不一致: ${gaps.join(',')}`);
  }
});

test('所有值相等时给出一段区间', () => {
  const scale = niceScale(5, 5, 5);

  assert.ok(scale.min < 5);
  assert.ok(scale.max > 5);
  assert.ok(scale.ticks.length >= 2);
});

test('非法输入退回 0..1', () => {
  const scale = niceScale(Number.NaN, Number.POSITIVE_INFINITY);

  assert.deepEqual(scale, { min: 0, max: 1, ticks: [0, 1] });
});

test('LTTB 保留首尾并压到阈值以内', () => {
  const points = Array.from({ length: 1000 }, (_, index) => ({
    x: index,
    y: Math.sin(index / 20) * 100,
  }));

  const sampled = lttb(points, 100);

  assert.equal(sampled.length, 100);
  assert.deepEqual(sampled[0], points[0]);
  assert.deepEqual(sampled[sampled.length - 1], points[points.length - 1]);
});

test('点数不超阈值时原样返回', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];

  assert.deepEqual(lttb(points, 100), points);
});

test('sortByX 不修改原数组', () => {
  const points = [
    { x: 3, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ];

  const sorted = sortByX(points);

  assert.deepEqual(sorted.map((point) => point.x), [1, 2, 3]);
  assert.deepEqual(points.map((point) => point.x), [3, 1, 2]);
});
