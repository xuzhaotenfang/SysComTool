/** 坐标轴刻度与大数据降采样。纯函数。 */

export interface Point {
  x: number;
  y: number;
}

export interface AxisScale {
  min: number;
  max: number;
  ticks: number[];
}

/** 把任意数字「取整」到 1/2/5 × 10^n */
export function niceNumber(value: number, round: boolean): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;

  let nice: number;
  if (round) {
    nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  } else {
    nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  }
  return nice * 10 ** exponent;
}

/** 生成「整齐」的刻度，覆盖 [min, max] */
export function niceScale(min: number, max: number, targetTicks = 6): AxisScale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1, ticks: [0, 1] };
  }

  let low = Math.min(min, max);
  let high = Math.max(min, max);

  if (low === high) {
    const pad = Math.abs(low) > 0 ? Math.abs(low) * 0.1 : 1;
    low -= pad;
    high += pad;
  }

  const step = niceNumber(niceNumber(high - low, false) / Math.max(1, targetTicks - 1), true);
  const niceMin = Math.floor(low / step) * step;
  const niceMax = Math.ceil(high / step) * step;

  const ticks: number[] = [];
  const count = Math.round((niceMax - niceMin) / step);
  for (let index = 0; index <= count && ticks.length < 120; index += 1) {
    ticks.push(roundTick(niceMin + index * step));
  }

  return { min: niceMin, max: niceMax, ticks };
}

export function roundTick(value: number): number {
  return Math.round(value * 1e10) / 1e10;
}

/** Largest-Triangle-Three-Buckets：保形降采样，折线图用它不会丢峰谷 */
export function lttb<T extends Point>(points: readonly T[], threshold: number): T[] {
  const length = points.length;
  if (threshold >= length || threshold < 3) {
    return [...points];
  }

  const sampled: T[] = [points[0]];
  const every = (length - 2) / (threshold - 2);
  let anchor = 0;

  for (let bucket = 0; bucket < threshold - 2; bucket += 1) {
    const avgStart = Math.floor((bucket + 1) * every) + 1;
    const avgEnd = Math.min(Math.floor((bucket + 2) * every) + 1, length);

    let avgX = 0;
    let avgY = 0;
    let avgCount = 0;
    for (let index = avgStart; index < avgEnd; index += 1) {
      avgX += points[index].x;
      avgY += points[index].y;
      avgCount += 1;
    }
    if (avgCount === 0) {
      avgX = points[length - 1].x;
      avgY = points[length - 1].y;
    } else {
      avgX /= avgCount;
      avgY /= avgCount;
    }

    const start = Math.floor(bucket * every) + 1;
    const end = Math.min(Math.floor((bucket + 1) * every) + 1, length);

    const pointA = points[anchor];
    let maxArea = -1;
    let chosen = start;
    for (let index = start; index < end; index += 1) {
      const area =
        Math.abs(
          (pointA.x - avgX) * (points[index].y - pointA.y) -
            (pointA.x - points[index].x) * (avgY - pointA.y),
        ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        chosen = index;
      }
    }

    sampled.push(points[chosen]);
    anchor = chosen;
  }

  sampled.push(points[length - 1]);
  return sampled;
}

export function sortByX<T extends Point>(points: readonly T[]): T[] {
  return [...points].sort((left, right) => left.x - right.x);
}
