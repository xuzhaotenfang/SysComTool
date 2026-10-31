import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Logger } from '../core/types';
import { buildArgs, toShellCommand, validateParams, type LlamaParams } from '../services/llama/command';
import { profileName, probeVersion, scanFolder, scanForExecutables } from '../services/llama/detect';
import type { RunManager } from '../services/llama/runs';
import type { Store } from '../services/store';
import { renderLlamaHtml, type LlamaPanelState } from './llamaHtml';
import { createNonce } from './webview';

export interface LlamaPanelDeps {
  context: vscode.ExtensionContext;
  store: Store;
  runs: RunManager;
  logger: Logger;
}

interface Candidate {
  label: string;
  description: string;
  detail?: string;
  path: string;
}

/**
 * 图形化 llama.cpp 面板。
 *
 * 面板只是视图：任务由 RunManager 持有，所以关掉面板不会打断正在跑的任务，
 * 重新打开还能看到历史输出。
 */
export class LlamaPanel {
  private panel?: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private modelPath = '';

  constructor(private readonly deps: LlamaPanelDeps) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'syscomtool.llama',
      'SysComTool · llama.cpp',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel = panel;
    panel.webview.html = renderLlamaHtml(panel.webview, this.snapshotState(), createNonce());

    panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        void this.handle(message);
      },
      undefined,
      this.disposables,
    );
    panel.onDidDispose(() => this.close(), undefined, this.disposables);

    this.disposables.push(
      this.deps.runs.onRuns((runs) => this.post({ type: 'runs', runs })),
      this.deps.runs.onOutput((id, chunk) => this.post({ type: 'run.output', id, chunk })),
    );
  }

  dispose(): void {
    this.panel?.dispose();
    this.close();
  }

  private close(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.panel = undefined;
  }

  private post(message: unknown): void {
    void this.panel?.webview.postMessage(message);
  }

  private snapshotState(): LlamaPanelState {
    const state = this.deps.store.state();
    return {
      profiles: state.llamaProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        execPath: profile.execPath,
        dirPath: profile.dirPath,
        version: profile.version,
        build: profile.build,
      })),
      activeProfileId: state.activeProfileId,
      modelPath: this.modelPath,
      recents: state.recentModels,
      maxConcurrent: this.deps.runs.limit,
    };
  }

  private activeProfile() {
    const state = this.deps.store.state();
    return (
      state.llamaProfiles.find((item) => item.id === state.activeProfileId) ??
      state.llamaProfiles[0]
    );
  }

  private async pushState(): Promise<void> {
    this.post({ type: 'state', state: this.snapshotState() });
  }

  private sendPreview(params: LlamaParams): void {
    const profile = this.activeProfile();
    const target = { execPath: profile?.execPath ?? '', modelPath: this.modelPath };
    const problems = validateParams(target, params);
    const command =
      problems.length === 0 ? toShellCommand(target.execPath, buildArgs(target, params)) : '';
    this.post({ type: 'command', command, problems });
  }

  private collectTarget(params: LlamaParams) {
    const profile = this.activeProfile();
    const target = { execPath: profile?.execPath ?? '', modelPath: this.modelPath };
    const problems = validateParams(target, params);
    return { profile, target, problems };
  }

  private async handle(raw: unknown): Promise<void> {
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const message = raw as Record<string, unknown>;
    const type = typeof message.type === 'string' ? message.type : '';

    switch (type) {
      case 'ready':
        await this.pushState();
        this.post({ type: 'runs', runs: this.deps.runs.snapshots() });
        return;
      case 'preview':
        this.sendPreview(parseParams(message.params));
        return;
      case 'autoFind':
        await this.autoFind();
        return;
      case 'pickFolder':
        await this.pickFolder();
        return;
      case 'removeProfile':
        await this.removeProfile(typeof message.id === 'string' ? message.id : undefined);
        return;
      case 'selectProfile':
        if (typeof message.id === 'string') {
          await this.deps.store.setActiveProfile(message.id);
          await this.pushState();
        }
        return;
      case 'pickModel':
        await this.pickModel();
        return;
      case 'selectModel':
        if (typeof message.path === 'string') {
          await this.setModel(message.path);
        }
        return;
      case 'copy':
        await this.copyCommand(parseParams(message.params));
        return;
      case 'terminal':
        await this.runInTerminal(parseParams(message.params));
        return;
      case 'run':
        await this.runInPanel(parseParams(message.params));
        return;
      case 'cancel':
        if (typeof message.id === 'string') {
          this.deps.runs.cancel(message.id);
        }
        return;
      case 'remove':
        if (typeof message.id === 'string') {
          this.deps.runs.remove(message.id);
        }
        return;
      case 'clearDone':
        this.deps.runs.clearFinished();
        return;
      default:
        this.deps.logger.debug(`未处理的面板消息：${type}`);
    }
  }

  private async searchRoots(): Promise<string[]> {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    const configured = vscode.workspace
      .getConfiguration('syscomtool')
      .get<string[]>('llama.searchPaths', []);
    const saved = this.deps.store.state().llamaProfiles.map((profile) => profile.dirPath);

    const roots = new Set<string>();
    for (const root of [...folders, ...configured, ...saved]) {
      if (root) {
        roots.add(root);
      }
    }
    return [...roots];
  }

  private async autoFind(): Promise<void> {
    const roots = await this.searchRoots();
    if (roots.length === 0) {
      void vscode.window.showWarningMessage(
        '没有可搜索的目录：请先打开一个文件夹，或用「选文件夹」直接指定 llama.cpp 所在目录。',
      );
      return;
    }

    const found = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '正在搜索 llama.cpp…' },
      () => scanForExecutables(roots, { maxDepth: 4 }),
    );

    if (found.length === 0) {
      void vscode.window.showWarningMessage(
        '没找到（llama-cli / llama-server / main）。可以点「选文件夹」指向编译输出目录，比如 build/bin。',
      );
      return;
    }

    const savedPaths = new Set(
      this.deps.store.state().llamaProfiles.map((profile) => profile.execPath.toLowerCase()),
    );
    const items: Candidate[] = found.map((execPath) => ({
      label: path.basename(execPath),
      description: path.dirname(execPath),
      detail: savedPaths.has(execPath.toLowerCase()) ? '已保存' : undefined,
      path: execPath,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: '选择 llama.cpp 可执行文件',
      placeHolder: '优先列出 build/bin 下的构建',
      matchOnDescription: true,
    });
    if (picked) {
      await this.saveProfile(picked.path);
    }
  }

  private async pickFolder(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: '选择 llama.cpp 目录',
      defaultUri: folders?.[0]?.uri,
    });
    if (!picked?.length) {
      return;
    }

    const found = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '正在该目录里找 llama.cpp…' },
      () => scanFolder(picked[0].fsPath),
    );

    if (found.length === 0) {
      void vscode.window.showWarningMessage('这个目录里没找到 llama-cli / llama-server / main。');
      return;
    }
    if (found.length === 1) {
      await this.saveProfile(found[0]);
      return;
    }

    const chosen = await vscode.window.showQuickPick(
      found.map((execPath) => ({
        label: path.basename(execPath),
        description: path.dirname(execPath),
        path: execPath,
      })),
      { title: '找到多个可执行文件，选一个' },
    );
    if (chosen) {
      await this.saveProfile(chosen.path);
    }
  }

  private async saveProfile(execPath: string): Promise<void> {
    const info = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '读取 llama.cpp 版本…' },
      () => probeVersion(execPath),
    );

    const profile = await this.deps.store.saveLlamaProfile({
      name: profileName(execPath, info.version),
      execPath,
      dirPath: path.dirname(execPath),
      version: info.version,
      build: info.build,
    });

    this.deps.logger.info(
      `已保存 llama.cpp 选项：${profile.name} → ${profile.execPath}` +
        (info.version ? '' : '（未识别到版本号）'),
    );
    await this.pushState();

    if (!info.version) {
      void vscode.window.showWarningMessage(
        '认不出这个 llama.cpp 的版本（--version 没有输出可解析的内容），路径仍然保存了。',
      );
    }
  }

  private async removeProfile(id: string | undefined): Promise<void> {
    const profile = id
      ? this.deps.store.state().llamaProfiles.find((item) => item.id === id)
      : this.activeProfile();
    if (!profile) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `删除 llama.cpp 选项「${profile.name}」？`,
      { modal: true },
      '删除',
    );
    if (confirmed !== '删除') {
      return;
    }
    await this.deps.store.removeLlamaProfile(profile.id);
    await this.pushState();
  }

  private async pickModel(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: '选择模型',
      filters: { 'GGUF 模型': ['gguf'], 所有文件: ['*'] },
    });
    if (picked?.length) {
      await this.setModel(picked[0].fsPath);
    }
  }

  private async setModel(modelPath: string): Promise<void> {
    this.modelPath = modelPath;
    await this.deps.store.addRecentModel(modelPath);
    await this.pushState();
  }

  private async copyCommand(params: LlamaParams): Promise<void> {
    const { target, problems } = this.collectTarget(params);
    if (problems.length > 0) {
      this.post({ type: 'command', command: '', problems });
      return;
    }
    const command = toShellCommand(target.execPath, buildArgs(target, params));
    await vscode.env.clipboard.writeText(command);
    void vscode.window.setStatusBarMessage('SysComTool：命令已复制', 3000);
  }

  private async runInTerminal(params: LlamaParams): Promise<void> {
    const { profile, target, problems } = this.collectTarget(params);
    if (problems.length > 0) {
      this.post({ type: 'command', command: '', problems });
      return;
    }
    const command = toShellCommand(target.execPath, buildArgs(target, params));
    const terminal = vscode.window.createTerminal({ name: 'llama.cpp', cwd: profile?.dirPath });
    terminal.show();
    terminal.sendText(command);
    this.deps.logger.info(`已在终端运行：${command}`);
  }

  private async runInPanel(params: LlamaParams): Promise<void> {
    const { profile, target, problems } = this.collectTarget(params);
    if (problems.length > 0) {
      this.post({ type: 'command', command: '', problems });
      return;
    }

    const args = buildArgs(target, params);
    const run = this.deps.runs.start({
      label: `llama · ${path.basename(this.modelPath)}`,
      execPath: target.execPath,
      args,
      cwd: profile?.dirPath,
    });
    this.deps.logger.info(`启动运行 ${run.id}：${run.command}`);
    await this.deps.store.addRecentModel(this.modelPath);
  }
}

function parseParams(input: unknown): LlamaParams {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const pick = (key: keyof LlamaParams): string =>
    typeof source[key] === 'string' ? (source[key] as string) : '';
  return {
    prompt: pick('prompt'),
    nPredict: pick('nPredict'),
    ctxSize: pick('ctxSize'),
    threads: pick('threads'),
    gpuLayers: pick('gpuLayers'),
    temperature: pick('temperature'),
    batchSize: pick('batchSize'),
    seed: pick('seed'),
    extra: pick('extra'),
  };
}
