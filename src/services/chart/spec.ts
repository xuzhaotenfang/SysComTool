/**
 * 出图用的「数据空间」模型：只做选列、过滤、分组、排序，不算像素。
 *
 * 面板里预览（SVG）和 Python 导出（matplotlib）都用它 —— 保证「看到的就是导出的」。
 */

import { toNumber, type Dataset } from './parse';
import type { ChartOptions, ChartType } from './model';

export interface SpecPoint {
  /** 数值轴是数字；分类轴是分类标签 */
  x: number | string;
  y: number;
  xLabel: string;
  yLabel: string;
}

export interface SpecSeries {
  name: string;
  points: SpecPoint[];
}

export interface ChartSpec {
  type: ChartType;
  xKind: 'number' | 'category';
  xLabel: string;
  yLabel: string;
  /** 分类轴的顺序（只在 xKind === 'category' 时有意义） */
  categories: string[];
  series: SpecSeries[];
  meta: {
    rows: number;
    used: number;
    dropped: number;
    groups: number;
  };
}

export type SpecResult = { ok: true; spec: ChartSpec } | { ok: false; error: string };

const TYPES: readonly ChartType[] = ['line', 'smooth', 'scatter', 'bar', 'area'];
const MAX_GROUPS = 12;
const OTHER = '其他';

interface Row {
  xText: string;
  xNum?: number;
  y: number;
  yText: string;
  group: string;
}

export function buildChartSpec(dataset: Dataset, options: ChartOptions): SpecResult {
  const xColumn = dataset.columns[options.xIndex];
  const yColumn = dataset.columns[options.yIndex];

  if (!xColumn || !yColumn) {
    return { ok: false, error: 'X / Y 列选错了：请重新选择' };
  }
  if (yColumn.kind !== 'number') {
    return { ok: false, error: `Y 必须选数值列，「${yColumn.name}」不是数值` };
  }
  if (!TYPES.includes(options.type)) {
    return { ok: false, error: `不认识的图型「${options.type}」` };
  }

  const groupColumn =
    options.groupIndex !== undefined && options.groupIndex >= 0
      ? dataset.columns[options.groupIndex]
      : undefined;

  const numericX = xColumn.kind === 'number';
  const rows: Row[] = [];
  let dropped = 0;

  for (const row of dataset.rows) {
    const yText = (row[options.yIndex] ?? '').trim();
    const y = toNumber(yText);
    if (y === undefined) {
      dropped += 1;
      continue;
    }

    const xText = (row[options.xIndex] ?? '').trim();
    if (xText === '') {
      dropped += 1;
      continue;
    }

    let xNum: number | undefined;
    if (numericX) {
      xNum = toNumber(xText);
      if (xNum === undefined) {
        dropped += 1;
        continue;
      }
    }

    const group = groupColumn ? ((row[options.groupIndex as number] ?? '').trim() || '(空)') : '';
    rows.push({ xText, xNum, y, yText, group });
  }

  if (rows.length === 0) {
    return { ok: false, error: '没有可用的数据点：检查 X / Y 列是否选对，以及是否有空值' };
  }

  const categories = numericX ? [] : uniqueLabels(rows);
  const groups = collectGroups(rows, groupColumn !== undefined);

  const series: SpecSeries[] = [];
  let used = 0;

  for (const [name, groupRows] of groups) {
    let ordered = groupRows;
    if (numericX && options.sortByX) {
      ordered = [...groupRows].sort((left, right) => (left.xNum as number) - (right.xNum as number));
    }

    const points: SpecPoint[] = ordered.map((row) => ({
      x: numericX ? (row.xNum as number) : row.xText,
      y: row.y,
      xLabel: row.xText,
      yLabel: row.yText,
    }));

    used += points.length;
    series.push({ name: groupColumn ? name : yColumn.name, points });
  }

  return {
    ok: true,
    spec: {
      type: options.type,
      xKind: numericX ? 'number' : 'category',
      xLabel: xColumn.name,
      yLabel: yColumn.name,
      categories,
      series,
      meta: {
        rows: dataset.rows.length,
        used,
        dropped,
        groups: groups.size,
      },
    },
  };
}

function uniqueLabels(rows: Row[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const row of rows) {
    if (!seen.has(row.xText)) {
      seen.add(row.xText);
      labels.push(row.xText);
    }
  }
  return labels;
}

function collectGroups(rows: Row[], grouped: boolean): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = grouped ? row.group : '';
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  if (groups.size <= MAX_GROUPS) {
    return groups;
  }

  const trimmed = new Map<string, Row[]>();
  let index = 0;
  for (const [key, value] of groups) {
    if (index < MAX_GROUPS - 1) {
      trimmed.set(key, value);
    } else {
      trimmed.set(OTHER, (trimmed.get(OTHER) ?? []).concat(value));
    }
    index += 1;
  }
  return trimmed;
}
