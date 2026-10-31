import * as vscode from 'vscode';
import type { Logger } from './types';

/** 基于 OutputChannel 的日志实现：时间 + 级别 + 消息。 */
export class OutputLogger implements Logger {
  private readonly channel: vscode.OutputChannel;

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name);
  }

  info(message: string): void {
    this.write('信息', message);
  }

  warn(message: string): void {
    this.write('警告', message);
  }

  error(message: string): void {
    this.write('错误', message);
  }

  debug(message: string): void {
    this.write('调试', message);
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private write(level: string, message: string): void {
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    this.channel.appendLine(`[${stamp}] [${level}] ${message}`);
  }
}
