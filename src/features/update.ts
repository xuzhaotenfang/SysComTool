import type { Feature } from '../core/types';

/** 手动检查更新（对应的自动检查在扩展启动时静默进行）。 */
export function createUpdateFeature(check: () => void): Feature {
  return {
    id: 'syscomtool.checkUpdate',
    title: '检查更新',
    category: '通用',
    description: '从 GitHub Releases 检查并安装新版本，装完重启窗口生效',
    run(): void {
      check();
    },
  };
}
