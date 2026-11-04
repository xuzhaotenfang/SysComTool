import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChartOptions } from '../services/chart/model';
import { parseTabularData, type Dataset } from '../services/chart/parse';
import { buildChartSpec } from '../services/chart/spec';

function datasetOf(text: string): Dataset {
  const result = parseTabularData(text);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.dataset;
}

const base: ChartOptions = {
  xIndex: 0,
  yIndex: 1,
  type: 'line',
  sortByX: true,
  maxPoints: 3000,
};

function specOf(dataset: Dataset, overrides: Partial<ChartOptions> = {}) {
  const result = buildChartSpec(dataset, { ...base, ...overrides });
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.spec;
}

test('数值轴：保留数值 x 与原始文本', () => {
  const dataset = datasetOf('x,y\n3,30\n1,10\n2,20');
  const spec = specOf(dataset);

  assert.equal(spec.xKind, 'number');
  assert.equal(spec.xLabel, 'x');
  assert.equal(spec.yLabel, 'y');
  assert.deepEqual(
    spec.series[0].points.map((point) => point.x),
    [1, 2, 3],
  );
  assert.deepEqual(
    spec.series[0].points.map((point) => point.xLabel),
    ['1', '2', '3'],
  );
});

test('不排序时保留数据行顺序', () => {
  const dataset = datasetOf('x,y\n3,30\n1,10\n2,20');
  const spec = specOf(dataset, { sortByX: false });

  assert.deepEqual(
    spec.series[0].points.map((point) => point.x),
    [3, 1, 2],
  );
});

test('分类轴：categories 按首次出现顺序', () => {
  const dataset = datasetOf('model,tok/s\nb,2\na,1\nb,3');
  const spec = specOf(dataset, { xIndex: 0, yIndex: 1 });

  assert.equal(spec.xKind, 'category');
  assert.deepEqual(spec.categories, ['b', 'a']);
  assert.deepEqual(
    spec.series[0].points.map((point) => point.x),
    ['b', 'a', 'b'],
  );
});

test('分组：拆成多条序列，名字取分组值', () => {
  const dataset = datasetOf('x,g,y\n1,a,10\n1,b,20\n2,a,30\n2,b,40');
  const spec = specOf(dataset, { xIndex: 0, yIndex: 2, groupIndex: 1 });

  assert.deepEqual(
    spec.series.map((line) => line.name),
    ['a', 'b'],
  );
  assert.equal(spec.series[0].points.length, 2);
  assert.equal(spec.meta.groups, 2);
});

test('「均值 ± 标准差」取均值，原始文本保留', () => {
  const dataset = datasetOf('x,y\n1,381.06 ± 92.53\n2,7.84 ± 0.14');
  const spec = specOf(dataset);

  assert.equal(spec.series[0].points[0].y, 381.06);
  assert.equal(spec.series[0].points[0].yLabel, '381.06 ± 92.53');
});

test('空值行被跳过并计数', () => {
  const dataset = datasetOf('x,y\n1,10\n2,\n,5\n3,30');
  const spec = specOf(dataset);

  assert.equal(spec.meta.used, 2);
  assert.equal(spec.meta.dropped, 2);
  assert.equal(spec.meta.rows, 4);
});

test('Y 非数值列报错', () => {
  const dataset = datasetOf('model,tok/s\na,12');
  const result = buildChartSpec(dataset, { ...base, xIndex: 1, yIndex: 0 });

  assert.equal(result.ok, false);
});

test('不认识的图型报错', () => {
  const dataset = datasetOf('x,y\n1,2');
  const result = buildChartSpec(dataset, { ...base, type: 'pie' as never });

  assert.equal(result.ok, false);
});
