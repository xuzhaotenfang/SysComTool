import type * as vscode from 'vscode';
import { baseCss, contentSecurityPolicy } from './webview';

export interface FormulaPanelState {
  columns: Array<{ name: string; kind: 'number' | 'string' }>;
  preview: string[][];
  total: number;
  format: string;
  warnings: string[];
}

const SAMPLE = `x,y,t
1,2,0.5
2,4,0.8
3,6,1.1
4,8,1.5
5,10,1.9`;

export function sampleDataset(): string {
  return SAMPLE;
}

/** 建模计算面板：LaTeX 公式 + CSV 列 → 新的计算结果列。 */
export function renderFormulaHtml(
  webview: vscode.Webview,
  state: FormulaPanelState | undefined,
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
textarea { min-height: 96px; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92em; }
.row { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.table-wrap { max-height: 240px; overflow: auto; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); border-radius: 4px; }
table { border-collapse: collapse; font-size: 0.88em; width: 100%; }
th, td { padding: 2px 8px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.15)); white-space: nowrap; }
th { position: sticky; top: 0; background: var(--vscode-editorWidget-background, rgba(128,128,128,.12)); }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.meta { color: var(--vscode-descriptionForeground); }
.formula {
  display: flex; gap: 8px; align-items: baseline;
  padding: 2px 0; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em;
}
.formula b { color: var(--vscode-charts-blue, #3794ff); font-weight: 600; }
.errors { margin: 6px 0 0; padding-left: 18px; color: var(--vscode-errorForeground, #f14c4c); font-size: 0.9em; }
.warnings { margin: 6px 0 0; padding-left: 18px; color: var(--vscode-editorWarning-foreground, #cca700); font-size: 0.9em; }
.bindings { display: grid; grid-template-columns: minmax(90px, 0.8fr) minmax(150px, 1.4fr) minmax(90px, 0.8fr); gap: 6px 10px; align-items: center; }
.bindings .head { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
.bindings input[type="number"] { width: 100%; }
.bindings input[type="text"] { width: 100%; }
.hidden { display: none; }
</style>
</head>
<body>
<header>
  <h1>建模计算</h1>
  <div class="hint meta">把数学建模里的公式（LaTeX 可直接粘）套到 CSV 上：因子可以绑到某一列，也可以是常量。
  每行一条 <code>y = ...</code>，支持 \\frac、\\sqrt、上下标、\\cdot、希腊字母和常用函数。</div>
</header>

<section class="card">
  <div class="card-head">
    <span>1. 数据</span>
    <div class="actions">
      <button id="openFile">打开 CSV…</button>
      <button id="sample" class="ghost">示例数据</button>
    </div>
  </div>
  <textarea id="text" placeholder="粘贴 CSV 或 Markdown 表格，例如：&#10;x,y,t&#10;1,2,0.5"></textarea>
  <div class="row" style="margin-top: 8px">
    <button id="parse" class="primary">解析粘贴内容</button>
    <span class="meta" id="sourceInfo">还没有数据</span>
  </div>
  <div id="preview"></div>
  <div id="warnings"></div>
</section>

<section class="card" id="formulaCard" hidden>
  <div class="card-head">
    <span>2. 公式（LaTeX）</span>
    <span class="meta">每行一条，等号左边是新列名</span>
  </div>
  <textarea id="formulas" placeholder="例如：&#10;y = \\frac{a x}{1 + b x}&#10;z = \\sqrt{x^{2} + y^{2}}"></textarea>
  <div id="formulaList" style="margin-top: 8px"></div>
  <div id="formulaErrors"></div>
</section>

<section class="card" id="bindingCard" hidden>
  <div class="card-head"><span>3. 因子绑定</span><span class="meta">同名变量默认绑同名列，其余当常量</span></div>
  <div class="bindings" id="bindings"></div>
</section>

<section class="card" id="resultCard" hidden>
  <div class="card-head">
    <span>4. 结果</span>
    <div class="actions">
      <button id="exportCsv" class="ghost">导出结果 CSV</button>
      <button id="toChart" class="ghost">用结果出图</button>
    </div>
  </div>
  <div id="resultSummary" class="meta"></div>
  <div id="resultTable" style="margin-top: 8px"></div>
  <div id="resultErrors"></div>
</section>

<script id="initial" type="application/json">${initial}</script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const initial = JSON.parse(document.getElementById('initial').textContent);
const $ = (id) => document.getElementById(id);

let columns = [];
let formulas = [];
let variables = [];
let bindings = {};
let computeTimer = null;

function post(type, payload) {
  vscode.postMessage(Object.assign({ type }, payload || {}));
}

function renderTable(container, cols, rows, limit) {
  container.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const column of cols) {
    const th = document.createElement('th');
    th.textContent = column.name;
    head.appendChild(th);
  }
  table.appendChild(head);

  const shown = limit ? rows.slice(0, limit) : rows;
  for (const row of shown) {
    const tr = document.createElement('tr');
    row.forEach((cell, index) => {
      const td = document.createElement('td');
      td.textContent = cell;
      if (cols[index] && cols[index].kind === 'number') td.className = 'num';
      tr.appendChild(td);
    });
    table.appendChild(tr);
  }
  wrap.appendChild(table);

  const note = document.createElement('div');
  note.className = 'meta';
  note.style.marginTop = '6px';
  note.textContent = '显示 ' + shown.length + ' / ' + rows.length + ' 行';
  wrap.appendChild(note);
  container.appendChild(wrap);
}

function applyDataset(state) {
  columns = state.columns;
  $('sourceInfo').textContent = state.total + ' 行 · ' + state.columns.length + ' 列 · ' + state.format;
  renderTable($('preview'), state.columns, state.preview, 10);

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

  $('formulaCard').hidden = false;
  if ($('formulas').value.trim() === '') {
    $('formulas').value = suggestFormula(state.columns);
  }
  parseFormulas();
}

function suggestFormula(cols) {
  const numeric = cols.filter((column) => column.kind === 'number').map((column) => column.name);
  if (numeric.length === 0) return '';
  if (numeric.length === 1) return numeric[0] + '_norm = ' + numeric[0] + ' / ' + numeric[0];
  return numeric[numeric.length - 1] + ' = ' + numeric[0] + ' * 1 + 0';
}

function parseFormulas() {
  post('parseFormulas', { text: $('formulas').value });
}

function renderFormulas(message) {
  formulas = message.formulas;
  variables = message.variables;

  const list = $('formulaList');
  list.replaceChildren();
  if (formulas.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'meta';
    empty.textContent = '还没有可用公式';
    list.appendChild(empty);
  }
  for (const formula of formulas) {
    const row = document.createElement('div');
    row.className = 'formula';
    const name = document.createElement('b');
    name.textContent = formula.name + ' =';
    const expr = document.createElement('span');
    expr.textContent = formula.expression;
    row.append(name, expr);
    list.appendChild(row);
  }

  const errors = $('formulaErrors');
  errors.replaceChildren();
  if (message.errors.length) {
    for (const text of message.errors) {
      const li = document.createElement('li');
      li.textContent = text;
      errors.appendChild(li);
    }
    errors.className = 'errors';
  }

  // 保留已有选择，新增变量给默认绑定
  const next = {};
  for (const name of variables) {
    if (bindings[name]) {
      next[name] = bindings[name];
      continue;
    }
    const match = columns.findIndex((column) => column.name.toLowerCase() === name.toLowerCase());
    next[name] =
      match >= 0
        ? { kind: 'column', index: match }
        : { kind: 'constant', value: 1 };
  }
  bindings = next;

  $('bindingCard').hidden = variables.length === 0;
  renderBindings();
  scheduleCompute();
}

function renderBindings() {
  const box = $('bindings');
  box.replaceChildren();

  const heads = ['因子', '绑定到', '常量值'];
  for (const text of heads) {
    const div = document.createElement('div');
    div.className = 'head';
    div.textContent = text;
    box.appendChild(div);
  }

  for (const name of variables) {
    const label = document.createElement('div');
    label.textContent = name;
    box.appendChild(label);

    const select = document.createElement('select');
    const none = document.createElement('option');
    none.value = 'constant';
    none.textContent = '常量';
    select.appendChild(none);
    columns.forEach((column, index) => {
      const option = document.createElement('option');
      option.value = 'column:' + index;
      option.textContent = '列：' + column.name;
      select.appendChild(option);
    });
    const current = bindings[name] || { kind: 'constant', value: 1 };
    select.value = current.kind === 'column' ? 'column:' + current.index : 'constant';
    select.addEventListener('change', () => {
      const value = select.value;
      bindings[name] =
        value === 'constant'
          ? { kind: 'constant', value: Number(input.value) || 0 }
          : { kind: 'column', index: Number(value.split(':')[1]) };
      input.classList.toggle('hidden', value !== 'constant');
      if (value !== 'constant') scheduleCompute();
    });
    box.appendChild(select);

    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.value = String(current.kind === 'constant' ? current.value : 1);
    input.classList.toggle('hidden', current.kind !== 'constant');
    input.addEventListener('input', () => {
      bindings[name] = { kind: 'constant', value: Number(input.value) || 0 };
      scheduleCompute();
    });
    box.appendChild(input);
  }
}

function scheduleCompute() {
  clearTimeout(computeTimer);
  computeTimer = setTimeout(() => {
    if (formulas.length === 0) return;
    post('compute', { formulas, bindings });
  }, 250);
}

function renderResult(message) {
  $('resultCard').hidden = false;
  $('resultSummary').textContent =
    message.okRows + ' / ' + message.totalRows + ' 行算成功（' + message.columns.length + ' 列）';

  renderTable($('resultTable'), message.columns, message.rows, 15);

  const errors = $('resultErrors');
  errors.replaceChildren();
  if (message.errors.length) {
    for (const item of message.errors.slice(0, 8)) {
      const li = document.createElement('li');
      li.textContent = '第 ' + item.row + ' 行 · ' + item.formula + '：' + item.message;
      errors.appendChild(li);
    }
    if (message.errorRows > message.errors.length) {
      const li = document.createElement('li');
      li.textContent = '还有 ' + (message.errorRows - message.errors.length) + ' 行有错，已省略';
      errors.appendChild(li);
    }
    errors.className = 'errors';
  }
}

$('parse').addEventListener('click', () => post('parseText', { text: $('text').value }));
$('openFile').addEventListener('click', () => post('openFile'));
$('sample').addEventListener('click', () => post('sample'));
$('formulas').addEventListener('input', () => {
  clearTimeout(computeTimer);
  computeTimer = setTimeout(parseFormulas, 250);
});

$('exportCsv').addEventListener('click', () => post('exportCsv'));
$('toChart').addEventListener('click', () => post('toChart'));

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;
  if (message.type === 'dataset') applyDataset(message.state);
  else if (message.type === 'formulas') renderFormulas(message);
  else if (message.type === 'result') renderResult(message);
  else if (message.type === 'error') {
    $('sourceInfo').textContent = message.message;
  }
});

if (initial) applyDataset(initial);
post('ready');
</script>
</body>
</html>`;
}
