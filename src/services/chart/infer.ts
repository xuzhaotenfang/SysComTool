/** 根据数据猜一组默认的 X / Y / 分组列，省得每次手动选。纯函数。 */

import type { Dataset } from './parse';

export interface DefaultSelection {
  xIndex: number;
  yIndex: number;
  groupIndex: number | null;
}

const MAX_GROUP_CANDIDATES = 12;
const DISTINCT_CAP = 50;

/**
 * - X：第一个「真正在变」的数值列（不同值 ≥ 2），跳过 size 这种整列同值的列；
 * - Y：最后一个在变的数值列（通常是测量结果）；
 * - 分组：取值 2..12 种的文本列，比如 llama-bench 的 test（pp512 / tg128）。
 */
export function inferDefaults(dataset: Dataset): DefaultSelection {
  const distinct = dataset.columns.map((_, index) => countDistinct(dataset, index, DISTINCT_CAP));
  const numeric = dataset.columns
    .map((column, index) => ({ column, index }))
    .filter((entry) => entry.column.kind === 'number');

  const varying = numeric.filter((entry) => distinct[entry.index] >= 2);
  const xEntry = varying[0] ?? numeric[0];
  const xIndex = xEntry?.index ?? 0;

  const yEntry =
    [...varying].reverse().find((entry) => entry.index !== xIndex) ??
    [...numeric].reverse().find((entry) => entry.index !== xIndex) ??
    numeric[0];
  const yIndex = yEntry?.index ?? Math.min(1, dataset.columns.length - 1);

  const groupEntry = dataset.columns
    .map((column, index) => ({ column, index }))
    .find(
      (entry) =>
        entry.column.kind === 'string' &&
        entry.index !== xIndex &&
        entry.index !== yIndex &&
        distinct[entry.index] >= 2 &&
        distinct[entry.index] <= MAX_GROUP_CANDIDATES,
    );

  return { xIndex, yIndex, groupIndex: groupEntry?.index ?? null };
}

export function countDistinct(dataset: Dataset, columnIndex: number, cap = DISTINCT_CAP): number {
  const seen = new Set<string>();
  for (const row of dataset.rows) {
    const value = (row[columnIndex] ?? '').trim();
    if (value === '') {
      continue;
    }
    seen.add(value);
    if (seen.size > cap) {
      return seen.size;
    }
  }
  return seen.size;
}
