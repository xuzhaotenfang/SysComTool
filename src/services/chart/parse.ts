/**
 * 表格数据解析：CSV / Markdown 表格 / 直接粘贴的文本。
 *
 * 纯函数，不碰文件系统与 vscode —— 单测直接覆盖。
 */

export type ColumnKind = 'number' | 'string';

export interface Column {
  name: string;
  kind: ColumnKind;
}

export interface Dataset {
  columns: Column[];
  /** 全部按字符串保存，取数时再转数值 */
  rows: string[][];
  delimiter: string;
  format: 'csv' | 'markdown' | 'text';
  warnings: string[];
}

export type ParseResult = { ok: true; dataset: Dataset } | { ok: false; error: string };

const DELIMITERS = [',', ';', '\t'] as const;
const INFER_SAMPLE = 300;
const NUMERIC_RATIO = 0.8;

const NUMBER_CORE = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?';
/** 纯数字 */
const PLAIN_NUMBER = new RegExp(`^${NUMBER_CORE}$`);
/** 测量值：`381.06 ± 92.53`（llama-bench 的「均值 ± 标准差」），取均值 */
const MEASURE = new RegExp(`^(${NUMBER_CORE})\\s*±\\s*${NUMBER_CORE}$`);
/** 带单位：`8.37 GiB`、`12 ms`、`3.2 GB/s`、`85%` */
const NUMBER_WITH_UNIT = new RegExp(`^(${NUMBER_CORE})\\s*[A-Za-z%/µΩ·]{1,8}$`);

/**
 * 从一段文本里取出数值。
 *
 * 认得三种写法：纯数字、`均值 ± 标准差`、`数字 + 单位`；
 * 认不出（或整段是文本）返回 undefined —— 日期、ID 之类不会被误判成数值。
 */
export function toNumber(value: string): number | undefined {
  const text = value.trim();
  if (text === '') {
    return undefined;
  }

  if (PLAIN_NUMBER.test(text)) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  const measure = MEASURE.exec(text);
  if (measure) {
    const parsed = Number(measure[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  const withUnit = NUMBER_WITH_UNIT.exec(text);
  if (withUnit) {
    const parsed = Number(withUnit[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

/** 认不认得出是数字（含整数、小数、科学计数法、`±`、带单位） */
export function isNumericText(value: string): boolean {
  return toNumber(value) !== undefined;
}

export function parseTabularData(raw: string): ParseResult {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (text === '') {
    return { ok: false, error: '没有数据：先粘贴内容，或用「打开文件」选一个 CSV / Markdown 表格' };
  }

  const lines = text.split('\n');
  return isMarkdownTable(lines) ? parseMarkdown(parseMarkdownRows(lines)) : parseDelimited(text);
}

/** 对齐行的单元格：`---`、`--:`、`:--`、`:-:` 都算（llama-bench 输出里常见两横） */
const SEPARATOR_CELL = /^:?-+:?$/;

/** 第一行是 `| a | b |`，第二行整行都是对齐单元格，就当 Markdown 表格 */
export function isMarkdownTable(lines: string[]): boolean {
  const candidates = lines.map((line) => line.trim()).filter((line) => line !== '');
  if (candidates.length < 3) {
    return false;
  }
  if (!candidates[0].startsWith('|') || !candidates[1].startsWith('|')) {
    return false;
  }
  return isSeparatorRow(splitMarkdownRow(candidates[1]));
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length >= 2 && cells.every((cell) => SEPARATOR_CELL.test(cell.trim()));
}

export function splitMarkdownRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) {
    body = body.slice(1);
  }
  if (body.endsWith('|')) {
    body = body.slice(0, -1);
  }
  return body.split('|').map((cell) => cell.trim());
}

function parseMarkdownRows(lines: string[]): string[][] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map(splitMarkdownRow);
}

function parseMarkdown(rows: string[][]): ParseResult {
  if (rows.length < 2) {
    return { ok: false, error: 'Markdown 表格至少要有表头 + 一行数据' };
  }

  const separatorIndex = rows.findIndex(isSeparatorRow);
  const headerIndex = separatorIndex > 0 ? separatorIndex - 1 : 0;
  const header = rows[headerIndex];
  const body = rows.slice(headerIndex + 1).filter((row, index) => {
    if (separatorIndex > 0 && index === separatorIndex - headerIndex - 1) {
      return false;
    }
    return row.some((cell) => cell !== '');
  });

  return buildDataset(header, body, '\t', 'markdown', '|');
}

/** 看前几行里哪个候选分隔符在不被引号包住的位置出现最多 */
export function detectDelimiter(text: string): string {
  const sample = text.split('\n').slice(0, 5).join('\n');
  let best = ',';
  let bestCount = -1;

  for (const delimiter of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < sample.length; index += 1) {
      const char = sample[index];
      if (char === '"') {
        quoted = !quoted;
      } else if (!quoted && char === delimiter) {
        count += 1;
      }
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

function parseDelimited(text: string): ParseResult {
  const delimiter = detectDelimiter(text);
  const rows = splitDelimited(text, delimiter).filter((row) => row.some((cell) => cell.trim() !== ''));
  if (rows.length < 2) {
    return { ok: false, error: '只解析到一行：至少需要表头 + 一行数据' };
  }

  const header = rows[0].map((cell) => cell.trim());
  const body = rows.slice(1);
  return buildDataset(header, body, delimiter, delimiter === '\t' ? 'text' : 'csv');
}

/** 支持引号、引号里的换行与 `""` 转义 */
export function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.trim() === '') {
      quoted = true;
      field = '';
      continue;
    }

    if (char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);
  return rows;
}

function buildDataset(
  header: string[],
  body: string[][],
  delimiter: string,
  format: Dataset['format'],
  formatLabel?: string,
): ParseResult {
  const warnings: string[] = [];
  // 列数以表头为准：多出来的单元格忽略，缺的补空
  const width = Math.max(header.length, 1);

  const names: string[] = [];
  const seen = new Map<string, number>();
  for (let index = 0; index < width; index += 1) {
    const raw = (header[index] ?? '').trim();
    let name = raw !== '' ? raw : `列${index + 1}`;
    if (raw === '') {
      warnings.push(`表头第 ${index + 1} 列为空，已命名为「${name}」`);
    }
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count > 0) {
      name = `${name} (${count + 1})`;
      warnings.push(`表头出现重名，已改名为「${name}」`);
    }
    names.push(name);
  }

  let extra = 0;
  let short = 0;
  const normalized = body.map((row) => {
    if (row.length > width) {
      extra += 1;
    } else if (row.length < width) {
      short += 1;
    }
    const cells = row.slice(0, width).map((cell) => cell.trim());
    while (cells.length < width) {
      cells.push('');
    }
    return cells;
  });

  if (extra > 0) {
    warnings.push(`${extra} 行的列数多于表头，多余部分已忽略`);
  }
  if (short > 0) {
    warnings.push(`${short} 行的列数少于表头，缺失部分按空值处理`);
  }
  if (formatLabel) {
    warnings.push(`按 Markdown 表格解析（分隔符 ${formatLabel}）`);
  }

  const kinds = names.map((_, index) => inferKind(normalized, index));

  return {
    ok: true,
    dataset: {
      columns: names.map((name, index) => ({ name, kind: kinds[index] })),
      rows: normalized,
      delimiter,
      format,
      warnings,
    },
  };
}

function inferKind(rows: string[][], columnIndex: number): ColumnKind {
  let checked = 0;
  let numeric = 0;

  for (const row of rows) {
    if (checked >= INFER_SAMPLE) {
      break;
    }
    const value = (row[columnIndex] ?? '').trim();
    if (value === '') {
      continue;
    }
    checked += 1;
    if (isNumericText(value)) {
      numeric += 1;
    }
  }

  if (checked === 0) {
    return 'string';
  }
  return numeric / checked >= NUMERIC_RATIO ? 'number' : 'string';
}

/** 给界面用的预览：前 N 行 + 规模 */
export function previewDataset(dataset: Dataset, limit = 8): {
  columns: Column[];
  rows: string[][];
  total: number;
  shown: number;
} {
  return {
    columns: dataset.columns,
    rows: dataset.rows.slice(0, limit),
    total: dataset.rows.length,
    shown: Math.min(limit, dataset.rows.length),
  };
}
