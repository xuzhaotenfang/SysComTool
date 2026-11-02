/** 生成 SVG path 数据（已经是像素坐标）。纯函数，方便单测。 */

import type { Point } from './scale';

function fmt(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 折线：按点顺序直连，不假设 x 单调 */
export function polylinePath(points: readonly Point[]): string {
  if (points.length === 0) {
    return '';
  }
  const head = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  if (points.length === 1) {
    return head;
  }
  const rest = points.slice(1).map((point) => `L ${fmt(point.x)} ${fmt(point.y)}`);
  return [head, ...rest].join(' ');
}

/**
 * 平滑曲线：单调三次插值（Fritsch–Carlson）。
 *
 * 只对 x 严格递增的序列生效 —— 否则退回折线，
 * 因为「按数据顺序连线」本身就不构成函数，硬插值会画出假的振荡。
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length < 3) {
    return polylinePath(points);
  }

  const n = points.length;
  const xs = points.map((point) => point.x);
  for (let index = 1; index < n; index += 1) {
    if (xs[index] <= xs[index - 1]) {
      return polylinePath(points);
    }
  }

  const dx: number[] = [];
  const slope: number[] = [];
  for (let index = 0; index < n - 1; index += 1) {
    dx[index] = xs[index + 1] - xs[index];
    slope[index] = (points[index + 1].y - points[index].y) / dx[index];
  }

  const tangent: number[] = new Array(n).fill(0);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let index = 1; index < n - 1; index += 1) {
    tangent[index] = slope[index - 1] * slope[index] <= 0 ? 0 : (slope[index - 1] + slope[index]) / 2;
  }

  for (let index = 0; index < n - 1; index += 1) {
    if (slope[index] === 0) {
      tangent[index] = 0;
      tangent[index + 1] = 0;
      continue;
    }
    const a = tangent[index] / slope[index];
    const b = tangent[index + 1] / slope[index];
    const norm = a * a + b * b;
    if (norm > 9) {
      const scale = 3 / Math.sqrt(norm);
      tangent[index] = scale * a * slope[index];
      tangent[index + 1] = scale * b * slope[index];
    }
  }

  let path = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let index = 0; index < n - 1; index += 1) {
    const x0 = xs[index];
    const y0 = points[index].y;
    const x1 = xs[index + 1];
    const y1 = points[index + 1].y;
    const third = dx[index] / 3;

    const c1x = x0 + third;
    const c1y = y0 + tangent[index] * third;
    const c2x = x1 - third;
    const c2y = y1 - tangent[index + 1] * third;

    path += ` C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(x1)} ${fmt(y1)}`;
  }
  return path;
}

/** 面积图：折线 + 回到基线闭合 */
export function areaPath(points: readonly Point[], baselineY: number): string {
  if (points.length < 2) {
    return '';
  }
  const line = polylinePath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L ${fmt(last.x)} ${fmt(baselineY)} L ${fmt(first.x)} ${fmt(baselineY)} Z`;
}
