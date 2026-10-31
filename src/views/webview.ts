import * as vscode from 'vscode';

export function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function contentSecurityPolicy(webview: vscode.Webview, nonce: string): string {
  return [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
  ].join('; ');
}

/** 两个视图共用的基础样式，全部用 VS Code 主题变量，跟随明暗切换。 */
export function baseCss(): string {
  return `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 10px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: transparent;
}
input, textarea, select, button { font: inherit; color: inherit; }
input, textarea, select {
  width: 100%;
  padding: 4px 6px;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 3px;
  outline: none;
}
input:focus, textarea:focus, select:focus { border-color: var(--vscode-focusBorder); }
textarea { resize: vertical; }
button {
  padding: 4px 10px;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 3px;
  white-space: nowrap;
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
}
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button.primary:hover { background: var(--vscode-button-hoverBackground); }
button.ghost {
  background: transparent;
  color: var(--vscode-foreground);
  border-color: var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
}
button.ghost:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15)); }
code, pre { font-family: var(--vscode-editor-font-family, monospace); }
.meta { color: var(--vscode-descriptionForeground); font-size: 0.92em; }
`;
}
