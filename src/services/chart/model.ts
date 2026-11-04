/**
 * 把「数据集 + 选中的列」变成可以直接画的几何数据（像素坐标）。
 *
 * 选列、过滤、分组、排序全部交给 `spec.ts`，这里只负责换算成像素、降采样和刻度 ——
 * 这样面板预览（SVG）和 Python 导出（matplotlib）用的是同一份数据。
 */

import { areaPath, polylinePath, smoothPath } from './path';
import type { Dataset } from './parse';
import { lttb, niceScale, type Point } from './scale';
import { buildChartSpec } from './spec';

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

const MARGIN = { left: 74, right: 26, top: 34, bottom: 60 };
const PLOT = {
  left: MARGIN.left,
  top: MARGIN.top,
  right: CHART_WIDTH - MARGIN.right,
  bottom: CHART_HEIGHT - MARGIN.bottom,
};

export type ModelResult = { ok: true; model: ChartModel } | { ok: false; error: string };

export function buildChartModel(dataset: Dataset, options: ChartOptions): ModelResult {
  const specResult = buildChartSpec(dataset, options);
  if (!specResult.ok) {
    return specResult;
  }
  const spec = specResult.spec;
  const numericX = spec.xKind === 'number';
  const categoryCount = Math.max(spec.categories.length, 1);

  const allY = spec.series.flatMap((line) => line.points.map((point) => point.y));
  const needsZero = options.type === 'bar' || options.type === 'area';
  const yScale = niceScale(
    Math.min(...allY, ...(needsZero ? [0] : [])),
    Math.max(...allY, ...(needsZero ? [0] : [])),
    6,
  );

  const xNumbers = numericX
    ? spec.series.flatMap((line) => line.points.map((point) => point.x as number))
    : [];
  const xScale = niceScale(
    numericX ? Math.min(...xNumbers) : 0,
    numericX ? Math.max(...xNumbers) : Math.max(categoryCount - 1, 1),
    numericX ? 8 : categoryCount,
  );

  const toX = (value: number): number =>
    PLOT.left + ((value - xScale.min) / (xScale.max - xScale.min || 1)) * (PLOT.right - PLOT.left);
  const toY = (value: number): number =>
    PLOT.bottom - ((value - yScale.min) / (yScale.max - yScale.min || 1)) * (PLOT.bottom - PLOT.top);

  const band = (PLOT.right - PLOT.left) / categoryCount;
  const categoryX = (label: string): number => {
    const index = spec.categories.indexOf(label);
    return PLOT.left + band * (Math.max(index, 0) + 0.5);
  };

  const groupCount = Math.max(spec.series.length, 1);
  const barWidth = numericX
    ? Math.max(1.5, Math.min(22, (PLOT.right - PLOT.left) / Math.max(spec.meta.used, 1) / groupCount))
    : Math.max(1, (band * 0.8) / groupCount);

  const series: SeriesModel[] = [];
  const legend: ChartModel['legend'] = [];
  let used = 0;
  let downsampled = 0;
  let smoothFellBack = false;

  spec.series.forEach((line, lineIndex) => {
    const color = SERIES_COLORS[lineIndex % SERIES_COLORS.length];
    const offset = (lineIndex - (groupCount - 1) / 2) * barWidth;

    const raw = line.points.map((point) => ({ x: point.x, y: point.y, label: point }));

    let sampled: Array<{ x: string | number; y: number; label: (typeof raw)[number]['label'] }> = raw;
    const originalCount = raw.length;
    if (options.maxPoints > 0 && originalCount > options.maxPoints) {
      if (numericX) {
        const numeric = raw.map((entry) => ({ x: entry.x as number, y: entry.y, label: entry.label }));
        sampled = lttb(numeric, options.maxPoints);
      } else {
        sampled = stride(raw, options.maxPoints);
      }
      downsampled += originalCount;
    }
    used += sampled.length;

    const points: ChartPoint[] = sampled.map((entry) => ({
      x: round(
        (numericX ? toX(entry.x as number) : categoryX(entry.label.x as string)) +
          (options.type === 'bar' ? offset : 0),
      ),
      y: round(toY(entry.y)),
      vx: entry.label.xLabel,
      vy: entry.label.yLabel,
      series: line.name,
    }));

    const model: SeriesModel = { name: line.name, color };
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
        series: line.name,
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
    legend.push({ name: line.name, color });
  });

  const labelStep = Math.max(1, Math.ceil(categoryCount / 14));
  const categoryTicks = numericX
    ? []
    : spec.categories
        .map((label, index) => ({ value: label, index, pos: round(PLOT.left + band * (index + 0.5)) }))
        .filter((tick) => tick.index % labelStep === 0)
        .map((tick) => ({ value: tick.value, pos: tick.pos }));

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
            title: spec.xLabel,
            ticks: xScale.ticks.map((value) => ({ value: formatNumber(value), pos: round(toX(value)) })),
          }
        : { kind: 'category', title: spec.xLabel, ticks: categoryTicks },
      y: {
        title: spec.yLabel,
        ticks: yScale.ticks.map((value) => ({ value: formatNumber(value), pos: round(toY(value)) })),
      },
      series,
      legend,
      meta: {
        source: spec.meta.rows,
        used,
        dropped: spec.meta.dropped,
        downsampled,
        groups: spec.meta.groups,
        note: buildNote({
          dropped: spec.meta.dropped,
          downsampled,
          used: used,
          groups: spec.meta.groups,
          smoothFellBack,
        }),
      },
    },
  };
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
