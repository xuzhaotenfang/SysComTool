import type * as vscode from 'vscode';
import { baseCss, contentSecurityPolicy } from './webview';

export interface ChartPanelState {
  columns: Array<{ name: string; kind: 'number' | 'string' }>;
  preview: string[][];
  total: number;
  format: string;
  warnings: string[];
  options: {
    xIndex: number;
    yIndex: number;
    type: string;
    sortByX: boolean;
    maxPoints: number;
  };
}

const SAMPLE = `模型,量化,线程,内存MB,tok/s
Qwen2.5-72B,Q4_K_M,8,43000,4.2
Qwen2.5-72B,Q4_K_M,16,43000,6.8
Qwen2.5-72B,Q4_K_M,24,43000,7.9
Qwen2.5-72B,Q2_K,8,24000,5.1
Qwen2.5-72B,Q2_K,16,24000,8.4
Qwen2.5-72B,Q2_K,24,24000,9.6
Qwen3-30B-A3B,Q4_K_M,8,18000,18.5
Qwen3-30B-A3B,Q4_K_M,16,18000,27.3
Qwen3-30B-A3B,Q4_K_M,24,18000,31.2
Qwen3-30B-A3B,Q2_K,8,10500,22.1
Qwen3-30B-A3B,Q2_K,16,10500,33.8
Qwen3-30B-A3B,Q2_K,24,10500,37.4
Qwen3-Next-80B-A3B,Q4_K_M,8,46000,3.1
Qwen3-Next-80B-A3B,Q4_K_M,16,46000,5.4
Qwen3-Next-80B-A3B,Q4_K_M,24,46000,6.6
Qwen3-Next-80B-A3B,Q2_K,8,26000,4.0
Qwen3-Next-80B-A3B,Q2_K,16,26000,7.2
Qwen3-Next-80B-A3B,Q2_K,24,26000,8.1`;

export function sampleDataset(): string {
  return SAMPLE;
}

/** 数据出图面板：左侧栏/命令面板打开，一个自变量 + 一个因变量。 */
export function renderChartHtml(
  webview: vscode.Webview,
  state: ChartPanelState | undefined,
  nonce: string,
): string {
  const initial = JSON.stringify(state ?? null).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(webview, nonce)}" />
<style>
${baseCss()}
body { padding: 14px 18px 40px; max-width: 1180px; }
h1 { margin: 0 0 4px; font-size: 1.25em; font-weight: 600; }
header .hint { margin-bottom: 14px; }
.card {
  margin: 0 0 12px; padding: 10px 12px; border-radius: 6px;
  border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
}
.card-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-bottom: 8px; font-weight: 600;
}
.card-head .actions { display: flex; gap: 6px; align-items: center; }
textarea { min-height: 88px; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; }
.row { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.row label { display: flex; flex-direction: column; gap: 3px; min-width: 150px; }
.row label span { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
.row .grow { flex: 1; }
.table-wrap { max-height: 210px; overflow: auto; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); border-radius: 4px; }
table { border-collapse: collapse; font-size: 0.88em; width: 100%; }
th, td { padding: 2px 8px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.15)); white-space: nowrap; }
th { position: sticky; top: 0; background: var(--vscode-editorWidget-background, rgba(128,128,128,.12)); }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.summary { margin-top: 8px; }
.warnings { margin: 6px 0 0; padding-left: 18px; color: var(--vscode-editorWarning-foreground, #cca700); font-size: 0.9em; }
.chart-box { position: relative; }
svg.chart { width: 100%; height: auto; display: block; }
.grid-line { stroke: var(--vscode-editorWidget-border, rgba(128,128,128,.25)); stroke-width: 1; }
.axis-line { stroke: var(--vscode-descriptionForeground, #999); stroke-width: 1.2; }
.tick-text { fill: var(--vscode-descriptionForeground, #999); font-size: 12px; }
.axis-title { fill: var(--vscode-foreground, #ccc); font-size: 13px; font-weight: 500; }
.series-line { fill: none; stroke: var(--vscode-charts-blue, #3794ff); stroke-width: 2; }
.series-area { fill: var(--vscode-charts-blue, #3794ff); opacity: 0.18; stroke: none; }
.series-dot { fill: var(--vscode-charts-blue, #3794ff); }
.series-bar { fill: var(--vscode-charts-blue, #3794ff); opacity: 0.85; }
.tooltip {
  position: absolute; pointer-events: none; display: none; z-index: 5;
  padding: 4px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap;
  background: var(--vscode-editorHoverWidget-background, #252526);
  color: var(--vscode-editorHoverWidget-foreground, #ccc);
  border: 1px solid var(--vscode-editorHoverWidget-border, rgba(128,128,128,.4));
}
.empty { color: var(--vscode-descriptionForeground); padding: 10px 0; }
.meta-line { margin-top: 6px; }
</style>
</head>
<body>
<header>
  <h1>数据出图</h1>
  <div class="hint meta">CSV / Markdown 表格 / 直接粘贴都行。选一个自变量（X）和一个因变量（Y），
  然后挑图型；图不要求 X 单调，也可以按分类画柱状。</div>
</header>

<section class="card">
  <div class="card-head">
    <span>1. 数据</span>
    <div class="actions">
      <button id="openFile">打开文件…</button>
      <button id="sample" class="ghost">示例数据</button>
      <button id="clear" class="ghost">清空</button>
    </div>
  </div>
  <textarea id="text" placeholder="把 CSV 或 Markdown 表格粘贴到这里，例如：&#10;model,threads,tok/s&#10;qwen,8,12.4&#10;qwen,16,21.7"></textarea>
  <div class="row" style="margin-top: 8px">
    <button id="parse" class="primary">解析粘贴内容</button>
    <span class="meta" id="sourceInfo">还没有数据</span>
  </div>
  <div id="preview"></div>
  <div id="warnings"></div>
</section>

<section class="card" id="mappingCard" hidden>
  <div class="card-head"><span>2. 选列与图型</span><span class="meta">Y 只能选数值列</span></div>
  <div class="row">
    <label><span>自变量 X</span><select id="xSelect"></select></label>
    <label><span>因变量 Y</span><select id="ySelect"></select></label>
    <label><span>图型</span>
      <select id="typeSelect">
        <option value="line">折线</option>
        <option value="smooth">平滑曲线</option>
        <option value="scatter">散点</option>
        <option value="bar">柱状</option>
        <option value="area">面积</option>
      </select>
    </label>
    <label class="grow"><span>选项</span>
      <span style="display: flex; gap: 12px; align-items: center">
        <label style="flex-direction: row; min-width: 0; align-items: center; gap: 6px">
          <input id="sortByX" type="checkbox" style="width: auto" /> 按 X 排序
        </label>
        <span class="meta">超过 <b id="maxPoints">3000</b> 点自动降采样</span>
      </span>
    </label>
  </div>
</section>

<section class="card" id="chartCard" hidden>
  <div class="card-head">
    <span>3. 图</span>
    <div class="actions">
      <button id="copySvg" class="ghost">复制 SVG</button>
      <button id="saveSvg" class="ghost">保存 SVG</button>
      <button id="saveCsv" class="ghost">导出数据 CSV</button>
    </div>
  </div>
  <div class="chart-box" id="chartBox">
    <svg class="chart" id="chart" viewBox="0 0 900 520" preserveAspectRatio="xMidYMid meet"></svg>
    <div class="tooltip" id="tooltip"></div>
  </div>
  <div class="meta meta-line" id="chartMeta"></div>
</section>

<script id="initial" type="application/json">${initial}</script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const initial = JSON.parse(document.getElementById('initial').textContent);
const $ = (id) => document.getElementById(id);
let model = null;
let hoverPoints = [];

function requestRender() {
  vscode.postMessage({ type: 'render', options: collectOptions() });
}

function collectOptions() {
  return {
    xIndex: Number($('xSelect').value),
    yIndex: Number($('ySelect').value),
    type: $('typeSelect').value,
    sortByX: $('sortByX').checked,
  };
}

function fillSelect(select, columns, kinds, keep) {
  const previous = keep !== undefined ? keep : Number(select.value);
  select.replaceChildren();
  columns.forEach((column, index) => {
    if (kinds && !kinds.includes(column.kind)) return;
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = column.name + (column.kind === 'number' ? '  #' : '');
    select.appendChild(option);
  });
  const values = [...select.options].map((option) => Number(option.value));
  if (values.includes(previous)) select.value = String(previous);
}

function applyDataset(state) {
  $('sourceInfo').textContent =
    state.total + ' 行 · ' + state.columns.length + ' 列 · ' + state.format;
  $('preview').replaceChildren(buildTable(state));
  const warnings = $('warnings');
  warnings.replaceChildren();
  if (state.warnings.length) {
    for (const text of state.warnings) {
      const li = document.createElement('li');
      li.textContent = text;
      warnings.appendChild(li);
    }
    warnings.className = 'warnings';
  }

  fillSelect($('xSelect'), state.columns, null, state.options.xIndex);
  fillSelect($('ySelect'), state.columns, ['number'], state.options.yIndex);
  $('typeSelect').value = state.options.type;
  $('sortByX').checked = state.options.sortByX;
  $('maxPoints').textContent = String(state.options.maxPoints);
  $('mappingCard').hidden = false;
  $('chartCard').hidden = false;
  requestRender();
}

function buildTable(state) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const column of state.columns) {
    const th = document.createElement('th');
    th.textContent = column.name;
    if (column.kind === 'number') th.title = '数值列';
    head.appendChild(th);
  }
  table.appendChild(head);

  state.preview.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');
    row.forEach((cell, columnIndex) => {
      const td = document.createElement('td');
      td.textContent = cell;
      if (state.columns[columnIndex] && state.columns[columnIndex].kind === 'number') td.className = 'num';
      tr.appendChild(td);
    });
    if (rowIndex === 0) tr.style.opacity = '1';
    table.appendChild(tr);
  });

  wrap.appendChild(table);
  const note = document.createElement('div');
  note.className = 'meta summary';
  note.textContent = '预览前 ' + state.preview.length + ' 行，共 ' + state.total + ' 行';
  wrap.appendChild(note);
  return wrap;
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSvg(drawing) {
  const { width, height, plot, x, y, series, type } = drawing;
  const parts = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" id="chart" viewBox="0 0 ' + width + ' ' + height + '" class="chart">');

  for (const tick of y.ticks) {
    parts.push('<line class="grid-line" x1="' + plot.left + '" y1="' + tick.pos + '" x2="' + plot.right + '" y2="' + tick.pos + '" />');
    parts.push('<text class="tick-text" x="' + (plot.left - 10) + '" y="' + (tick.pos + 4) + '" text-anchor="end">' + esc(tick.value) + '</text>');
  }

  for (const tick of x.ticks) {
    const transform = x.kind === 'category' && x.ticks.length > 8
      ? ' transform="rotate(-30 ' + tick.pos + ' ' + (plot.bottom + 18) + ')"'
      : '';
    parts.push('<text class="tick-text" x="' + tick.pos + '" y="' + (plot.bottom + 20) + '" text-anchor="middle"' + transform + '>' + esc(tick.value) + '</text>');
  }

  parts.push('<line class="axis-line" x1="' + plot.left + '" y1="' + plot.bottom + '" x2="' + plot.right + '" y2="' + plot.bottom + '" />');
  parts.push('<line class="axis-line" x1="' + plot.left + '" y1="' + plot.top + '" x2="' + plot.left + '" y2="' + plot.bottom + '" />');

  if (series.area) parts.push('<path class="series-area" d="' + series.area + '" />');
  if (series.path) parts.push('<path class="series-line" d="' + series.path + '" />');
  if (type === 'scatter' && series.points) {
    for (const point of series.points) {
      parts.push('<circle class="series-dot" cx="' + point.x + '" cy="' + point.y + '" r="2.6" />');
    }
  }
  if (type === 'bar' && series.bars) {
    for (const bar of series.bars) {
      parts.push('<rect class="series-bar" x="' + bar.x + '" y="' + bar.y + '" width="' + bar.width + '" height="' + Math.max(0, bar.height) + '" />');
    }
  }

  parts.push('<text class="axis-title" x="' + ((plot.left + plot.right) / 2) + '" y="' + (height - 12) + '" text-anchor="middle">' + esc(x.title) + '</text>');
  parts.push('<text class="axis-title" transform="rotate(-90 16 ' + ((plot.top + plot.bottom) / 2) + ')" x="16" y="' + ((plot.top + plot.bottom) / 2) + '" text-anchor="middle">' + esc(y.title) + '</text>');

  parts.push('</svg>');
  return parts.join('');
}

function renderChart(drawing) {
  model = drawing;
  $('chart').outerHTML = buildSvg(drawing);
  const svg = document.getElementById('chart');
  hoverPoints = [];
  if (drawing.series.points) hoverPoints = drawing.series.points;
  if (drawing.series.bars) hoverPoints = drawing.series.bars;

  svg.addEventListener('mousemove', (event) => showTooltip(event, svg, drawing));
  svg.addEventListener('mouseleave', () => { $('tooltip').style.display = 'none'; });

  const meta = [];
  meta.push(drawing.meta.used + ' / ' + drawing.meta.source + ' 行');
  if (drawing.meta.note) meta.push(drawing.meta.note);
  $('chartMeta').textContent = meta.join(' · ');
}

function showTooltip(event, svg, drawing) {
  if (hoverPoints.length === 0) return;
  const rect = svg.getBoundingClientRect();
  const scale = drawing.width / rect.width;
  const x = (event.clientX - rect.left) * scale;

  let best = hoverPoints[0];
  let bestDistance = Infinity;
  for (const point of hoverPoints) {
    const distance = Math.abs(point.x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  if (bestDistance > 40) { $('tooltip').style.display = 'none'; return; }

  const box = $('chartBox').getBoundingClientRect();
  const tooltip = $('tooltip');
  tooltip.textContent = drawing.x.title + ' = ' + best.vx + '  ·  ' + drawing.y.title + ' = ' + best.vy;
  tooltip.style.display = 'block';
  tooltip.style.left = Math.min(event.clientX - box.left + 12, box.width - tooltip.offsetWidth - 8) + 'px';
  tooltip.style.top = Math.max(0, event.clientY - box.top - 32) + 'px';
}

$('parse').addEventListener('click', () => vscode.postMessage({ type: 'parseText', text: $('text').value }));
$('openFile').addEventListener('click', () => vscode.postMessage({ type: 'openFile' }));
$('sample').addEventListener('click', () => vscode.postMessage({ type: 'sample' }));
$('clear').addEventListener('click', () => {
  $('text').value = '';
  model = null;
  $('mappingCard').hidden = true;
  $('chartCard').hidden = true;
  $('preview').replaceChildren();
  $('sourceInfo').textContent = '还没有数据';
  $('warnings').replaceChildren();
});

for (const id of ['xSelect', 'ySelect', 'typeSelect', 'sortByX']) {
  $(id).addEventListener('change', requestRender);
}

$('copySvg').addEventListener('click', () => {
  const svg = document.getElementById('chart');
  if (svg) vscode.postMessage({ type: 'copySvg', svg: svg.outerHTML });
});
$('saveSvg').addEventListener('click', () => {
  const svg = document.getElementById('chart');
  if (svg) vscode.postMessage({ type: 'saveSvg', svg: svg.outerHTML });
});
$('saveCsv').addEventListener('click', () => vscode.postMessage({ type: 'saveCsv', options: collectOptions() }));

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;
  if (message.type === 'dataset') {
    applyDataset(message.state);
  } else if (message.type === 'chart') {
    $('chartCard').hidden = false;
    renderChart(message.model);
  } else if (message.type === 'error') {
    $('sourceInfo').textContent = message.message;
  }
});

if (initial) applyDataset(initial);
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
