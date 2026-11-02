/**
 * 把「数据集 + 选中的列」变成可以直接画的一坨几何数据。
 *
 * 坐标已经换算成 SVG 像素，视图层只负责画，不做数学 —— 这样模型可以单测。
 */

import { areaPath, polylinePath, smoothPath } from './path';
import type { Dataset } from './parse';
import { lttb, niceScale, sortByX, type Point } from './scale';

export type ChartType = 'line' | 'smooth' | 'scatter' | 'bar' | 'area';

export interface ChartOptions {
  xIndex: number;
  yIndex: number;
  type: ChartType;
  /** 数值型 X 是否先按 X 排序；不排序就按数据行顺序连线 */
  sortByX: boolean;
  /** 超过就降采样（柱状图按步长抽样） */
  maxPoints: number;
}

export interface ChartPoint extends Point {
  vx: string;
  vy: string;
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
  series: {
    name: string;
    path?: string;
    area?: string;
    points?: ChartPoint[];
    bars?: Array<{ x: number; y: number; width: number; height: number; vx: string; vy: string }>;
  };
  meta: {
    source: number;
    used: number;
    dropped: number;
    downsampled: number;
    note?: string;
  };
}

export const CHART_WIDTH = 900;
export const CHART_HEIGHT = 520;

const MARGIN = { left: 74, right: 26, top: 34, bottom: 60 };
const PLOT = {
  left: MARGIN.left,
  top: MARGIN.top,
  right: CHART_WIDTH - MARGIN.right,
  bottom: CHART_HEIGHT - MARGIN.bottom,
};

export type ModelResult = { ok: true; model: ChartModel } | { ok: false; error: string };

const TYPES: readonly ChartType[] = ['line', 'smooth', 'scatter', 'bar', 'area'];

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

  const numericX = xColumn.kind === 'number';
  const source = dataset.rows.length;
  let dropped = 0;

  const numericPoints: ChartPoint[] = [];
  const categoryPoints: ChartPoint[] = [];

  for (const row of dataset.rows) {
    const yText = (row[options.yIndex] ?? '').trim();
    const y = Number(yText);
    if (yText === '' || !Number.isFinite(y)) {
      dropped += 1;
      continue;
    }

    const xText = (row[options.xIndex] ?? '').trim();
    if (xText === '') {
      dropped += 1;
      continue;
    }

    if (numericX) {
      const x = Number(xText);
      if (!Number.isFinite(x)) {
        dropped += 1;
        continue;
      }
      numericPoints.push({ x, y, vx: xText, vy: yText });
    } else {
      categoryPoints.push({ x: categoryPoints.length, y, vx: xText, vy: yText });
    }
  }

  const usable = numericX ? numericPoints : categoryPoints;
  if (usable.length === 0) {
    return { ok: false, error: '没有可用的数据点：检查 X / Y 列是否选对，以及是否有空值' };
  }

  if (numericX) {
    return buildNumericModel(dataset, options, usable, dropped, source, xColumn.name, yColumn.name);
  }
  return buildCategoryModel(dataset, options, usable, dropped, source, xColumn.name, yColumn.name);
}

function buildNumericModel(
  _dataset: Dataset,
  options: ChartOptions,
  points: ChartPoint[],
  dropped: number,
  source: number,
  xTitle: string,
  yTitle: string,
): ModelResult {
  const ordered = options.sortByX ? sortByX(points) : points;
  const originalCount = ordered.length;

  let used = ordered;
  let downsampled = 0;
  if (options.maxPoints > 0 && originalCount > options.maxPoints) {
    used = lttb(ordered, options.maxPoints);
    downsampled = originalCount;
  }

  const xValues = used.map((point) => point.x);
  const yValues = used.map((point) => point.y);

  const xScale = niceScale(Math.min(...xValues), Math.max(...xValues), 8);
  const needsZero = options.type === 'bar' || options.type === 'area';
  const yMin = Math.min(...yValues, ...(needsZero ? [0] : []));
  const yMax = Math.max(...yValues, ...(needsZero ? [0] : []));
  const yScale = niceScale(yMin, yMax, 6);

  const toX = (value: number): number =>
    PLOT.left + ((value - xScale.min) / (xScale.max - xScale.min || 1)) * (PLOT.right - PLOT.left);
  const toY = (value: number): number =>
    PLOT.bottom - ((value - yScale.min) / (yScale.max - yScale.min || 1)) * (PLOT.bottom - PLOT.top);

  const pixels: ChartPoint[] = used.map((point) => ({
    x: toX(point.x),
    y: toY(point.y),
    vx: point.vx,
    vy: point.vy,
  }));

  const series: ChartModel['series'] = { name: yTitle };
  if (options.type === 'scatter') {
    series.points = pixels;
  } else if (options.type === 'bar') {
    const width = Math.max(1, Math.min(24, (PLOT.right - PLOT.left) / Math.max(used.length, 1) * 0.7));
    series.bars = pixels.map((point) => ({
      x: point.x - width / 2,
      y: point.y,
      width,
      height: PLOT.bottom - point.y,
      vx: point.vx,
      vy: point.vy,
    }));
  } else if (options.type === 'smooth') {
    series.path = smoothPath(pixels);
    series.points = pixels;
  } else {    series.path = polylinePath(pixels);
    series.points = pixels;
    if (options.type === 'area') {
      series.area = areaPath(pixels, PLOT.bottom);
    }
  }

  return {
    ok: true,
    model: {
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      plot: PLOT,
      type: options.type,
      x: {
        kind: 'number',
        title: xTitle,
        ticks: xScale.ticks.map((value) => ({ value: formatNumber(value), pos: toX(value) })),
      },
      y: {
        title: yTitle,
        ticks: yScale.ticks.map((value) => ({ value: formatNumber(value), pos: toY(value) })),
      },
      series,
      meta: {
        source,
        used: used.length,
        dropped,
        downsampled,
        note: withSmoothFallback(
          buildNote(dropped, downsampled, originalCount, used.length),
          options.type === 'smooth' && series.path !== undefined && !series.path.includes('C'),
        ),
      },
    },
  };
}

function buildCategoryModel(
  _dataset: Dataset,
  options: ChartOptions,
  points: ChartPoint[],
  dropped: number,
  source: number,
  xTitle: string,
  yTitle: string,
): ModelResult {
  const originalCount = points.length;
  const step = options.maxPoints > 0 ? Math.ceil(originalCount / options.maxPoints) : 1;
  const kept = step > 1 ? points.filter((_, index) => index % step === 0) : points;
  const downsampled = step > 1 ? originalCount : 0;

  const yValues = kept.map((point) => point.y);
  const needsZero = options.type === 'bar' || options.type === 'area';
  const yScale = niceScale(
    Math.min(...yValues, ...(needsZero ? [0] : [])),
    Math.max(...yValues, ...(needsZero ? [0] : [])),
    6,
  );

  const band = (PLOT.right - PLOT.left) / Math.max(kept.length, 1);
  const toX = (index: number): number => PLOT.left + band * (index + 0.5);
  const toY = (value: number): number =>
    PLOT.bottom - ((value - yScale.min) / (yScale.max - yScale.min || 1)) * (PLOT.bottom - PLOT.top);

  const pixels: ChartPoint[] = kept.map((point, index) => ({
    x: toX(index),
    y: toY(point.y),
    vx: point.vx,
    vy: point.vy,
  }));

  const series: ChartModel['series'] = { name: yTitle };
  if (options.type === 'bar') {
    const width = Math.max(1, band * 0.66);
    series.bars = pixels.map((point) => ({
      x: point.x - width / 2,
      y: point.y,
      width,
      height: PLOT.bottom - point.y,
      vx: point.vx,
      vy: point.vy,
    }));
  } else if (options.type === 'scatter') {
    series.points = pixels;
  } else {
    // 分类轴不做平滑插值：标签之间没有"中间值"这回事
    series.path = polylinePath(pixels);
    series.points = pixels;
    if (options.type === 'area') {
      series.area = areaPath(pixels, PLOT.bottom);
    }
  }

  const labelStep = Math.max(1, Math.ceil(kept.length / 14));
  const ticks = pixels
    .map((point, index) => ({ value: point.vx, pos: point.x, index }))
    .filter((tick) => tick.index % labelStep === 0)
    .map((tick) => ({ value: tick.value, pos: tick.pos }));

  return {
    ok: true,
    model: {
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      plot: PLOT,
      type: options.type,
      x: { kind: 'category', title: xTitle, ticks },
      y: {
        title: yTitle,
        ticks: yScale.ticks.map((value) => ({ value: formatNumber(value), pos: toY(value) })),
      },
      series,
      meta: {
        source,
        used: kept.length,
        dropped,
        downsampled,
        note: buildNote(dropped, downsampled, originalCount, kept.length),
      },
    },
  };
}

function buildNote(dropped: number, downsampled: number, original: number, used: number): string | undefined {
  const parts: string[] = [];
  if (dropped > 0) {
    parts.push(`跳过 ${dropped} 行（X/Y 为空或不是数字）`);
  }
  if (downsampled > 0) {
    parts.push(`降采样：${original} → ${used} 点`);
  }
  return parts.length > 0 ? parts.join('；') : undefined;
}

/** 平滑需要 X 严格递增；有重复或乱序时退回折线，并在说明里讲清楚 */
function withSmoothFallback(note: string | undefined, fellBack: boolean): string | undefined {
  if (!fellBack) {
    return note;
  }
  const extra = 'X 有重复或乱序，平滑曲线已退回折线';
  return note ? `${note}；${extra}` : extra;
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
