/**
 * 功能宿主：把 `Feature[]` 变成一组 VS Code 命令。
 *
 * 三条规则：
 * 1. 启动时逐个校验并注册，**单个功能出问题只记录、不中断**；
 * 2. 功能执行抛错时不冒泡到 VS Code，转为日志 + 一条错误提示；
 * 3. 宿主可整体 dispose，用于扩展卸载 / 重载。
 */

import type {
  DisposableLike,
  Feature,
  FeatureContext,
  HostApi,
  RegistrationReport,
} from './types';

/** 命令 id 允许的形态：`syscomtool.hello`、`syscomtool.mem.trace` */
const FEATURE_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

/** 返回问题描述；合法时返回 null。 */
function validate(feature: Feature, seen: ReadonlySet<string>): string | null {
  if (!feature.id) {
    return '缺少 id';
  }
  if (!FEATURE_ID.test(feature.id)) {
    return `id "${feature.id}" 不合法，应形如 syscomtool.hello`;
  }
  if (seen.has(feature.id)) {
    return 'id 与其他功能重复';
  }
  if (!feature.title || !feature.title.trim()) {
    return '缺少 title';
  }
  if (typeof feature.run !== 'function') {
    return '缺少 run()';
  }
  return null;
}

export class FeatureHost {
  private readonly disposables: DisposableLike[] = [];

  constructor(
    private readonly api: HostApi,
    private readonly ctx: FeatureContext,
  ) {}

  /** 注册一批功能，返回成功与失败清单（失败项会被写进日志面板）。 */
  registerAll(features: readonly Feature[]): RegistrationReport {
    const registered: string[] = [];
    const failed: RegistrationReport['failed'] = [];
    const seen = new Set<string>();

    for (const feature of features) {
      const problem = validate(feature, seen);
      if (problem) {
        failed.push({ id: feature.id || '(未命名)', reason: problem });
        continue;
      }

      seen.add(feature.id);
      try {
        const disposable = this.api.registerCommand(feature.id, () => this.dispatch(feature));
        this.disposables.push(disposable);
        registered.push(feature.id);
      } catch (error) {
        failed.push({ id: feature.id, reason: describeError(error) });
      }
    }

    return { registered, failed };
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private async dispatch(feature: Feature): Promise<void> {
    this.ctx.logger.info(`运行功能：${feature.title}（${feature.id}）`);
    try {
      await feature.run(this.ctx);
    } catch (error) {
      const reason = describeError(error);
      this.ctx.logger.error(`功能 ${feature.id} 执行失败：${reason}`);
      this.api.notifyError(`SysComTool：${feature.title} 执行失败（${reason}）`);
    }
  }
}
