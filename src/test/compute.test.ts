import assert from 'node:assert/strict';
import test from 'node:test';
import type { Dataset } from '../services/chart/parse';
import {
  computeFormulas,
  formatValue,
  resultToDataset,
  type Binding,
} from '../services/formula/compute';

function dataset(): Dataset {
  return {
    columns: [
      { name: 'x', kind: 'number' },
      { name: 'y', kind: 'number' },
    ],
    rows: [
      ['1', '10'],
      ['2', '20'],
      ['3', ''],
      ['abc', '40'],
    ],
    delimiter: ',',
    format: 'csv',
    warnings: [],
  };
}

const column = (index: number): Binding => ({ kind: 'column', index });
const constant = (value: number): Binding => ({ kind: 'constant', value });

test('按列与常量逐行计算', () => {
  const result = computeFormulas(
    dataset(),
    [{ name: 'z', expression: 'a * x + b' }],
    { x: column(0), a: constant(2), b: constant(1) },
  );

  assert.deepEqual(result.columns.map((item) => item.name), ['x', 'y', 'z']);
  assert.equal(result.rows[0][2], '3');
  assert.equal(result.rows[1][2], '5');
  assert.equal(result.rows[2][2], '7');
  assert.equal(result.rows[3][2], '');
  assert.equal(result.okRows, 3);
  assert.equal(result.totalRows, 4);
});

test('该行不是数字时记错并留空', () => {
  const result = computeFormulas(
    dataset(),
    [{ name: 'z', expression: 'y * 2' }],
    { y: column(1) },
  );

  assert.equal(result.rows[2][2], '');
  assert.equal(result.rows[3][2], '80');
  assert.equal(result.errorRows, 1);
  assert.equal(result.errors[0].row, 3);
  assert.match(result.errors[0].message, /不是数字/);
});

test('公式本身出错时只影响该行', () => {
  const result = computeFormulas(
    dataset(),
    [{ name: 'z', expression: 'sqrt(x - 10)' }],
    { x: column(0) },
  );

  // 1-10、2-10、3-10 都是负数 → NaN；只有 abc 那行是绑定错误
  assert.equal(result.errorRows, 4);
  assert.equal(result.rows[0][2], '');
});

test('多条公式各自成列', () => {
  const result = computeFormulas(
    dataset(),
    [
      { name: 'sum', expression: 'x + y' },
      { name: 'ratio', expression: 'y / x' },
    ],
    { x: column(0), y: column(1) },
  );

  assert.deepEqual(result.columns.map((item) => item.name), ['x', 'y', 'sum', 'ratio']);
  assert.equal(result.rows[0][2], '11');
  assert.equal(result.rows[0][3], '10');
});

test('未绑定的变量会报「没有绑定」', () => {
  const result = computeFormulas(dataset(), [{ name: 'z', expression: 'q + 1' }], {});

  assert.equal(result.okRows, 0);
  assert.match(result.errors[0].message, /没有绑定/);
});

test('formatValue 不产生浮点噪声', () => {
  assert.equal(formatValue(0.1 + 0.2), '0.3');
  assert.equal(formatValue(3), '3');
  assert.equal(formatValue(1 / 3), '0.33333333');
});

test('结果可以转回 Dataset 供出图', () => {
  const result = computeFormulas(dataset(), [{ name: 'z', expression: 'x * 2' }], { x: column(0) });
  const converted = resultToDataset(result);

  assert.deepEqual(converted.columns.map((item) => item.name), ['x', 'y', 'z']);
  assert.equal(converted.rows.length, 4);
  assert.equal(converted.rows[0][2], '2');
});

test('后面的公式可以引用前面的结果', () => {
  const result = computeFormulas(
    dataset(),
    [
      { name: 'y', expression: 'x * 2' },
      { name: 'z', expression: 'y + 1' },
    ],
    { x: column(0) },
  );

  assert.equal(result.rows[0][2], '2');
  assert.equal(result.rows[0][3], '3');
  assert.equal(result.rows[1][3], '5');
  assert.equal(result.okRows, 3);
});