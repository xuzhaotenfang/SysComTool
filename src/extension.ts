import * as vscode from 'vscode';
import { createFeatureContext } from './core/context';
import { FeatureHost } from './core/host';
import { OutputLogger } from './core/log';
import { FeatureTreeProvider } from './core/tree';
import type { RegistrationReport } from './core/types';
import { FEATURES } from './features';

let host: FeatureHost | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const logger = new OutputLogger('SysComTool');
  const version = String(context.extension.packageJSON.version ?? '0.0.0');
  const featureContext = createFeatureContext(logger, version);

  host = new FeatureHost(
    {
      registerCommand: (id, handler) => vscode.commands.registerCommand(id, handler),
      notifyError: (message) => {
        void vscode.window.showErrorMessage(message);
      },
    },
    featureContext,
  );

  const report = host.registerAll(FEATURES);
  for (const failure of report.failed) {
    logger.warn(`功能加载失败：${failure.id} — ${failure.reason}`);
  }
  logger.info(`SysComTool ${version} 已激活，注册 ${report.registered.length}/${FEATURES.length} 个功能`);

  const tree = new FeatureTreeProvider(FEATURES, failureMap(report));

  context.subscriptions.push(
    logger,
    host,
    tree,
    vscode.window.createTreeView('syscomtool.features', {
      treeDataProvider: tree,
      showCollapseAll: false,
    }),
    vscode.commands.registerCommand('syscomtool.showLog', () => logger.show()),
    vscode.commands.registerCommand('syscomtool.list', () => showFeatureMenu(report)),
  );
}

export function deactivate(): void {
  host?.dispose();
  host = undefined;
}

function failureMap(report: RegistrationReport): ReadonlyMap<string, string> {
  return new Map(report.failed.map((failure) => [failure.id, failure.reason]));
}

async function showFeatureMenu(report: RegistrationReport): Promise<void> {
  const available = new Set(report.registered);
  const items = FEATURES.filter((feature) => available.has(feature.id)).map((feature) => ({
    label: feature.title,
    description: feature.id,
    detail: feature.description,
    feature,
  }));

  if (items.length === 0) {
    void vscode.window.showWarningMessage('SysComTool：没有可用功能，详见输出面板的日志。');
    return;
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: 'SysComTool 功能',
    placeHolder: '选择要运行的功能',
  });
  if (picked) {
    await vscode.commands.executeCommand(picked.feature.id);
  }
}
