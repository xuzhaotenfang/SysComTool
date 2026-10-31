/**
 * 功能（Feature）的契约。
 *
 * 这里刻意不 import `vscode`（只有类型引用），
 * 这样核心的注册与分发逻辑可以在扩展宿主之外被单元测试。
 */

/** 可释放对象，与 `vscode.Disposable` 结构一致。 */
export interface DisposableLike {
  dispose(): void;
}

/** 日志通道。插件不直接写 OutputChannel，统一走这里。 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  /** 把日志面板切到前台 */
  show(): void;
}

/** 功能运行时能拿到的东西。 */
export interface FeatureContext {
  readonly logger: Logger;
  readonly extensionVersion: string;
  /** 读取 `syscomtool.*` 配置项，未设置时返回 fallback */
  getConfig<T>(key: string, fallback: T): T;
}

/**
 * 一个功能 = 一个命令 + 面板里的一行。
 *
 * `id` 必须同时出现在 `package.json` 的 `contributes.commands` 里，
 * 否则命令面板里搜不到它（面板仍然可用）。
 */
export interface Feature {
  /** 命令 id，形如 `syscomtool.hello` */
  readonly id: string;
  /** 面板与命令面板里显示的名字 */
  readonly title: string;
  /** 一句话说明，显示在面板的悬停提示里 */
  readonly description?: string;
  /** 依赖的外部能力（llama.cpp、模型文件等），仅用于提示 */
  readonly requires?: readonly string[];
  run(ctx: FeatureContext): void | Promise<void>;
}

/** 宿主需要的少量 VS Code 能力，注入进来以便测试。 */
export interface HostApi {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): DisposableLike;
  /** 执行失败时提示用户（扩展里是 showErrorMessage） */
  notifyError(message: string): void;
}

export interface RegistrationFailure {
  id: string;
  reason: string;
}

export interface RegistrationReport {
  registered: string[];
  failed: RegistrationFailure[];
}
