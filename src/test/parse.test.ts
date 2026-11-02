import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectDelimiter,
  isMarkdownTable,
  isNumericText,
  parseTabularData,
  splitDelimited,
  splitMarkdownRow,
  toNumber,
} from '../services/chart/parse';

function parseOk(text: string) {
  const result = parseTabularData(text);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.dataset;
}

test('解析 CSV：表头、行数、数值列推断', () => {
  const dataset = parseOk('model,threads,tok/s\na,8,12.5\nb,16,20.1\n');

  assert.equal(dataset.columns.length, 3);
  assert.equal(dataset.columns[0].name, 'model');
  assert.equal(dataset.columns[0].kind, 'string');
  assert.equal(dataset.columns[1].kind, 'number');
  assert.equal(dataset.columns[2].kind, 'number');
  assert.equal(dataset.rows.length, 2);
  assert.equal(dataset.format, 'csv');
});

test('引号里可以有逗号、换行和转义引号', () => {
  const rows = splitDelimited('a,b\n"x,1","he said ""hi""\nnext"', ',');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['x,1', 'he said "hi"\nnext'],
  ]);
});

test('自动识别分隔符', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');

  const dataset = parseOk('a;b\n1;2');
  assert.equal(dataset.delimiter, ';');
});

test('解析 Markdown 表格：跳过对齐行', () => {
  const text = ['| 模型 | 线程 | tok/s |', '| --- | :---: | ---: |', '| a | 8 | 12.5 |', '| b | 16 | 20.1 |'].join(
    '\n',
  );

  assert.ok(isMarkdownTable(text.split('\n')));
  const dataset = parseOk(text);

  assert.equal(dataset.format, 'markdown');
  assert.deepEqual(dataset.columns.map((column) => column.name), ['模型', '线程', 'tok/s']);
  assert.deepEqual(dataset.rows, [
    ['a', '8', '12.5'],
    ['b', '16', '20.1'],
  ]);
});

test('Markdown 行切分去掉首尾竖线', () => {
  assert.deepEqual(splitMarkdownRow('| a | b |'), ['a', 'b']);
  assert.deepEqual(splitMarkdownRow('a | b'), ['a', 'b']);
});

test('列数不齐时给警告并补齐', () => {
  const dataset = parseOk('a,b,c\n1,2,3\n4,5\n6,7,8,9');

  assert.ok(dataset.warnings.some((warning) => warning.includes('少于表头')));
  assert.ok(dataset.warnings.some((warning) => warning.includes('多于表头')));
  assert.equal(dataset.rows[1].length, 3);
  assert.equal(dataset.rows[1][2], '');
});

test('空表头与重名会被改名', () => {
  const dataset = parseOk('a,,a\n1,2,3');

  assert.deepEqual(dataset.columns.map((column) => column.name), ['a', '列2', 'a (2)']);
  assert.ok(dataset.warnings.length >= 2);
});

test('只有一行时给出明确错误', () => {
  const result = parseTabularData('a,b,c');

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /至少需要/);
  }
});

test('空输入报错', () => {
  const result = parseTabularData('   \n  ');

  assert.equal(result.ok, false);
});

test('带 BOM 与 CRLF 的文件也能解析', () => {
  const dataset = parseOk('\uFEFFa,b\r\n1,2\r\n');

  assert.deepEqual(dataset.columns.map((column) => column.name), ['a', 'b']);
  assert.deepEqual(dataset.rows, [['1', '2']]);
});

test('数字识别覆盖常见写法', () => {
  assert.ok(isNumericText('1'));
  assert.ok(isNumericText('-1.5'));
  assert.ok(isNumericText('1e-3'));
  assert.ok(isNumericText(' +2.0 '));
  assert.ok(!isNumericText('1,000'));
  assert.ok(!isNumericText(''));
  assert.ok(!isNumericText('nan'));
});

test('llama-bench 的「均值 ± 标准差」取均值', () => {
  assert.equal(toNumber('381.06 ± 92.53'), 381.06);
  assert.equal(toNumber('1.61 ± 0.11'), 1.61);
  assert.ok(isNumericText('7.84 ± 0.14'));
});

test('带单位的数值取数字部分', () => {
  assert.equal(toNumber('8.37 GiB'), 8.37);
  assert.equal(toNumber('14.77 B'), 14.77);
  assert.equal(toNumber('85%'), 85);
  assert.equal(toNumber('12 ms'), 12);
});

test('日期与纯文本不会被当成数字', () => {
  assert.equal(toNumber('2024-01-01'), undefined);
  assert.equal(toNumber('Q4_K_M'), undefined);
  assert.equal(toNumber('pp512'), undefined);
});

test('llama-bench 风格的对齐行（--:）也认', () => {
  const text = [
    '| model | size | params | backend | ngl | test | t/s |',
    '| --- | ---: | ---: | --- | --: | --- | ---: |',
    '| qwen2 14B Q4_K - Medium | 8.37 GiB | 14.77 B | CUDA | 0 | pp512 | 381.06 ± 92.53 |',
  ].join('\n');

  assert.ok(isMarkdownTable(text.split('\n')));
  const dataset = parseOk(text);

  assert.equal(dataset.format, 'markdown');
  assert.equal(dataset.columns.length, 7);
  assert.deepEqual(
    dataset.columns.map((column) => column.name),
    ['model', 'size', 'params', 'backend', 'ngl', 'test', 't/s'],
  );
  assert.equal(dataset.columns[4].kind, 'number');
  assert.equal(dataset.columns[6].kind, 'number');
  assert.equal(dataset.rows.length, 1);
});

test('字符串列里混一个数字不会被误判为数值列', () => {
  const dataset = parseOk('x\n1\n2\n3\nabc');

  assert.equal(dataset.columns[0].kind, 'string');
});
