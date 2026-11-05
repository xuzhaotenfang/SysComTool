import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectVariables,
  latexToExpression,
  normalizeName,
  parseFormulas,
} from '../services/formula/latex';

test('\\frac 展开成括号除法', () => {
  assert.equal(latexToExpression('\\frac{a}{b}'), '((a)/(b))');
  assert.equal(latexToExpression('\\frac{x + 1}{2}'), '((x + 1)/(2))');
});

test('嵌套 \\frac 逐层展开', () => {
  const expression = latexToExpression('\\frac{\\frac{a}{b}}{c}');
  assert.ok(expression.includes('((a)/(b))'));
  assert.ok(!expression.includes('\\frac'));
});

test('\\sqrt 与 \\sqrt[n]', () => {
  assert.equal(latexToExpression('\\sqrt{x}'), 'sqrt(x)');
  assert.equal(latexToExpression('\\sqrt[3]{x}'), 'pow((x), 1/(3))');
});

test('\\cdot、\\times、\\div 转成运算符', () => {
  assert.equal(latexToExpression('a \\cdot b'), 'a * b');
  assert.equal(latexToExpression('a \\times b'), 'a * b');
  assert.equal(latexToExpression('a \\div b'), 'a / b');
});

test('上下标', () => {
  assert.equal(latexToExpression('x^{2}'), 'x^(2)');
  assert.equal(latexToExpression('x^2'), 'x^2');
  assert.equal(latexToExpression('x_{1}'), 'x_1');
  assert.equal(latexToExpression('x_{i,j}'), 'x_ij');
});

test('希腊字母与函数', () => {
  assert.equal(latexToExpression('\\alpha \\beta'), 'alpha*beta');
  assert.equal(latexToExpression('\\ln x'), 'ln(x)');
  assert.equal(latexToExpression('\\log_{10} x'), 'log10(x)');
  assert.equal(latexToExpression('\\operatorname{exp} x'), 'exp(x)');
});

test('去掉排版命令与定界符', () => {
  assert.equal(latexToExpression('$\\left( a + b \\right)$'), '( a + b )');
  assert.equal(latexToExpression('a \\, b'), 'a*b');
});

test('并置即乘法', () => {
  assert.equal(latexToExpression('2x'), '2*x');
  assert.equal(latexToExpression('a x + b'), 'a*x + b');
  assert.equal(latexToExpression('x2'), 'x2');
});

test('normalizeName 去掉修饰符', () => {
  assert.equal(normalizeName('\\hat{y}'), 'y');
  assert.equal(normalizeName('y_{i}'), 'y_i');
  assert.equal(normalizeName('\\bar{u}_{1}'), 'u_1');
});

test('parseFormulas 支持多行与 aligned 环境', () => {
  const input = String.raw`\begin{aligned}
y &= \frac{a x}{1 + b x} \\
z &= \sqrt{x^{2} + y^{2}}
\end{aligned}`;

  const parsed = parseFormulas(input);

  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(
    parsed.formulas.map((formula) => formula.name),
    ['y', 'z'],
  );
  assert.ok(parsed.formulas[0].expression.includes('((a*x)/(1 + b*x))'));
  // y 是第一条公式的结果，后面的公式可以直接引用，不算待绑定变量
  assert.deepEqual(parsed.variables.sort(), ['a', 'b', 'x']);
});

test('parseFormulas 报告缺少等号与重复定义', () => {
  const parsed = parseFormulas('y = x + 1\n没有等号\nz = y * 2\ny = x');

  assert.ok(parsed.errors.some((error) => error.includes('缺少等号')));
  assert.ok(parsed.errors.some((error) => error.includes('定义了两次')));
  assert.equal(parsed.formulas.length, 2);
});

test('collectVariables 排除函数与常量', () => {
  assert.deepEqual(collectVariables('sqrt(x) + pi * a + max(b, c)'), ['x', 'a', 'b', 'c']);
});
