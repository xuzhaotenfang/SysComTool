/**
 * 安全的表达式求值器（不用 eval）。
 *
 * 支持：+ - * / % ^、括号、一元正负、函数调用、常量 pi / e。
 * 公式来自用户粘贴的 LaTeX，先经 latex.ts 归一化成这里的语法。
 */

export class FormulaError extends Error {
  constructor(
    message: string,
    readonly position?: number,
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}

type TokenKind = 'number' | 'identifier' | 'operator' | 'paren' | 'comma' | 'end';

interface Token {
  kind: TokenKind;
  value: string;
  position: number;
}

const OPERATORS = new Set(['+', '-', '*', '/', '%', '^']);
const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

interface FunctionSpec {
  min: number;
  max: number;
  fn: (args: number[]) => number;
}

const FUNCTIONS: Record<string, FunctionSpec> = {
  sqrt: { min: 1, max: 1, fn: (args) => Math.sqrt(args[0]) },
  cbrt: { min: 1, max: 1, fn: (args) => Math.cbrt(args[0]) },
  exp: { min: 1, max: 1, fn: (args) => Math.exp(args[0]) },
  ln: { min: 1, max: 1, fn: (args) => Math.log(args[0]) },
  log: { min: 1, max: 1, fn: (args) => Math.log(args[0]) },
  log10: { min: 1, max: 1, fn: (args) => Math.log10(args[0]) },
  log2: { min: 1, max: 1, fn: (args) => Math.log2(args[0]) },
  abs: { min: 1, max: 1, fn: (args) => Math.abs(args[0]) },
  floor: { min: 1, max: 1, fn: (args) => Math.floor(args[0]) },
  ceil: { min: 1, max: 1, fn: (args) => Math.ceil(args[0]) },
  round: { min: 1, max: 1, fn: (args) => Math.round(args[0]) },
  sign: { min: 1, max: 1, fn: (args) => Math.sign(args[0]) },
  sin: { min: 1, max: 1, fn: (args) => Math.sin(args[0]) },
  cos: { min: 1, max: 1, fn: (args) => Math.cos(args[0]) },
  tan: { min: 1, max: 1, fn: (args) => Math.tan(args[0]) },
  asin: { min: 1, max: 1, fn: (args) => Math.asin(args[0]) },
  acos: { min: 1, max: 1, fn: (args) => Math.acos(args[0]) },
  atan: { min: 1, max: 1, fn: (args) => Math.atan(args[0]) },
  min: { min: 1, max: Number.MAX_SAFE_INTEGER, fn: (args) => Math.min(...args) },
  max: { min: 1, max: Number.MAX_SAFE_INTEGER, fn: (args) => Math.max(...args) },
  pow: { min: 2, max: 2, fn: (args) => args[0] ** args[1] },
  clamp: { min: 3, max: 3, fn: (args) => Math.min(Math.max(args[0], args[1]), args[2]) },
  mod: { min: 2, max: 2, fn: (args) => ((args[0] % args[1]) + args[1]) % args[1] },
};

export function isFunctionName(name: string): boolean {
  return Object.hasOwn(FUNCTIONS, name);
}

export function isConstantName(name: string): boolean {
  return Object.hasOwn(CONSTANTS, name);
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const start = index;
      while (index < input.length && /[0-9.]/.test(input[index])) {
        index += 1;
      }
      // 科学计数法
      if (input[index] === 'e' || input[index] === 'E') {
        const save = index;
        index += 1;
        if (input[index] === '+' || input[index] === '-') {
          index += 1;
        }
        if (/[0-9]/.test(input[index] ?? '')) {
          while (index < input.length && /[0-9]/.test(input[index])) {
            index += 1;
          }
        } else {
          index = save;
        }
      }
      const text = input.slice(start, index);
      if (!Number.isFinite(Number(text))) {
        throw new FormulaError(`「${text}」不是合法数字`, start);
      }
      tokens.push({ kind: 'number', value: text, position: start });
      continue;
    }

    if (/[a-zA-Z_]/.test(char)) {
      const start = index;
      while (index < input.length && /[a-zA-Z0-9_]/.test(input[index])) {
        index += 1;
      }
      tokens.push({ kind: 'identifier', value: input.slice(start, index), position: start });
      continue;
    }

    if (OPERATORS.has(char)) {
      tokens.push({ kind: 'operator', value: char, position: index });
      index += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ kind: 'paren', value: char, position: index });
      index += 1;
      continue;
    }

    if (char === ',') {
      tokens.push({ kind: 'comma', value: char, position: index });
      index += 1;
      continue;
    }

    throw new FormulaError(`不认识的字符「${char}」`, index);
  }

  tokens.push({ kind: 'end', value: '', position: input.length });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly variables: Readonly<Record<string, number>>,
  ) {}

  parse(): number {
    const value = this.expression(0);
    if (this.peek().kind !== 'end') {
      throw new FormulaError(`多余的「${this.peek().value}」`, this.peek().position);
    }
    return value;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    return this.tokens[this.index++];
  }

  private match(value: string): boolean {
    const token = this.peek();
    if ((token.kind === 'operator' || token.kind === 'paren' || token.kind === 'comma') && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private expression(minPrecedence: number): number {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'operator' || !OPERATORS.has(token.value) || token.value === '^') {
        break;
      }
      const precedence = token.value === '*' || token.value === '/' || token.value === '%' ? 2 : 1;
      if (precedence < minPrecedence) {
        break;
      }
      this.index += 1;
      const right = this.expression(precedence + 1);
      left = applyOperator(token.value, left, right, token.position);
    }
    return left;
  }

  /** 一元负号比乘除低、比幂高：-2^2 = -(2^2)，2^-1 = 2^(-1) */
  private unary(): number {
    if (this.match('-')) {
      return -this.unary();
    }
    if (this.match('+')) {
      return this.unary();
    }
    return this.power();
  }

  /** 幂右结合，且允许指数带符号 */
  private power(): number {
    const base = this.primary();
    if (this.match('^')) {
      return base ** this.unary();
    }
    return base;
  }

  private primary(): number {
    const token = this.next();

    if (token.kind === 'number') {
      return Number(token.value);
    }

    if (token.kind === 'identifier') {
      const name = token.value;
      if (this.match('(')) {
        const args = this.arguments();
        const spec = FUNCTIONS[name];
        if (!spec) {
          throw new FormulaError(`不认识的函数「${name}」`, token.position);
        }
        if (args.length < spec.min || args.length > spec.max) {
          throw new FormulaError(`函数「${name}」参数个数不对`, token.position);
        }
        return spec.fn(args);
      }

      if (isConstantName(name)) {
        return CONSTANTS[name];
      }

      if (Object.hasOwn(this.variables, name)) {
        return this.variables[name];
      }

      throw new FormulaError(`变量「${name}」没有绑定`, token.position);
    }

    if (token.kind === 'paren' && token.value === '(') {
      const value = this.expression(0);
      if (!this.match(')')) {
        throw new FormulaError('缺少右括号', token.position);
      }
      return value;
    }

    throw new FormulaError(`这里不该出现「${token.value}」`, token.position);
  }

  private arguments(): number[] {
    const args: number[] = [];
    if (this.match(')')) {
      return args;
    }
    for (;;) {
      args.push(this.expression(0));
      if (this.match(',')) {
        continue;
      }
      if (this.match(')')) {
        return args;
      }
      throw new FormulaError('函数参数之间缺少逗号或右括号', this.peek().position);
    }
  }
}

function applyOperator(operator: string, left: number, right: number, position: number): number {
  switch (operator) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      if (right === 0) {
        throw new FormulaError('除以 0', position);
      }
      return left / right;
    case '%':
      if (right === 0) {
        throw new FormulaError('对 0 取模', position);
      }
      return left % right;
    case '^':
      return left ** right;
    default:
      throw new FormulaError(`不支持的运算符「${operator}」`, position);
  }
}

export function evaluateExpression(input: string, variables: Record<string, number>): number {
  if (input.trim() === '') {
    throw new FormulaError('公式是空的');
  }
  return new Parser(tokenize(input), variables).parse();
}

/** 取出表达式里用到的变量名（排除函数名与常量） */
export function collectIdentifiers(expression: string): string[] {
  const found = new Set<string>();

  for (const token of tokenize(expression)) {
    if (token.kind !== 'identifier') {
      continue;
    }
    if (isFunctionName(token.value) || isConstantName(token.value)) {
      continue;
    }
    found.add(token.value);
  }

  return [...found];
}
