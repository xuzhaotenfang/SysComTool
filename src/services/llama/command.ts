/**
 * 把界面上的参数变成 llama.cpp 的命令行。
 *
 * 纯函数，不碰 `vscode`，也不碰文件系统 —— 单测直接覆盖。
 * 规则：**输入为空 = 不传这个参数**（不是传空字符串）。
 */

export interface LlamaParams {
  /** 提示词，空 = 不传 -p（llama-cli 进入对话模式） */
  prompt: string;
  nPredict: string;
  ctxSize: string;
  threads: string;
  gpuLayers: string;
  temperature: string;
  batchSize: string;
  seed: string;
  /** 额外参数，原样拼接（支持引号） */
  extra: string;
}

export const DEFAULT_PARAMS: LlamaParams = {
  prompt: '',
  nPredict: '',
  ctxSize: '',
  threads: '',
  gpuLayers: '',
  temperature: '',
  batchSize: '',
  seed: '',
  extra: '',
};

const NUMERIC_FLAGS: ReadonlyArray<readonly [keyof LlamaParams, string]> = [
  ['nPredict', '-n'],
  ['ctxSize', '-c'],
  ['threads', '-t'],
  ['gpuLayers', '-ngl'],
  ['temperature', '--temp'],
  ['batchSize', '-b'],
  ['seed', '-s'],
];

const NUMERIC_LABELS: Readonly<Record<string, string>> = {
  nPredict: '预测长度 -n',
  ctxSize: '上下文 -c',
  threads: '线程数 -t',
  gpuLayers: 'GPU 层数 -ngl',
  temperature: '温度 --temp',
  batchSize: '批大小 -b',
  seed: '随机种子 -s',
};

const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

export interface LlamaTarget {
  execPath: string;
  modelPath: string;
}

/** 参数合法性问题；空数组表示没问题。 */
export function validateParams(target: Partial<LlamaTarget>, params: LlamaParams): string[] {
  const problems: string[] = [];
  if (!target.execPath) {
    problems.push('还没有选择 llama.cpp 可执行文件');
  }
  if (!target.modelPath) {
    problems.push('还没有选择模型（.gguf）');
  }
  for (const [field] of NUMERIC_FLAGS) {
    const raw = params[field].trim();
    if (raw !== '' && !NUMBER_RE.test(raw)) {
      problems.push(`${NUMERIC_LABELS[field]} 需要是数字，当前是 "${raw}"`);
    }
  }
  return problems;
}

export function buildArgs(target: LlamaTarget, params: LlamaParams): string[] {
  const args: string[] = ['-m', target.modelPath];

  if (params.prompt.trim() !== '') {
    args.push('-p', params.prompt);
  }

  for (const [field, flag] of NUMERIC_FLAGS) {
    const raw = params[field].trim();
    if (raw !== '') {
      args.push(flag, raw);
    }
  }

  args.push(...splitExtraArgs(params.extra));
  return args;
}

/** 切分额外参数，支持 `--foo "a b"` 与 `'a b'`。 */
export function splitExtraArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let hasToken = false;
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && index + 1 < input.length) {
        index += 1;
        current += input[index];
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (hasToken) {
        args.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }

    if (char === '\\' && index + 1 < input.length) {
      index += 1;
      current += input[index];
      hasToken = true;
      continue;
    }

    current += char;
    hasToken = true;
  }

  if (hasToken) {
    args.push(current);
  }
  return args;
}

/**
 * 给 PowerShell 语法加引号（VS Code 在 Windows 上默认终端就是它）。
 * 注意：单引号内不做转义，PowerShell 用两个单引号表示一个单引号。
 */
export function shellQuote(value: string): string {
  if (value === '') {
    return "''";
  }
  if (/^[A-Za-z0-9_\-./:=@+\\]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 生成可复制的命令行。
 * 换行会被压成空格 —— 要完整保留换行的提示词，请用「运行」走 argv 直传。
 */
export function toShellCommand(execPath: string, args: readonly string[]): string {
  return [execPath, ...args]
    .map((part) => shellQuote(part.replace(/\r?\n/g, ' ')))
    .join(' ');
}

/** 供界面展示用的「简短命令」：不显示可执行文件全路径。 */
export function toShortCommand(args: readonly string[]): string {
  return ['llama-cli', ...args].map(shellQuote).join(' ');
}
