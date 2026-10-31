import * as vscode from 'vscode';
import { createNonce } from './webview';
import { renderSidebarHtml, type SidebarState } from './sidebarHtml';

export interface FeatureListViewOptions {
  getState: () => SidebarState;
  run: (id: string) => void;
  checkUpdate: () => void;
}

/** 侧边栏视图：搜索 + 分组 + 点击执行。 */
export class FeatureListView implements vscode.WebviewViewProvider {
  static readonly viewType = 'syscomtool.features';

  private view?: vscode.WebviewView;

  constructor(private readonly options: FeatureListViewOptions) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = renderSidebarHtml(view.webview, this.options.getState(), createNonce());

    view.webview.onDidReceiveMessage((message: unknown) => {
      if (typeof message !== 'object' || message === null) {
        return;
      }
      const payload = message as { type?: string; id?: string };
      if (payload.type === 'run' && typeof payload.id === 'string') {
        this.options.run(payload.id);
      } else if (payload.type === 'update') {
        this.options.checkUpdate();
      }
    });

    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  /** 状态变化（新功能、发现更新）时调用。 */
  refresh(): void {
    void this.view?.webview.postMessage({ type: 'state', state: this.options.getState() });
  }
}
