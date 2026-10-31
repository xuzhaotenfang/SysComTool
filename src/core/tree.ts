import * as vscode from 'vscode';
import type { Feature } from './types';

/**
 * 侧边栏里的「功能」列表：一行一个功能，点击即执行。
 * 注册失败的功能仍然列出，但标灰并给出原因，方便自查。
 */
export class FeatureTreeProvider implements vscode.TreeDataProvider<Feature> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly features: readonly Feature[],
    private readonly failures: ReadonlyMap<string, string>,
  ) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(feature: Feature): vscode.TreeItem {
    const failure = this.failures.get(feature.id);
    const item = new vscode.TreeItem(
      feature.title,
      vscode.TreeItemCollapsibleState.None,
    );

    item.id = feature.id;
    item.description = failure ? '加载失败' : feature.id;
    item.tooltip = failure
      ? `${feature.description ?? feature.title}\n\n加载失败：${failure}`
      : feature.description;
    item.contextValue = 'syscomtool.feature';

    if (failure) {
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
    } else {
      item.iconPath = new vscode.ThemeIcon('play');
      item.command = { command: feature.id, title: feature.title };
    }

    return item;
  }

  getChildren(element?: Feature): Feature[] {
    if (element) {
      return [];
    }
    return [...this.features];
  }

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }
}
