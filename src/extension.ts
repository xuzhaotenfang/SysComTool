import * as path from 'node:path';
import * as vscode from 'vscode';
import { createFeatureContext } from './core/context';
import { FeatureHost } from './core/host';
import { OutputLogger } from './core/log';
import type { Feature } from './core/types';
import { createFeatures } from './features';
import { RunManager } from './services/llama/runs';
import { Store } from './services/store';
import { UpdateFlow } from './services/update/updateFlow';
import { Updater } from './services/update/updater';
import { FeatureListView } from './views/featureListView';
import { LlamaPanel } from './views/llamaPanel';

const DEFAULT_FEED = 'https://api.github.com/repos/xuzhaotenfang/SysComTool/releases/latest';

let runManager: RunManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const logger = new OutputLogger('SysComTool');
  const version = String(context.extension.packageJSON.version ?? '0.0.0');
  const featureContext = createFeatureContext(logger, version);
  const store = new Store(context.globalState);

  const maxConcurrent = vscode.workspace
    .getConfiguration('syscomtool')
    .get<number>('llama.maxConcurrent', 3);
  const runs = new RunManager({ maxConcurrent });
  runManager = runs;

  const panel = new LlamaPanel({ context, store, runs, logger });

  const updater = new Updater({
    logger,
    currentVersion: version,
    storageDir: path.join(context.globalStorageUri.fsPath, 'updates'),
    feedUrl: () =>
      vscode.workspace.getConfiguration('syscomtool').get<string>('update.feedUrl', DEFAULT_FEED),
  });

  let sidebar: FeatureListView | undefined;
  const updateFlow = new UpdateFlow({
    updater,
    store,
    logger,
    currentVersion: version,
    onUpdateFound: () => sidebar?.refresh(),
  });

  const features = createFeatures({ panel, updateFlow });
  const host = new FeatureHost(
    {
      registerCommand: (id, handler) => vscode.commands.registerCommand(id, handler),
      notifyError: (message) => {
        void vscode.window.showErrorMessage(message);
      },
    },
    featureContext,
  );

  const report = host.registerAll(features);
  for (const failure of report.failed) {
    logger.warn(`功能加载失败：${failure.id} — ${failure.reason}`);
  }

  sidebar = new FeatureListView({
    getState: () => ({
      items: features.map(toSidebarItem),
      failed: report.failed,
      update: updateFlow.available
        ? { latest: updateFlow.available, current: version }
        : undefined,
    }),
    run: (id) => {
      void vscode.commands.executeCommand(id);
    },
    checkUpdate: () => {
      void vscode.commands.executeCommand('syscomtool.checkUpdate');
    },
  });

  context.subscriptions.push(
    logger,
    { dispose: () => host.dispose() },
    { dispose: () => runs.dispose() },
    { dispose: () => panel.dispose() },
    vscode.window.registerWebviewViewProvider(FeatureListView.viewType, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('syscomtool.showLog', () => logger.show()),
    vscode.commands.registerCommand('syscomtool.list', () => {
      void vscode.commands.executeCommand(`${FeatureListView.viewType}.focus`);
    }),
  );

  logger.info(
    `SysComTool ${version} 已激活：功能 ${report.registered.length}/${features.length}，` +
      `并发上限 ${runs.limit}`,
  );

  // 自动更新：静默、受 24 小时节流，失败只写日志，绝不阻塞启动
  void updateFlow.maybeAuto();
}

export function deactivate(): void {
  runManager?.dispose();
  runManager = undefined;
}

function toSidebarItem(feature: Feature) {
  return {
    id: feature.id,
    title: feature.title,
    description: feature.description,
    category: feature.category ?? '通用',
  };
}
