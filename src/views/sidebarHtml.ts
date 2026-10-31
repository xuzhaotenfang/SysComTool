import type * as vscode from 'vscode';
import { baseCss, contentSecurityPolicy } from './webview';

export interface SidebarItem {
  id: string;
  title: string;
  description?: string;
  category: string;
}

export interface SidebarState {
  items: SidebarItem[];
  failed: Array<{ id: string; reason: string }>;
  update?: { latest: string; current: string };
}

/** 左侧栏：搜索框 + 按归属分组的功能列表。 */
export function renderSidebarHtml(
  webview: vscode.Webview,
  state: SidebarState,
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
body { padding: 8px; }
.search { position: sticky; top: 0; z-index: 2; padding: 2px 0 8px; background: var(--vscode-sideBar-background, transparent); }
.group-title {
  margin: 10px 0 2px; padding: 0 4px;
  font-size: 0.8em; letter-spacing: 0.06em;
  color: var(--vscode-descriptionForeground);
}
.item {
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  width: 100%; padding: 5px 8px;
  text-align: left; border: none; border-radius: 4px;
  background: transparent; cursor: pointer;
}
.item:hover { background: var(--vscode-list-hoverBackground); }
.item:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.item .t { font-weight: 500; }
.item .d { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
.item[disabled] { opacity: 0.6; cursor: default; }
.item[disabled]:hover { background: transparent; }
.empty { padding: 8px 4px; color: var(--vscode-descriptionForeground); }
.update {
  display: flex; align-items: center; gap: 8px;
  margin: 4px 0 8px; padding: 6px 8px; border-radius: 4px;
  background: var(--vscode-inputValidation-infoBackground, rgba(0, 120, 212, 0.12));
  border: 1px solid var(--vscode-inputValidation-infoBorder, rgba(0, 120, 212, 0.5));
}
.hint { padding: 6px 4px 0; color: var(--vscode-descriptionForeground); font-size: 0.85em; }
</style>
</head>
<body>
<div class="search">
  <input id="q" type="search" placeholder="搜索功能（名字 / 说明）" autocomplete="off" />
</div>
<div id="update"></div>
<div id="list"></div>
<div class="hint">点一项即可执行；功能之间互不影响，可以同时打开多个。</div>
<script id="initial" type="application/json">${initial}</script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const state = JSON.parse(document.getElementById('initial').textContent);
const q = document.getElementById('q');
const list = document.getElementById('list');
const updateBox = document.getElementById('update');

function makeItem(item) {
  const button = document.createElement('button');
  button.className = 'item';
  button.dataset.id = item.id;
  if (item.disabled) {
    button.disabled = true;
    button.title = item.reason || '';
  }
  const title = document.createElement('span');
  title.className = 't';
  title.textContent = item.title;
  button.appendChild(title);
  if (item.description) {
    const desc = document.createElement('span');
    desc.className = 'd';
    desc.textContent = item.description;
    button.appendChild(desc);
  }
  return button;
}

function section(title, items) {
  const wrap = document.createElement('section');
  const heading = document.createElement('div');
  heading.className = 'group-title';
  heading.textContent = title;
  wrap.appendChild(heading);
  for (const item of items) wrap.appendChild(makeItem(item));
  return wrap;
}

function renderList() {
  const needle = q.value.trim().toLowerCase();
  const matches = (item) =>
    !needle ||
    [item.title, item.description || '', item.id, item.category]
      .join(' ')
      .toLowerCase()
      .includes(needle);

  const groups = new Map();
  for (const item of state.items.filter(matches)) {
    const key = item.category || '通用';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const frag = document.createDocumentFragment();
  for (const key of [...groups.keys()].sort((a, b) => a.localeCompare(b, 'zh'))) {
    frag.appendChild(section(key, groups.get(key)));
  }
  if (frag.childElementCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = needle ? '没有匹配的功能' : '还没有可用的功能';
    frag.appendChild(empty);
  }

  if (state.failed.length > 0 && !needle) {
    frag.appendChild(
      section(
        '加载失败',
        state.failed.map((item) => ({ ...item, title: item.id, description: item.reason, category: '加载失败', disabled: true })),
      ),
    );
  }

  list.replaceChildren(frag);
}

function renderUpdate() {
  if (!state.update) {
    updateBox.replaceChildren();
    return;
  }
  const box = document.createElement('div');
  box.className = 'update';
  const text = document.createElement('span');
  text.textContent = '有新版本 v' + state.update.latest + '（当前 v' + state.update.current + '）';
  const button = document.createElement('button');
  button.className = 'primary';
  button.textContent = '更新';
  button.addEventListener('click', () => vscode.postMessage({ type: 'update' }));
  box.append(text, button);
  updateBox.replaceChildren(box);
}

list.addEventListener('click', (event) => {
  const button = event.target.closest('button.item');
  if (!button || button.disabled) return;
  vscode.postMessage({ type: 'run', id: button.dataset.id });
});

q.addEventListener('input', renderList);
q.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const first = list.querySelector('button.item:not([disabled])');
  if (first) vscode.postMessage({ type: 'run', id: first.dataset.id });
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.type !== 'state') return;
  state.items = message.state.items;
  state.failed = message.state.failed;
  state.update = message.state.update;
  renderList();
  renderUpdate();
});

renderList();
renderUpdate();
q.focus();
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
