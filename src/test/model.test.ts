import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChartModel, type ChartOptions, CHART_HEIGHT, CHART_WIDTH } from '../services/chart/model';
import { parseTabularData, type Dataset } from '../services/chart/parse';

function datasetOf(text: string): Dataset {
  const result = parseTabularData(text);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.dataset;
}

const baseOptions: ChartOptions = {
  xIndex: 0,
  yIndex: 1,
  type: 'line',
  sortByX: true,
  maxPoints: 3000,
};

function modelOf(dataset: Dataset, overrides: Partial<ChartOptions> = {}) {
  const result = buildChartModel(dataset, { ...baseOptions, ...overrides });
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.model;
}

test('数值 X：点位落在绘图区内，刻度有值', () => {
  const dataset = datasetOf('x,y\n1,10\n2,20\n3,15');
  const model = modelOf(dataset);

  assert.equal(model.type, 'line');
  assert.equal(model.x.kind, 'number');
  assert.equal(model.meta.used, 3);
  assert.equal(model.meta.dropped, 0);
  assert.equal(model.series.length, 1);
  assert.ok(model.x.ticks.length >= 2);
  assert.ok(model.y.ticks.length >= 2);

  for (const point of model.series[0].points ?? []) {
    assert.ok(point.x >= model.plot.left - 0.01 && point.x <= model.plot.right + 0.01);
    assert.ok(point.y >= model.plot.top - 0.01 && point.y <= model.plot.bottom + 0.01);
  }
});

test('Y 越大越靠上（像素 y 越小）', () => {
  const dataset = datasetOf('x,y\n1,10\n2,20');
  const model = modelOf(dataset);
  const [first, second] = model.series[0].points ?? [];

  assert.ok(second.y < first.y);
});

test('按 X 排序：乱序输入也能连成正确顺序', () => {
  const dataset = datasetOf('x,y\n3,30\n1,10\n2,20');
  const model = modelOf(dataset, { sortByX: true });

  assert.deepEqual(
    (model.series[0].points ?? []).map((point) => point.vx),
    ['1', '2', '3'],
  );
});

test('不排序时保留数据行顺序', () => {
  const dataset = datasetOf('x,y\n3,30\n1,10\n2,20');
  const model = modelOf(dataset, { sortByX: false });

  assert.deepEqual(
    (model.series[0].points ?? []).map((point) => point.vx),
    ['3', '1', '2'],
  );
});

test('分类 X 的柱状图：每个分类一根柱子', () => {
  const dataset = datasetOf('model,tok/s\na,12\nb,20\nc,8');
  const model = modelOf(dataset, { xIndex: 0, yIndex: 1, type: 'bar' });

  assert.equal(model.x.kind, 'category');
  assert.equal(model.series[0].bars?.length, 3);
  assert.deepEqual(
    model.x.ticks.map((tick) => tick.value),
    ['a', 'b', 'c'],
  );
  for (const bar of model.series[0].bars ?? []) {
    assert.ok(Math.abs(bar.height - (model.plot.bottom - bar.y)) < 0.02);
  }
});

test('面积图有闭合路径，柱状图不生成折线路径', () => {
  const dataset = datasetOf('x,y\n1,10\n2,20\n3,15');

  const area = modelOf(dataset, { type: 'area' });
  assert.ok(area.series[0].area?.endsWith('Z'));

  const bar = modelOf(dataset, { type: 'bar' });
  assert.equal(bar.series[0].path, undefined);
});

test('平滑曲线在 x 单调时用三次贝塞尔', () => {
  const dataset = datasetOf('x,y\n1,10\n2,25\n3,15\n4,30');
  const model = modelOf(dataset, { type: 'smooth' });

  assert.ok(model.series[0].path?.includes('C'));
});

test('x 不单调时平滑退回折线，并说明原因', () => {
  const dataset = datasetOf('x,y\n3,10\n1,25\n2,15');
  const model = modelOf(dataset, { type: 'smooth', sortByX: false });

  assert.ok(model.series[0].path?.includes('L'));
  assert.ok(!model.series[0].path?.includes('C'));
  assert.match(model.meta.note ?? '', /退回折线/);
});

test('x 有重复值时平滑退回折线并说明原因', () => {
  const dataset = datasetOf('x,y\n1,10\n1,20\n2,15\n3,30');
  const model = modelOf(dataset, { type: 'smooth', sortByX: true });

  assert.ok(model.series[0].path?.includes('L'));
  assert.match(model.meta.note ?? '', /重复或乱序/);
});

test('超过上限时 LTTB 降采样并给出说明', () => {
  const rows = ['x,y'];
  for (let index = 0; index < 500; index += 1) {
    rows.push(`${index},${Math.sin(index / 10) * 50}`);
  }
  const dataset = datasetOf(rows.join('\n'));

  const model = modelOf(dataset, { maxPoints: 80 });

  assert.equal(model.meta.used, 80);
  assert.equal(model.meta.downsampled, 500);
  assert.match(model.meta.note ?? '', /降采样/);
});

test('空值行被跳过并计数', () => {
  const dataset = datasetOf('x,y\n1,10\n2,\n,5\n3,30');

  const model = modelOf(dataset);

  assert.equal(model.meta.used, 2);
  assert.equal(model.meta.dropped, 2);
  assert.match(model.meta.note ?? '', /跳过 2 行/);
});

test('按一列分组：拆成多条序列，颜色不同', () => {
  const dataset = datasetOf(
    'model,ngl,test,t/s\na,0,pp512,10\na,10,pp512,20\na,0,tg128,5\na,10,tg128,8',
  );

  const model = modelOf(dataset, { xIndex: 1, yIndex: 3, groupIndex: 2 });

  assert.equal(model.series.length, 2);
  assert.deepEqual(
    model.series.map((line) => line.name),
    ['pp512', 'tg128'],
  );
  assert.notEqual(model.series[0].color, model.series[1].color);
  assert.equal(model.series[0].points?.length, 2);
  assert.equal(model.series[1].points?.length, 2);
  assert.equal(model.meta.groups, 2);
  assert.match(model.meta.note ?? '', /2 条序列/);
});

test('分组柱状图：同组内柱子并排不重叠', () => {
  const dataset = datasetOf('cat,g,v\na,x,1\na,y,2\nb,x,3\nb,y,4');

  const model = modelOf(dataset, { xIndex: 0, yIndex: 2, groupIndex: 1, type: 'bar' });
  const bars = model.series.flatMap((line) => line.bars ?? []);

  assert.equal(bars.length, 4);
  const sameCategory = bars.filter((bar) => bar.vx === 'a');
  assert.equal(sameCategory.length, 2);
  assert.notEqual(sameCategory[0].x, sameCategory[1].x);
});

test('分组后每条的图例与名称都带分组值', () => {
  const dataset = datasetOf('x,g,y\n1,a,10\n2,a,20\n1,b,30\n2,b,40');

  const model = modelOf(dataset, { xIndex: 0, yIndex: 2, groupIndex: 1 });

  assert.deepEqual(model.legend.map((item) => item.name), ['a', 'b']);
  assert.deepEqual(
    model.series[0].points?.map((point) => point.series),
    ['a', 'a'],
  );
});

test('Y 选了非数值列直接报错', () => {
  const dataset = datasetOf('model,tok/s\na,12\nb,20');

  const result = buildChartModel(dataset, { ...baseOptions, xIndex: 1, yIndex: 0 });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /数值/);
  }
});

test('列索引越界报错', () => {
  const dataset = datasetOf('x,y\n1,2');

  const result = buildChartModel(dataset, { ...baseOptions, xIndex: 9 });

  assert.equal(result.ok, false);
});

test('模型尺寸固定，便于导出 SVG', () => {
  const model = modelOf(datasetOf('x,y\n1,2'));

  assert.equal(model.width, CHART_WIDTH);
  assert.equal(model.height, CHART_HEIGHT);
  assert.ok(model.plot.right > model.plot.left);
  assert.ok(model.plot.bottom > model.plot.top);
});
