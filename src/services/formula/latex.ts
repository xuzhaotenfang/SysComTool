/**
 * 把数学建模里常见的 LaTeX 公式转成表达式语法。
 *
 * 覆盖的是写论文时最常用的那几种写法，不是完整的 TeX 引擎：
 * \frac、\sqrt、上下标、希腊字母、常用函数、\cdot/\times、多行 aligned 环境。
 */

const GREEK: Record<string, string> = {
  alpha: 'alpha',
  beta: 'beta',
  gamma: 'gamma',
  delta: 'delta',
  epsilon: 'epsilon',
  varepsilon: 'epsilon',
  zeta: 'zeta',
  eta: 'eta',
  theta: 'theta',
  vartheta: 'theta',
  iota: 'iota',
  kappa: 'kappa',
  lambda: 'lambda',
  mu: 'mu',
  nu: 'nu',
  xi: 'xi',
  rho: 'rho',
  sigma: 'sigma',
  tau: 'tau',
  upsilon: 'upsilon',
  phi: 'phi',
  varphi: 'phi',
  chi: 'chi',
  psi: 'psi',
  omega: 'omega',
  Gamma: 'Gamma',
  Delta: 'Delta',
  Theta: 'Theta',
  Lambda: 'Lambda',
  Xi: 'Xi',
  Pi: 'pi',
  Sigma: 'Sigma',
  Phi: 'Phi',
  Psi: 'Psi',
  Omega: 'Omega',
};

/** 只保留数学内容，去掉排版指令 */
function stripLayout(input: string): string {
  return input
    .replace(/\\(?:begin|end)\{[a-zA-Z*]+\}/g, '')
    .replace(/\$\$?/g, '')
    .replace(/\\\[|\\\]|\\\(|\\\)/g, '')
    .replace(/\\(?:left|right|big|Big|bigg|Bigg)\b/g, '')
    .replace(/\\(?:quad|qquad|,|;|:|!| )/g, ' ')
    .replace(/\\(?:displaystyle|textstyle|scriptstyle|limits|nolimits)/g, '')
    .replace(/~+/g, ' ')
    .replace(/&/g, ' ');
}

/** 找从 start 开始的 `{...}`（支持嵌套），返回内容与结束位置 */
function readGroup(input: string, start: number): { content: string; end: number } | null {
  let index = start;
  while (index < input.length && /\s/.test(input[index])) {
    index += 1;
  }
  if (input[index] !== '{') {
    return null;
  }

  let depth = 0;
  for (let cursor = index; cursor < input.length; cursor += 1) {
    if (input[cursor] === '{') {
      depth += 1;
    } else if (input[cursor] === '}') {
      depth -= 1;
      if (depth === 0) {
        return { content: input.slice(index + 1, cursor), end: cursor + 1 };
      }
    }
  }
  return null;
}

function expandFractions(input: string): string {
  let result = input;

  for (;;) {
    const match = /\\[dt]?frac\s*/.exec(result);
    if (!match) {
      return result;
    }
    const numerator = readGroup(result, match.index + match[0].length);
    if (!numerator) {
      return result;
    }
    const denominator = readGroup(result, numerator.end);
    if (!denominator) {
      return result;
    }

    const replacement = `((${numerator.content})/(${denominator.content}))`;
    result = result.slice(0, match.index) + replacement + result.slice(denominator.end);
  }
}

function expandRoots(input: string): string {
  let result = input;

  for (;;) {
    const match = /\\sqrt\s*/.exec(result);
    if (!match) {
      return result;
    }

    let cursor = match.index + match[0].length;
    let order = '';
    if (result[cursor] === '[') {
      const close = result.indexOf(']', cursor);
      if (close < 0) {
        return result;
      }
      order = result.slice(cursor + 1, close).trim();
      cursor = close + 1;
    }

    const body = readGroup(result, cursor);
    if (!body) {
      return result;
    }

    const replacement = order !== '' ? `pow((${body.content}), 1/(${order}))` : `sqrt(${body.content})`;
    result = result.slice(0, match.index) + replacement + result.slice(body.end);
  }
}

function replaceCommandNames(input: string): string {
  let result = input;

  // \log_{10} / \log_2 → log10 / log2
  result = result.replace(
    /\\(log|ln|exp|sin|cos|tan|arcsin|arccos|arctan)\s*_\{?([0-9a-zA-Z]+)\}?/g,
    (_match, name: string, subscript: string) => {
      if (name === 'log') {
        return `log${subscript}`;
      }
      return name;
    },
  );

  // \arcsin → asin 之类
  result = result.replace(/\\(arcsin|arccos|arctan)\b/g, (_match, name: string) => `a${name.slice(3)}`);

  // \ln、\exp、\sin……
  result = result.replace(
    /\\(log|ln|exp|sin|cos|tan|min|max|abs|floor|ceil)\b/g,
    (_match, name: string) => name,
  );

  // \operatorname{ln} → ln
  result = result.replace(/\\operatorname\s*\{([^{}]*)\}/g, (_match, name: string) => name.trim());

  // \text{...} 是标注，直接丢掉
  result = result.replace(/\\text\s*\{[^{}]*\}/g, ' ');

  return result;
}

function replaceSymbols(input: string): string {
  let result = input;

  for (const [latexName, plain] of Object.entries(GREEK)) {
    result = result.replace(new RegExp(`\\\\${latexName}\\b`, 'g'), plain);
  }

  return result
    .replace(/\\(?:cdot|times|ast)\b/g, '*')
    .replace(/\\div\b/g, '/')
    .replace(/\\pm\b/g, '+')
    .replace(/\\mp\b/g, '-')
    .replace(/\\infty\b/g, 'Infinity')
    .replace(/\\%/g, '%')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/·/g, '*')
    .replace(/π/g, 'pi')
    .replace(/[（）]/g, (char) => (char === '（' ? '(' : ')'));
}

function normalizeScripts(input: string): string {
  let result = input;

  // 上标：x^{2} → x^(2)，x^2 保持不变
  result = result.replace(/\^\s*\{([^{}]*)\}/g, '^($1)');

  // 下标：x_{1} → x_1，x_{i,j} → x_ij
  result = result.replace(/_\s*\{([^{}]*)\}/g, (_match, body: string) => `_${body.replace(/[^0-9a-zA-Z]/g, '')}`);
  result = result.replace(/_([0-9a-zA-Z])\b/g, '_$1');

  return result;
}

/** 数学写法里函数常常不带括号：`\ln x`、`\sin t` → `ln(x)` */
function applyFunctionApplication(input: string): string {
  return input.replace(
    /\b(ln|log10|log2|log|exp|sin|cos|tan|asin|acos|atan|abs|sqrt)\s+([a-zA-Z_][a-zA-Z0-9_]*|\d+(?:\.\d+)?)/g,
    '$1($2)',
  );
}

/** 并置即乘法：`a x`、`2x`、`(a+b)(c+d)` → 补上 `*` */
function applyImplicitMultiplication(input: string): string {
  let result = input;

  for (let round = 0; round < 6; round += 1) {
    const next = result.replace(/([0-9a-zA-Z_)])\s+(?=[a-zA-Z_(])/g, '$1*');
    if (next === result) {
      break;
    }
    result = next;
  }

  return result.replace(/(\))(?=\()/g, '$1*');
}

function cleanup(input: string): string {
  let result = input;
  // 剩下的 \foo 当作普通名字
  result = result.replace(/\\([a-zA-Z]+)/g, '$1');
  result = applyFunctionApplication(result);
  result = applyImplicitMultiplication(result);
  // 无空格的并置：2x → 2*x，但别动科学计数法 1e-3
  result = result.replace(/(\d)([a-zA-Z_])/g, (match, digit: string, next: string) =>
    next === 'e' || next === 'E' ? match : `${digit}*${next}`,
  );
  // (a+b)x → (a+b)*x
  result = result.replace(/(\))(?=[a-zA-Z_])/g, '$1*');
  return result.replace(/\s+/g, ' ').trim();
}

/** LaTeX 片段 → 表达式 */
export function latexToExpression(input: string): string {
  let result = stripLayout(input);
  result = replaceCommandNames(result);
  result = replaceSymbols(result);
  result = expandFractions(result);
  result = expandRoots(result);
  result = normalizeScripts(result);
  return cleanup(result);
}

/** 公式左边的名字：去掉 \hat、\bar、下标花括号等 */
export function normalizeName(input: string): string {
  let result = stripLayout(input);
  result = result.replace(/\\(?:hat|bar|tilde|vec|dot|overline|underline|mathbf|mathrm|mathit|text|boldsymbol)\s*/g, '');
  result = result.replace(/\\[a-zA-Z]+/g, '');
  result = normalizeScripts(result);
  result = result.replace(/[^0-9a-zA-Z_\u4e00-\u9fa5]/g, '');
  result = result.replace(/^_+/, '');
  return result;
}

export interface FormulaDefinition {
  name: string;
  expression: string;
  source: string;
}

export interface FormulaParseResult {
  formulas: FormulaDefinition[];
  errors: string[];
  variables: string[];
}

/** 把整段 LaTeX（可能有多行、aligned 环境）拆成逐条公式 */
export function parseFormulas(input: string): FormulaParseResult {
  const prepared = input
    .replace(/\r\n?/g, '\n')
    .replace(/\\\\/g, '\n')
    .replace(/\\(?:begin|end)\{[a-zA-Z*]+\}/g, '\n')
    .replace(/&/g, ' ');

  const lines = prepared
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('%'));

  const formulas: FormulaDefinition[] = [];
  const errors: string[] = [];
  const names = new Set<string>();

  for (const line of lines) {
    const separator = line.indexOf('=');
    if (separator < 0) {
      errors.push(`缺少等号，跳过：${line}`);
      continue;
    }

    const name = normalizeName(line.slice(0, separator));
    const expression = latexToExpression(line.slice(separator + 1));

    if (name === '') {
      errors.push(`等号左边没有名字：${line}`);
      continue;
    }
    if (expression === '') {
      errors.push(`「${name}」等号右边是空的`);
      continue;
    }
    if (names.has(name)) {
      errors.push(`「${name}」定义了两次，只保留第一条`);
      continue;
    }

    names.add(name);
    formulas.push({ name, expression, source: line });
  }

  // 前一条公式的结果可以在后面的公式里当因子用，所以别把已定义的名字算成待绑定变量
  const defined = new Set(formulas.map((formula) => formula.name));
  const variables = [...new Set(formulas.flatMap((formula) => collectVariables(formula.expression)))].filter(
    (name) => !defined.has(name),
  );

  return { formulas, errors, variables };
}

/** 公式里出现、但不是函数/常量的名字 */
export function collectVariables(expression: string): string[] {
  const found = new Set<string>();
  const pattern = /[a-zA-Z_][a-zA-Z0-9_]*/g;

  for (const match of expression.matchAll(pattern)) {
    const name = match[0];
    if (FUNCTION_OR_CONSTANT.has(name)) {
      continue;
    }
    // 后面紧跟左括号的是函数调用
    const rest = expression.slice(match.index + name.length);
    if (/^\s*\(/.test(rest)) {
      continue;
    }
    found.add(name);
  }

  return [...found];
}

const FUNCTION_OR_CONSTANT = new Set([
  'sqrt',
  'cbrt',
  'exp',
  'ln',
  'log',
  'log10',
  'log2',
  'abs',
  'floor',
  'ceil',
  'round',
  'sign',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'min',
  'max',
  'pow',
  'clamp',
  'mod',
  'pi',
  'e',
  'tau',
  'Infinity',
]);
