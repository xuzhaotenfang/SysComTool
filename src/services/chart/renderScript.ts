/**
 * 导出图片用的 matplotlib 脚本。
 *
 * 这是一个固定模板：数据通过 argv 传进来的 JSON 文件，脚本里没有任何拼接的用户输入。
 * 注意：这里是 Python 代码，不是模板字符串插值 —— 别往里面加 `${...}`。
 */
export const RENDER_SCRIPT = String.raw`
import json
import sys

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager


def set_cjk_font():
    available = {font.name for font in font_manager.fontManager.ttflist}
    for name in (
        "Microsoft YaHei",
        "SimHei",
        "Noto Sans CJK SC",
        "Source Han Sans SC",
        "WenQuanYi Zen Hei",
        "Arial Unicode MS",
    ):
        if name in available:
            plt.rcParams["font.sans-serif"] = [name, "DejaVu Sans"]
            break
    plt.rcParams["axes.unicode_minus"] = False


def monotone_curve(x, y, samples=400):
    h = np.diff(x).astype(float)
    if np.any(h <= 0):
        return x, y

    delta = np.diff(y) / h
    n = len(x)
    d = np.zeros(n)
    if n == 2:
        d[:] = delta[0]
    else:
        d[0] = delta[0]
        d[-1] = delta[-1]
        for i in range(1, n - 1):
            if delta[i - 1] * delta[i] <= 0:
                d[i] = 0.0
            else:
                w1 = 2 * h[i] + h[i - 1]
                w2 = h[i] + 2 * h[i - 1]
                d[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i])

    xx = np.linspace(x[0], x[-1], samples)
    idx = np.clip(np.searchsorted(x, xx, side="right") - 1, 0, n - 2)
    t = (xx - x[idx]) / h[idx]
    t2 = t * t
    t3 = t2 * t
    yy = (
        (2 * t3 - 3 * t2 + 1) * y[idx]
        + (t3 - 2 * t2 + t) * h[idx] * d[idx]
        + (-2 * t3 + 3 * t2) * y[idx + 1]
        + (t3 - t2) * h[idx] * d[idx + 1]
    )
    return xx, yy


def main():
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        spec = json.load(handle)
    out_path = sys.argv[2]

    set_cjk_font()

    fig, ax = plt.subplots(figsize=(9.6, 5.4), dpi=160)
    palette = plt.rcParams["axes.prop_cycle"].by_key()["color"]

    kind = spec["xKind"]
    categories = spec["categories"]
    chart = spec["type"]
    group_count = max(len(spec["series"]), 1)

    for index, series in enumerate(spec["series"]):
        points = series["points"]
        color = palette[index % len(palette)]
        xs = np.array([p["x"] for p in points], dtype=float)
        ys = np.array([p["y"] for p in points], dtype=float)

        if kind == "category":
            positions = np.array([categories.index(p["x"]) for p in points], dtype=float)
        else:
            positions = xs

        if chart == "bar":
            width = 0.8 / group_count
            offset = (index - (group_count - 1) / 2) * width
            ax.bar(positions + offset, ys, width=width, color=color, label=series["name"])
        elif chart == "scatter":
            ax.scatter(positions, ys, s=16, color=color, label=series["name"], alpha=0.9)
        else:
            if chart == "smooth" and kind == "number" and len(xs) >= 3:
                curve_x, curve_y = monotone_curve(xs, ys)
            else:
                curve_x, curve_y = positions, ys
            if chart == "area":
                ax.fill_between(curve_x, curve_y, 0, color=color, alpha=0.18)
            ax.plot(curve_x, curve_y, color=color, linewidth=1.8, label=series["name"])

    ax.set_xlabel(spec["xLabel"])
    ax.set_ylabel(spec["yLabel"])
    ax.grid(axis="y", color="0.85", linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)

    if kind == "category":
        ax.set_xticks(range(len(categories)))
        rotation = 30 if len(categories) > 6 else 0
        ax.set_xticklabels(
            categories,
            rotation=rotation,
            ha="right" if rotation else "center",
        )
        if chart in ("line", "smooth", "area"):
            ax.set_xlim(-0.6, len(categories) - 0.4)

    if len(spec["series"]) > 1:
        ax.legend(frameon=False)

    fig.tight_layout()
    fig.savefig(out_path, bbox_inches="tight")
    print(out_path)


if __name__ == "__main__":
    main()
`;
