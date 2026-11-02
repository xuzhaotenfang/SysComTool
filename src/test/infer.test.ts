import assert from 'node:assert/strict';
import test from 'node:test';
import { countDistinct, inferDefaults } from '../services/chart/infer';
import { parseTabularData, type Dataset } from '../services/chart/parse';

function datasetOf(text: string): Dataset {
  const result = parseTabularData(text);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.dataset;
}

const LLAMA_BENCH = `| model | size | params | backend | ngl | test | t/s |
| --- | ---: | ---: | --- | --: | --- | ---: |
| qwen2 14B Q4_K - Medium | 8.37 GiB | 14.77 B | CUDA | 0 | pp512 | 381.06 ± 92.53 |
| qwen2 14B Q4_K - Medium | 8.37 GiB | 14.77 B | CUDA | 0 | tg128 | 7.84 ± 0.14 |
| qwen2 14B Q4_K - Medium | 8.37 GiB | 14.77 B | CUDA | 10 | pp512 | 489.91 ± 41.43 |
| qwen2 14B Q4_K - Medium | 8.37 GiB | 14.77 B | CUDA | 10 | tg128 | 9.72 ± 0.02 |`;

test('llama-bench 表格：X=ngl、Y=t/s、分组=test', () => {
  const dataset = datasetOf(LLAMA_BENCH);

  const defaults = inferDefaults(dataset);

  assert.deepEqual(defaults, { xIndex: 4, yIndex: 6, groupIndex: 5 });
  assert.equal(dataset.columns[defaults.xIndex].name, 'ngl');
  assert.equal(dataset.columns[defaults.yIndex].name, 't/s');
  assert.equal(dataset.columns[defaults.groupIndex ?? -1].name, 'test');
});

test('CSV：X 取在变的数值列，分组取在变的文本列', () => {
  const dataset = datasetOf(
    'model,threads,tok/s\na,8,10\na,16,20\nb,8,11\nb,16,21\nc,8,12\nc,16,22',
  );

  const defaults = inferDefaults(dataset);

  assert.equal(dataset.columns[defaults.xIndex].name, 'threads');
  assert.equal(dataset.columns[defaults.yIndex].name, 'tok/s');
  assert.equal(dataset.columns[defaults.groupIndex ?? -1].name, 'model');
});

test('只有一列数值时 X 和 Y 都用它', () => {
  const dataset = datasetOf('y\n1\n2\n3');

  const defaults = inferDefaults(dataset);

  assert.equal(defaults.xIndex, 0);
  assert.equal(defaults.yIndex, 0);
  assert.equal(defaults.groupIndex, null);
});

test('全表同值的列不会被选成 X', () => {
  const dataset = datasetOf('size,ngl,t/s\n8 GiB,0,10\n8 GiB,10,20');

  const defaults = inferDefaults(dataset);

  assert.equal(dataset.columns[defaults.xIndex].name, 'ngl');
  assert.equal(dataset.columns[defaults.yIndex].name, 't/s');
});

test('分组候选太多时不选（避免图例爆炸）', () => {
  const rows = ['id,v'];
  for (let index = 0; index < 30; index += 1) {
    rows.push(`id-${index},${index}`);
  }
  const dataset = datasetOf(rows.join('\n'));

  const defaults = inferDefaults(dataset);

  assert.equal(defaults.groupIndex, null);
});

test('countDistinct 跳过空值', () => {
  const dataset = datasetOf('a\n\nx\n\nx\n');

  assert.equal(countDistinct(dataset, 0), 1);
});
