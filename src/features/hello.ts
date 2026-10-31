import * as vscode from 'vscode';
import type { Feature } from '../core/types';

/**
 * 示例功能，也是新功能的模板。
 *
 * 只做一件事：读配置、记日志、弹提示 —— 用来验证
 * 「面板点击 → 命令分发 → 上下文 → 输出」整条链路。
 */
export const helloFeature: Feature = {
  id: 'syscomtool.hello',
  title: '打个招呼',
  category: '通用',
  description: '示例功能：读取设置里的问候对象并弹一条消息。复制它就能开始写新功能。',
  requires: [],
  async run(ctx): Promise<void> {
    const who = ctx.getConfig('hello.greeting', '世界');
    ctx.logger.info(`hello 功能被触发，问候对象：${who}`);
    await vscode.window.showInformationMessage(
      `你好，${who}！—— 来自 SysComTool ${ctx.extensionVersion}`,
    );
  },
};
