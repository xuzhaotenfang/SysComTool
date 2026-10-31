import * as vscode from 'vscode';
import type { FeatureContext, Logger } from './types';

/** 组装功能运行时上下文（唯一与 vscode 配置 API 打交道的地方）。 */
export function createFeatureContext(logger: Logger, extensionVersion: string): FeatureContext {
  return {
    logger,
    extensionVersion,
    getConfig<T>(key: string, fallback: T): T {
      const value = vscode.workspace.getConfiguration('syscomtool').get<T>(key);
      return value === undefined ? fallback : value;
    },
  };
}
