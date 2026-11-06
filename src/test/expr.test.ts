import assert from 'node:assert/strict';
import test from 'node:test';
import { collectIdentifiers, evaluateExpression, FormulaError } from '../services/formula/expr';

test('四则运算与优先级', () => {
  assert.equal(evaluateExpression('1 + 2 * 3', {}), 7);
  assert.equal(evaluateExpression('(1 + 2) * 3', {}), 9);
  assert.equal(evaluateExpression('10 / 4', {}), 2.5);
  assert.equal(evaluateExpression('7 % 4', {}), 3);
});

test('幂运算右结合', () => {
  assert.equal(evaluateExpression('2 ^ 3 ^ 2', {}), 512);
  assert.equal(evaluateExpression('-2 ^ 2', {}), -4);
  assert.equal(evaluateExpression('2 ^ -1', {}), 0.5);
});

test('变量代入', () => {
  assert.equal(evaluateExpression('a * x + b', { a: 2, x: 3, b: 1 }), 7);
});

test('常量 pi / e', () => {
  assert.equal(evaluateExpression('pi', {}), Math.PI);
  assert.equal(evaluateExpression('e', {}), Math.E);
});

test('函数调用', () => {
  assert.equal(evaluateExpression('sqrt(9)', {}), 3);
  assert.equal(evaluateExpression('abs(-2.5)', {}), 2.5);
  assert.equal(evaluateExpression('max(1, 5, 3)', {}), 5);
  assert.equal(evaluateExpression('clamp(10, 0, 4)', {}), 4);
  assert.equal(evaluateExpression('log10(100)', {}), 2);
  assert.equal(evaluateExpression('pow(2, 10)', {}), 1024);
});

test('科学计数法', () => {
  assert.equal(evaluateExpression('1e-3', {}), 0.001);
  assert.equal(evaluateExpression('2.5e2', {}), 250);
});

test('未绑定变量报错', () => {
  assert.throws(() => evaluateExpression('a + 1', {}), (error: unknown) => {
    assert.ok(error instanceof FormulaError);
    assert.match(error.message, /没有绑定/);
    return true;
  });
});

test('除以 0 报错', () => {
  assert.throws(() => evaluateExpression('1 / 0', {}), /除以 0/);
});

test('语法错误报错', () => {
  assert.throws(() => evaluateExpression('1 + ', {}), FormulaError);
  assert.throws(() => evaluateExpression('(1 + 2', {}), FormulaError);
  assert.throws(() => evaluateExpression('1 2', {}), FormulaError);
  assert.throws(() => evaluateExpression('foo(1)', {}), /不认识的函数/);
});

test('collectIdentifiers 排除函数名与常量', () => {
  assert.deepEqual(collectIdentifiers('a * x + pi * sqrt(y)'), ['a', 'x', 'y']);
});
