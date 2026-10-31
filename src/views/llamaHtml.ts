import type * as vscode from 'vscode';
import { baseCss, contentSecurityPolicy } from './webview';

export interface LlamaPanelState {
  profiles: Array<{
    id: string;
    name: string;
    execPath: string;
    dirPath: string;
    version?: string;
    build?: string;
  }>;
  activeProfileId?: string;
  modelPath: string;
  recents: string[];
  maxConcurrent: number;
}

/** 图形化 llama.cpp：选构建 → 选模型 → 调参 → 预览命令 → 并行跑多个任务。 */
export function renderLlamaHtml(
  webview: vscode.Webview,
  state: LlamaPanelState,
  nonce: string,
): string {
  const initial = JSON.stringify(state).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(webview, nonce)}" />
<style>
${baseCss()}
body { padding: 14px 18px 40px; max-width: 1100px; }
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
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px 12px; }
.grid label { display: flex; flex-direction: column; gap: 3px; }
.grid label.wide { grid-column: 1 / -1; }
.grid label span { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
select { margin-bottom: 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip {
  padding: 1px 8px; border-radius: 10px; cursor: pointer; font-size: 0.85em;
  border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
  background: transparent; color: var(--vscode-foreground);
  max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chip:hover { background: var(--vscode-list-hoverBackground); }
#profileMeta { margin-top: 4px; word-break: break-all; }
.cmd {
  margin: 8px 0 0; padding: 8px; border-radius: 4px; overflow-x: auto;
  background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.1));
  font-size: 0.9em; white-space: pre-wrap; word-break: break-all;
}
.problems { margin: 8px 0 0; padding-left: 18px; color: var(--vscode-errorForeground); }
.runs { display: flex; flex-direction: column; gap: 10px; }
.run { border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25)); border-radius: 5px; overflow: hidden; }
.run-head {
  display: flex; align-items: center; gap: 8px; padding: 5px 8px;
  background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.08));
}
.run-head .label { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.run-head .spacer { flex: 1; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-descriptionForeground); flex: none; }
.dot.s-running { background: var(--vscode-charts-blue, #3794ff); }
.dot.s-queued { background: var(--vscode-charts-orange, #d18616); }
.dot.s-succeeded { background: var(--vscode-charts-green, #89d185); }
.dot.s-failed { background: var(--vscode-charts-red, #f14c4c); }
.dot.s-cancelled { background: var(--vscode-descriptionForeground); }
.run-output {
  margin: 0; padding: 8px; max-height: 260px; overflow: auto;
  font-size: 0.88em; white-space: pre-wrap; word-break: break-word;
  background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.06));
}
.empty { color: var(--vscode-descriptionForeground); padding: 4px; }
</style>
</head>
<body>
<header>
  <h1>llama.cpp 运行器</h1>
  <div class="hint meta">先找一个编译好的 llama.cpp（保存为选项），再选模型、调参数。参数留空表示不传；可以同时跑多个任务。</div>
</header>

<section class="card">
  <div class="card-head">
    <span>1. llama.cpp</span>
    <div class="actions">
      <button id="autoFind">自动搜索</button>
      <button id="pickFolder">选文件夹</button>
      <button id="removeProfile" class="ghost">删除当前</button>
    </div>
  </div>
  <select id="profile"></select>
  <div id="profileMeta" class="meta">还没有保存任何 llama.cpp 选项</div>
</section>

<section class="card">
  <div class="card-head">
    <span>2. 模型</span>
    <div class="actions"><button id="pickModel">选择 .gguf</button></div>
  </div>
  <input id="model" readonly placeholder="还没有选择模型" />
  <div id="recents" class="chips"></div>
</section>

<section class="card">
  <div class="card-head"><span>3. 参数</span><span class="meta">留空 = 不传这个参数</span></div>
  <div class="grid">
    <label class="wide"><span>提示词 <code>-p</code></span>
      <textarea id="prompt" rows="3" placeholder="留空则不传 -p（llama-cli 会进入对话模式）"></textarea>
    </label>
    <label><span>预测长度 <code>-n</code></span><input id="nPredict" placeholder="—" /></label>
    <label><span>上下文 <code>-c</code></span><input id="ctxSize" placeholder="—" /></label>
    <label><span>线程数 <code>-t</code></span><input id="threads" placeholder="—" /></label>
    <label><span>GPU 层数 <code>-ngl</code></span><input id="gpuLayers" placeholder="—" /></label>
    <label><span>温度 <code>--temp</code></span><input id="temperature" placeholder="—" /></label>
    <label><span>批大小 <code>-b</code></span><input id="batchSize" placeholder="—" /></label>
    <label><span>随机种子 <code>-s</code></span><input id="seed" placeholder="—" /></label>
    <label class="wide"><span>额外参数</span><input id="extra" placeholder='例如 --no-warmup 或 --foo "a b"' /></label>
  </div>
</section>

<section class="card">
  <div class="card-head">
    <span>4. 命令</span>
    <div class="actions">
      <button id="copy">复制</button>
      <button id="terminal">在终端运行</button>
      <button id="run" class="primary">运行</button>
    </div>
  </div>
  <pre id="cmd" class="cmd">选择 llama.cpp 和模型后生成命令</pre>
  <ul id="problems" class="problems" hidden></ul>
</section>

<section class="card">
  <div class="card-head">
    <span>5. 运行</span>
    <div class="actions">
      <span class="meta">并发上限 <b id="limit">3</b></span>
      <button id="clearDone" class="ghost">清除已结束</button>
    </div>
  </div>
  <div id="runs" class="runs"><div class="empty">还没有运行。</div></div>
</section>

<script id="initial" type="application/json">${initial}</script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const state = JSON.parse(document.getElementById('initial').textContent);
const $ = (id) => document.getElementById(id);
const nodes = new Map();
let timer = null;

const STATUS_TEXT = {
  queued: '排队中',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已终止',
};

const PARAM_FIELDS = [
  'prompt', 'nPredict', 'ctxSize', 'threads',
  'gpuLayers', 'temperature', 'batchSize', 'seed', 'extra',
];

function collectParams() {
  const params = {};
  for (const field of PARAM_FIELDS) params[field] = $(field).value;
  return params;
}

function previewSoon() {
  clearTimeout(timer);
  timer = setTimeout(() => vscode.postMessage({ type: 'preview', params: collectParams() }), 120);
}

function renderProfiles() {
  const select = $('profile');
  select.replaceChildren();
  if (!state.profiles.length) {
    const option = document.createElement('option');
    option.textContent = '（还没有保存的 llama.cpp）';
    option.value = '';
    select.appendChild(option);
    $('profileMeta').textContent = '点「自动搜索」在打开的工作区里找，或「选文件夹」手动指定。';
    return;
  }
  for (const profile of state.profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    if (profile.id === state.activeProfileId) option.selected = true;
    select.appendChild(option);
  }
  const active = state.profiles.find((item) => item.id === state.activeProfileId) || state.profiles[0];
  if (active) {
    const parts = [active.execPath];
    if (active.version) parts.unshift('版本 ' + active.version);
    if (active.build) parts.push('构建 ' + active.build);
    $('profileMeta').textContent = parts.join(' · ');
  }
}

function renderModel() {
  $('model').value = state.modelPath || '';
  const box = $('recents');
  box.replaceChildren();
  for (const recent of state.recents) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = recent.split(/[\\\\/]/).pop();
    chip.title = recent;
    chip.addEventListener('click', () => vscode.postMessage({ type: 'selectModel', path: recent }));
    box.appendChild(chip);
  }
}

function elapsed(run) {
  if (!run.startedAt) return '';
  const end = run.endedAt || Date.now();
  return ((end - run.startedAt) / 1000).toFixed(1) + 's';
}

function buildRun(run) {
  const card = document.createElement('div');
  card.className = 'run';
  card.dataset.id = run.id;

  const head = document.createElement('div');
  head.className = 'run-head';

  const dot = document.createElement('span');
  dot.className = 'dot s-' + run.status;

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = run.label;
  label.title = run.command;

  const meta = document.createElement('span');
  meta.className = 'spacer meta';
  meta.textContent = STATUS_TEXT[run.status] + ' · ' + elapsed(run);

  head.append(dot, label, meta);

  if (run.status === 'running' || run.status === 'queued') {
    const cancel = document.createElement('button');
    cancel.className = 'ghost';
    cancel.textContent = '终止';
    cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel', id: run.id }));
    head.appendChild(cancel);
  } else {
    const remove = document.createElement('button');
    remove.className = 'ghost';
    remove.textContent = '移除';
    remove.addEventListener('click', () => vscode.postMessage({ type: 'remove', id: run.id }));
    head.appendChild(remove);
  }

  const pre = document.createElement('pre');
  pre.className = 'run-output';
  pre.textContent = run.output || (run.status === 'running' ? '' : '(没有输出)');

  card.append(head, pre);
  nodes.set(run.id, { card, pre, meta, status: run.status, startedAt: run.startedAt, endedAt: run.endedAt });
  return card;
}

function renderRuns(runs) {
  const box = $('runs');
  box.replaceChildren();
  nodes.clear();
  if (!runs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '还没有运行。';
    box.appendChild(empty);
    return;
  }
  for (const run of runs) box.appendChild(buildRun(run));
}

function appendChunk(id, chunk) {
  const node = nodes.get(id);
  if (!node) return;
  const atBottom = node.pre.scrollTop + node.pre.clientHeight >= node.pre.scrollHeight - 24;
  node.pre.textContent += chunk;
  if (node.pre.textContent.length > 200000) {
    node.pre.textContent = node.pre.textContent.slice(-200000);
  }
  if (atBottom) node.pre.scrollTop = node.pre.scrollHeight;
}

function applyState(next) {
  state.profiles = next.profiles;
  state.activeProfileId = next.activeProfileId;
  state.modelPath = next.modelPath;
  state.recents = next.recents;
  state.maxConcurrent = next.maxConcurrent;
  $('limit').textContent = String(next.maxConcurrent);
  renderProfiles();
  renderModel();
  previewSoon();
}

function showCommand(command, problems) {
  $('cmd').textContent = command || '选择 llama.cpp 和模型后生成命令';
  const list = $('problems');
  list.replaceChildren();
  if (problems && problems.length) {
    list.hidden = false;
    for (const problem of problems) {
      const li = document.createElement('li');
      li.textContent = problem;
      list.appendChild(li);
    }
  } else {
    list.hidden = true;
  }
}

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;
  switch (message.type) {
    case 'state':
      applyState(message.state);
      break;
    case 'command':
      showCommand(message.command, message.problems);
      break;
    case 'runs':
      renderRuns(message.runs);
      break;
    case 'run.output':
      appendChunk(message.id, message.chunk);
      break;
    case 'notice':
      window.alert(message.message);
      break;
  }
});

for (const field of PARAM_FIELDS) {
  $(field).addEventListener('input', previewSoon);
}

$('profile').addEventListener('change', () => {
  vscode.postMessage({ type: 'selectProfile', id: $('profile').value });
});
$('autoFind').addEventListener('click', () => vscode.postMessage({ type: 'autoFind' }));
$('pickFolder').addEventListener('click', () => vscode.postMessage({ type: 'pickFolder' }));
$('removeProfile').addEventListener('click', () =>
  vscode.postMessage({ type: 'removeProfile', id: state.activeProfileId }),
);
$('pickModel').addEventListener('click', () => vscode.postMessage({ type: 'pickModel' }));
$('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy', params: collectParams() }));
$('terminal').addEventListener('click', () => vscode.postMessage({ type: 'terminal', params: collectParams() }));
$('run').addEventListener('click', () => vscode.postMessage({ type: 'run', params: collectParams() }));
$('clearDone').addEventListener('click', () => vscode.postMessage({ type: 'clearDone' }));

setInterval(() => {
  for (const node of nodes.values()) {
    if (node.status !== 'running' && node.status !== 'queued') continue;
    const run = { startedAt: node.startedAt, endedAt: node.endedAt };
    node.meta.textContent = STATUS_TEXT[node.status] + ' · ' + elapsed(run);
  }
}, 500);

renderProfiles();
renderModel();
$('limit').textContent = String(state.maxConcurrent);
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
