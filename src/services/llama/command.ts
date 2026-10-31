/**
 * 把界面上的参数变成 llama.cpp 的命令行。
 *
 * 纯函数，不碰 `vscode`，也不碰文件系统 —— 单测直接覆盖。
 * 规则：**输入为空 = 不传这个参数**（不是传空字符串）。
 */

/** GPU 加速：auto 只在填了层数时传 -ngl；on 一定开（默认 99 层）；off 一定关（-ngl 0） */
export type GpuMode = 'auto' | 'on' | 'off';

/** 多卡切片方式，空串表示不传 */
export type SplitMode = '' | 'none' | 'layer' | 'row';

export interface LlamaParams {
  /** 提示词，空 = 不传 -p（llama-cli 进入对话模式） */
  prompt: string;
  gpuMode: GpuMode;
  /** GPU 层数，配合 gpuMode 使用 */
  gpuLayers: string;
  /** 多卡切片：--split-mode */
  splitMode: SplitMode;
  /** 张量分配比例：-ts，例如 "3,1" */
  tensorSplit: string;
  nPredict: string;
  ctxSize: string;
  threads: string;
  temperature: string;
  batchSize: string;
  seed: string;
  /** 额外参数，原样拼接（支持引号） */
  extra: string;
}

export const DEFAULT_PARAMS: LlamaParams = {
  prompt: '',
  gpuMode: 'auto',
  gpuLayers: '',
  splitMode: '',
  tensorSplit: '',
  nPredict: '',
  ctxSize: '',
  threads: '',
  temperature: '',
  batchSize: '',
  seed: '',
  extra: '',
};

/** 启用 GPU 但没填层数时用的默认值：尽量把层都放到显存里 */
export const DEFAULT_GPU_LAYERS = '99';

const SPLIT_MODES: readonly string[] = ['', 'none', 'layer', 'row'];
const GPU_MODES: readonly string[] = ['auto', 'on', 'off'];

const NUMERIC_FLAGS: ReadonlyArray<readonly [keyof LlamaParams, string]> = [
  ['nPredict', '-n'],
  ['ctxSize', '-c'],
  ['threads', '-t'],
  ['temperature', '--temp'],
  ['batchSize', '-b'],
  ['seed', '-s'],
];

const NUMERIC_LABELS: Readonly<Record<string, string>> = {
  nPredict: '预测长度 -n',
  ctxSize: '上下文 -c',
  threads: '线程数 -t',
  temperature: '温度 --temp',
  batchSize: '批大小 -b',
  seed: '随机种子 -s',
};

const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
/** 逗号分隔的正数，例如 "3,1" 或 "1,1,1" */
const TENSOR_SPLIT_RE = /^\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)*$/;

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

  if (!GPU_MODES.includes(params.gpuMode)) {
    problems.push(`GPU 模式 "${params.gpuMode}" 不合法，应为 auto / on / off`);
  }
  if (!SPLIT_MODES.includes(params.splitMode)) {
    problems.push(`切片方式 "${params.splitMode}" 不合法，应为 none / layer / row`);
  }

  const layers = params.gpuLayers.trim();
  if (layers !== '' && !NUMBER_RE.test(layers)) {
    problems.push(`GPU 层数 -ngl 需要是数字，当前是 "${layers}"`);
  }

  const split = params.tensorSplit.trim();
  if (split !== '' && !TENSOR_SPLIT_RE.test(split)) {
    problems.push(`张量分配 -ts 需要形如 "3,1" 的正数序列，当前是 "${split}"`);
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

  // GPU 加速：off 强制 -ngl 0（纯 CPU），on 一定带层数，auto 只在填了层数时生效
  const layers = params.gpuLayers.trim();
  if (params.gpuMode === 'off') {
    args.push('-ngl', '0');
  } else if (params.gpuMode === 'on') {
    args.push('-ngl', layers !== '' ? layers : DEFAULT_GPU_LAYERS);
  } else if (layers !== '') {
    args.push('-ngl', layers);
  }

  // 多卡切片
  if (params.splitMode !== '') {
    args.push('--split-mode', params.splitMode);
  }
  if (params.tensorSplit.trim() !== '') {
    args.push('-ts', params.tensorSplit.trim());
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
