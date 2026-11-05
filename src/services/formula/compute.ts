/**
 * 按公式逐行计算 CSV：因子要么绑定到某一列，要么是常量。
 */

import { toNumber, type Column, type Dataset } from '../chart/parse';
import { evaluateExpression, FormulaError } from './expr';

export type Binding =
  | { kind: 'column'; index: number }
  | { kind: 'constant'; value: number };

export interface ComputeFormula {
  name: string;
  expression: string;
}

export interface RowError {
  /** 1 表示第一行数据（不含表头） */
  row: number;
  formula: string;
  message: string;
}

export interface ComputeResult {
  columns: Column[];
  rows: string[][];
  computed: string[];
  errors: RowError[];
  /** 出错的行数（errors 只保留前若干条） */
  errorRows: number;
  okRows: number;
  totalRows: number;
}

const MAX_ERRORS = 50;

export function computeFormulas(
  dataset: Dataset,
  formulas: readonly ComputeFormula[],
  bindings: Readonly<Record<string, Binding>>,
): ComputeResult {
  const columns: Column[] = [
    ...dataset.columns,
    ...formulas.map((formula) => ({ name: formula.name, kind: 'number' as const })),
  ];

  const rows: string[][] = [];
  const errors: RowError[] = [];
  let errorRows = 0;
  let okRows = 0;

  dataset.rows.forEach((row, rowIndex) => {
    const vars: Record<string, number> = {};
    const bindingProblem = bindVariables(row, bindings, vars);

    if (bindingProblem) {
      errorRows += 1;
      if (errors.length < MAX_ERRORS) {
        errors.push({ row: rowIndex + 1, formula: formulas[0]?.name ?? '', message: bindingProblem });
      }
      rows.push([...row, ...formulas.map(() => '')]);
      return;
    }

    const computed: string[] = [];
    let rowFailed = false;

    for (const formula of formulas) {
      try {
        const value = evaluateExpression(formula.expression, vars);
        if (!Number.isFinite(value)) {
          throw new FormulaError('结果不是有限数（可能是 sqrt 负数、溢出或 0/0）');
        }
        // 后面的公式可以引用这一条的结果（建模里常见：先算 y，再算 f(x, y)）
        vars[formula.name] = value;
        computed.push(formatValue(value));
      } catch (error) {
        rowFailed = true;
        const message = error instanceof FormulaError ? error.message : String(error);
        if (errors.length < MAX_ERRORS) {
          errors.push({ row: rowIndex + 1, formula: formula.name, message });
        }
        computed.push('');
      }
    }

    if (rowFailed) {
      errorRows += 1;
    } else {
      okRows += 1;
    }
    rows.push([...row, ...computed]);
  });

  return {
    columns,
    rows,
    computed: formulas.map((formula) => formula.name),
    errors,
    errorRows,
    okRows,
    totalRows: dataset.rows.length,
  };
}

function bindVariables(
  row: readonly string[],
  bindings: Readonly<Record<string, Binding>>,
  vars: Record<string, number>,
): string | undefined {
  for (const [name, binding] of Object.entries(bindings)) {
    if (binding.kind === 'constant') {
      vars[name] = binding.value;
      continue;
    }
    const text = (row[binding.index] ?? '').trim();
    const value = toNumber(text);
    if (value === undefined) {
      return `「${name}」绑定的列在这一行不是数字（值：${text === '' ? '空' : text}）`;
    }
    vars[name] = value;
  }
  return undefined;
}

/** 结果写法：整数原样，小数保留 8 位有效数字，避免 0.30000000000000004 */
export function formatValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toPrecision(8)));
}

/** 结果转回 Dataset，方便直接送去出图 */
export function resultToDataset(result: ComputeResult): Dataset {
  return {
    columns: result.columns,
    rows: result.rows,
    delimiter: ',',
    format: 'csv',
    warnings: [],
  };
}
