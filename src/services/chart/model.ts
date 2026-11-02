/**
 * 把「数据集 + 选中的列」变成可以直接画的一堆几何数据。
 *
 * 坐标已经换算成 SVG 像素，视图层只负责画，不做数学 —— 这样模型可以单测。
 * 支持按一列拆成多条序列（同一个 X 对比 pp512 / tg128 这类场景）。
 */

import { areaPath, polylinePath, smoothPath } from './path';
import { toNumber, type Dataset } from './parse';
import { lttb, niceScale, type Point } from './scale';

export type ChartType = 'line' | 'smooth' | 'scatter' | 'bar' | 'area';

export interface ChartOptions {
  xIndex: number;
  yIndex: number;
  /** 可选：按这一列拆成多条序列 */
  groupIndex?: number;
  type: ChartType;
  /** 数值型 X 是否先按 X 排序；不排序就按数据行顺序连线 */
  sortByX: boolean;
  /** 每条序列最多保留多少点 */
  maxPoints: number;
}

export interface ChartPoint extends Point {
  vx: string;
  vy: string;
  series: string;
}

export interface BarModel {
  x: number;
  y: number;
  width: number;
  height: number;
  vx: string;
  vy: string;
  series: string;
}

export interface SeriesModel {
  name: string;
  color: string;
  path?: string;
  area?: string;
  points?: ChartPoint[];
  bars?: BarModel[];
}

export interface ChartModel {
  width: number;
  height: number;
  plot: { left: number; top: number; right: number; bottom: number };
  type: ChartType;
  x: {
    kind: 'number' | 'category';
    title: string;
    ticks: Array<{ value: string; pos: number }>;
  };
  y: {
    title: string;
    ticks: Array<{ value: string; pos: number }>;
  };
  series: SeriesModel[];
  legend: Array<{ name: string; color: string }>;
  meta: {
    source: number;
    used: number;
    dropped: number;
    downsampled: number;
    groups: number;
    note?: string;
  };
}

export const CHART_WIDTH = 900;
export const CHART_HEIGHT = 520;

/** 8 色，明暗主题下都能看清 */
export const SERIES_COLORS = [
  '#3794ff',
  '#d18616',
  '#89d185',
  '#f14c4c',
  '#b180d7',
  '#4ec9b0',
  '#dcdcaa',
  '#ce9178',
];

const MAX_GROUPS = 12;
const OTHER = '其他';

const MARGIN = { left: 74, right: 26, top: 34, bottom: 60 };
const PLOT = {
  left: MARGIN.left,
  top: MARGIN.top,
  right: CHART_WIDTH - MARGIN.right,
  bottom: CHART_HEIGHT - MARGIN.bottom,
};

export type ModelResult = { ok: true; model: ChartModel } | { ok: false; error: string };

const TYPES: readonly ChartType[] = ['line', 'smooth', 'scatter', 'bar', 'area'];

interface Row {
  xText: string;
  xNum?: number;
  y: number;
  yText: string;
  group: string;
}

export function buildChartModel(dataset: Dataset, options: ChartOptions): ModelResult {
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
  const source = dataset.rows.length;
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

  const groups = collectGroups(rows, groupColumn !== undefined);
  const categoryLabels = numericX ? [] : uniqueLabels(rows);

  const xValues = rows.map((row) => (numericX ? (row.xNum as number) : categoryLabels.indexOf(row.xText)));
  const xScale = niceScale(
    numericX ? Math.min(...xValues) : 0,
    numericX ? Math.max(...xValues) : Math.max(categoryLabels.length - 1, 1),
    numericX ? 8 : Math.max(categoryLabels.length, 2),
  );

  const needsZero = options.type === 'bar' || options.type === 'area';
  const yValues = rows.map((row) => row.y);
  const yScale = niceScale(
    Math.min(...yValues, ...(needsZero ? [0] : [])),
    Math.max(...yValues, ...(needsZero ? [0] : [])),
    6,
  );

  const toX = (value: number): number =>
    PLOT.left + ((value - xScale.min) / (xScale.max - xScale.min || 1)) * (PLOT.right - PLOT.left);
  const toY = (value: number): number =>
    PLOT.bottom - ((value - yScale.min) / (yScale.max - yScale.min || 1)) * (PLOT.bottom - PLOT.top);

  const xPosOf = (row: Row): number => {
    if (numericX) {
      return toX(row.xNum as number);
    }
    const index = categoryLabels.indexOf(row.xText);
    const band = (PLOT.right - PLOT.left) / Math.max(categoryLabels.length, 1);
    return PLOT.left + band * (index + 0.5);
  };

  const series: SeriesModel[] = [];
  const legend: ChartModel['legend'] = [];
  let used = 0;
  let downsampled = 0;
  let smoothFellBack = false;

  const groupCount = Math.max(groups.size, 1);
  const band = (PLOT.right - PLOT.left) / Math.max(categoryLabels.length, 1);
  const barWidth = numericX
    ? Math.max(1.5, Math.min(22, (PLOT.right - PLOT.left) / Math.max(rows.length, 1) / groupCount))
    : Math.max(1, (band * 0.8) / groupCount);

  let groupIndex = 0;
  for (const [name, groupRows] of groups) {
    const label = groupColumn ? name : yColumn.name;
    const color = SERIES_COLORS[groupIndex % SERIES_COLORS.length];
    const offset = (groupIndex - (groupCount - 1) / 2) * barWidth;

    let orderedRows: Row[] = groupRows;
    if (numericX && options.sortByX) {
      orderedRows = [...groupRows].sort((left, right) => (left.xNum as number) - (right.xNum as number));
    }

    let sampled: Array<{ row: Row; x: number; y: number }> = orderedRows.map((row) => ({
      row,
      x: numericX ? (row.xNum as number) : 0,
      y: row.y,
    }));

    const originalCount = sampled.length;
    if (options.maxPoints > 0 && originalCount > options.maxPoints) {
      sampled = numericX ? lttb(sampled, options.maxPoints) : stride(sampled, options.maxPoints);
      downsampled += originalCount;
    }
    used += sampled.length;

    const points: ChartPoint[] = sampled.map(({ row }) => ({
      x: round(xPosOf(row) + (options.type === 'bar' ? offset : 0)),
      y: round(toY(row.y)),
      vx: row.xText,
      vy: row.yText,
      series: label,
    }));

    const model: SeriesModel = { name: label, color };
    if (options.type === 'scatter') {
      model.points = points;
    } else if (options.type === 'bar') {
      model.bars = points.map((point) => ({
        x: round(point.x - barWidth / 2),
        y: point.y,
        width: round(barWidth),
        height: round(PLOT.bottom - point.y),
        vx: point.vx,
        vy: point.vy,
        series: label,
      }));
    } else {
      const isSmooth = options.type === 'smooth' && numericX;
      model.path = isSmooth ? smoothPath(points) : polylinePath(points);
      if (isSmooth && !model.path.includes('C')) {
        smoothFellBack = true;
      }
      model.points = points;
      if (options.type === 'area') {
        model.area = areaPath(points, PLOT.bottom);
      }
    }

    series.push(model);
    legend.push({ name: label, color });
    groupIndex += 1;
  }

  const categoryTicks = buildCategoryTicks(categoryLabels, (index) => {
    const bandWidth = (PLOT.right - PLOT.left) / Math.max(categoryLabels.length, 1);
    return PLOT.left + bandWidth * (index + 0.5);
  });

  const note = buildNote({
    dropped,
    downsampled,
    original: source,
    used,
    groups: groups.size,
    smoothFellBack,
  });

  return {
    ok: true,
    model: {
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      plot: PLOT,
      type: options.type,
      x: numericX
        ? {
            kind: 'number',
            title: xColumn.name,
            ticks: xScale.ticks.map((value) => ({ value: formatNumber(value), pos: round(toX(value)) })),
          }
        : { kind: 'category', title: xColumn.name, ticks: categoryTicks },
      y: {
        title: yColumn.name,
        ticks: yScale.ticks.map((value) => ({ value: formatNumber(value), pos: round(toY(value)) })),
      },
      series,
      legend,
      meta: {
        source,
        used,
        dropped,
        downsampled,
        groups: groups.size,
        note,
      },
    },
  };
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

  // 分组太多会把图挤成一团：保留前若干组，其余并进「其他」
  const trimmed = new Map<string, Row[]>();
  let index = 0;
  for (const [key, value] of groups) {
    if (index < MAX_GROUPS - 1) {
      trimmed.set(key, value);
    } else {
      const rest = trimmed.get(OTHER) ?? [];
      trimmed.set(OTHER, rest.concat(value));
    }
    index += 1;
  }
  return trimmed;
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

function buildCategoryTicks(
  labels: string[],
  position: (index: number) => number,
): Array<{ value: string; pos: number }> {
  const step = Math.max(1, Math.ceil(labels.length / 14));
  const ticks: Array<{ value: string; pos: number }> = [];
  for (let index = 0; index < labels.length; index += step) {
    ticks.push({ value: labels[index], pos: round(position(index)) });
  }
  return ticks;
}

function stride<T>(items: readonly T[], limit: number): T[] {
  const step = Math.max(1, Math.ceil(items.length / limit));
  const kept: T[] = [];
  for (let index = 0; index < items.length; index += step) {
    kept.push(items[index]);
  }
  return kept;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildNote(input: {
  dropped: number;
  downsampled: number;
  original: number;
  used: number;
  groups: number;
  smoothFellBack: boolean;
}): string | undefined {
  const parts: string[] = [];
  if (input.dropped > 0) {
    parts.push(`跳过 ${input.dropped} 行（X/Y 为空或不是数字）`);
  }
  if (input.downsampled > 0) {
    parts.push(`降采样：${input.downsampled} → ${input.used} 点`);
  }
  if (input.groups > 1) {
    parts.push(`${input.groups} 条序列`);
  }
  if (input.smoothFellBack) {
    parts.push('部分序列的 X 有重复或乱序，平滑已退回折线');
  }
  return parts.length > 0 ? parts.join('；') : undefined;
}

/** 刻度文字：整数原样，小数保留 4 位有效数字，避免出现 0.30000000000000004 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.001) {
    return value.toExponential(2);
  }
  return String(Number(value.toPrecision(4)));
}
