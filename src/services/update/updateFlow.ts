import * as vscode from 'vscode';
import type { Logger } from '../../core/types';
import type { Store } from '../store';
import type { Updater } from './updater';

export interface UpdateFlowDeps {
  updater: Updater;
  store: Store;
  logger: Logger;
  currentVersion: string;
  /** 发现新版本时通知界面（右侧栏显示更新入口） */
  onUpdateFound?: (latest: string) => void;
  /** 自动检查的最小间隔，默认 24 小时 */
  intervalMs?: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** 「检查更新」的交互流程：静默/手动两种入口共用。 */
export class UpdateFlow {
  private checking = false;
  private latestVersion?: string;

  constructor(private readonly deps: UpdateFlowDeps) {}

  get available(): string | undefined {
    return this.latestVersion;
  }

  async check(options: { interactive: boolean }): Promise<void> {
    if (this.checking) {
      return;
    }
    this.checking = true;

    try {
      const candidate = await this.deps.updater.check();
      await this.deps.store.markUpdateCheck(
        candidate?.release.version ?? this.deps.currentVersion,
      );

      if (!candidate) {
        if (options.interactive) {
          void vscode.window.showInformationMessage(
            `SysComTool 已是最新版本 v${this.deps.currentVersion}`,
          );
        }
        return;
      }

      this.latestVersion = candidate.release.version;
      this.deps.onUpdateFound?.(candidate.release.version);
      this.deps.logger.info(`发现新版本 v${candidate.release.version}`);

      const choice = await vscode.window.showInformationMessage(
        `SysComTool 有新版本 v${candidate.release.version}（当前 v${this.deps.currentVersion}）`,
        '立即更新',
        '查看说明',
      );

      if (choice === '查看说明') {
        if (candidate.release.url) {
          await vscode.env.openExternal(vscode.Uri.parse(candidate.release.url));
        }
        return;
      }
      if (choice !== '立即更新') {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `正在更新到 v${candidate.release.version}…`,
          cancellable: false,
        },
        async () => {
          await this.deps.updater.install(candidate);
        },
      );

      const reload = await vscode.window.showInformationMessage(
        `已安装 v${candidate.release.version}，重启窗口后生效。`,
        '立即重启',
      );
      if (reload === '立即重启') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn(`检查更新失败：${reason}`);
      if (options.interactive) {
        void vscode.window.showWarningMessage(`检查更新失败：${reason}`);
      }
    } finally {
      this.checking = false;
    }
  }

  /** 启动时调用：受配置与 24 小时节流控制，失败只写日志。 */
  async maybeAuto(): Promise<void> {
    const enabled = vscode.workspace
      .getConfiguration('syscomtool')
      .get<boolean>('update.checkOnStartup', true);
    if (!enabled) {
      return;
    }

    const last = this.deps.store.state().lastUpdateCheckAt ?? 0;
    if (Date.now() - last < (this.deps.intervalMs ?? DAY)) {
      return;
    }
    await this.check({ interactive: false });
  }
}
