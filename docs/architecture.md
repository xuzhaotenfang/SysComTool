# 架构说明

## 目标与非目标

**目标**

- 一个扩展里放**多个互不相关的小功能**，加功能的成本是「新建一个文件 + 注册一行」；
- 核心极薄：不 import 任何功能，功能之间也互不 import；
- 任何一个功能出错，不影响其余功能和扩展启动；
- 单测能在纯 Node 里跑，不需要拉起 VS Code。

**非目标**

- 不做「扩展之间的插件市场」——VS Code 不允许一个扩展动态发现另一个扩展的功能（见下）；
- 不做 Webview 界面（当前全部用原生 TreeView / QuickPick / 通知）；
- 不替功能决定它内部怎么实现。

## 为什么"插件"落成了 features 目录

最初想过让功能像插件一样独立分发，但 VS Code 的模型不支持：扩展之间没有互相发现功能的机制，
`extends`/依赖只能声明扩展依赖，不能拿到对方导出的"功能"。

所以这里的"可插拔"落在**仓库内部**：

```text
src/features/<name>.ts   一个功能 = 一个文件 = 一个命令 id
src/features/index.ts    唯一的清单，决定谁被注册
```

好处是仍然满足「加功能不动核心」；代价是功能必须跟扩展一起发布。
将来如果真有独立分发的需求，正确做法是**拆成独立扩展**，而不是在本扩展里造插件容器。

重活（跑 benchmark、调 llama.cpp）建议放在功能里调用外部命令行/脚本，
这样功能保持轻薄，脚本也能脱离编辑器单独跑。

## 分层

```text
        ┌────────────────────────────────────────────┐
 activate│ extension.ts                              │
        │  建日志 → 建上下文 → 注册功能 → 建面板/命令 │
        └───────┬──────────────────────┬─────────────┘
                │                      │
        ┌───────▼──────────┐   ┌───────▼──────────┐
        │ core/（无 UI 依赖）│   │ core/（VS Code）  │
        │  host  校验/注册/  │   │  log  输出通道    │
        │  types 契约        │   │  context 配置     │
        │                   │   │  tree  侧边栏     │
        └───────┬───────────┘   └──────────────────┘
                │ 只调用 feature.run(ctx)
        ┌───────▼───────────────────────────────────┐
        │ features/*.ts ── 每个文件一个 Feature      │
        └───────────────────────────────────────────┘
```

依赖方向单向：`extension → core ← features`。

## 生命周期

1. **activate**：`extension.ts` 创建 `OutputLogger` 和 `FeatureContext`；
2. **注册**：`FeatureHost.registerAll(FEATURES)` 逐个校验 → `vscode.commands.registerCommand`；
   校验失败或注册抛错的记录进 `failed`，只写日志，不中断启动；
3. **呈现**：`FeatureTreeProvider` 把功能列表挂到活动栏视图 `syscomtool.features`；
   另注册两个内置命令 `syscomtool.list`（QuickPick 选功能）与 `syscomtool.showLog`；
4. **执行**：用户点面板/命令 → 命令回调 → `dispatch()` → `feature.run(ctx)`；
   抛错被捕获为「日志 + 一条错误通知」，不会出现红色堆栈弹窗；
5. **deactivate / dispose**：`host` 与 `tree` 随 `context.subscriptions` 一起释放，命令注销。

## 功能契约

| 字段/方法 | 是否必需 | 说明 |
| --- | --- | --- |
| `id` | 是 | 命令 id，形如 `syscomtool.hello`；必须与 `package.json` 的 `contributes.commands` 一致 |
| `title` | 是 | 面板与命令面板显示名 |
| `description` | 否 | 面板悬停提示 |
| `requires` | 否 | 依赖的外部能力（`llama.cpp`、模型文件），仅作提示 |
| `run(ctx)` | 是 | 执行体，`void | Promise<void>` |

`FeatureContext` 提供三样东西：`logger`（info/warn/error/debug/show）、`extensionVersion`、
`getConfig(key, fallback)`（读 `syscomtool.*`，不写死默认值）。

**故意不提供**的东西：`vscode` 模块本身、扩展 `context`、UI 句柄。
功能需要什么就 `import * as vscode from 'vscode'`，核心不替它做封装。

## 错误隔离的三层

| 层 | 失败时 |
| --- | --- |
| 功能定义不合法（id 非法/重复、缺 title、缺 run） | 记为加载失败，面板标灰，其他功能照常 |
| `registerCommand` 抛错 | 同上，记录原因 |
| `run()` 抛错 / Promise 拒绝 | 捕获 → `logger.error` → `showErrorMessage`，命令仍然可再次执行 |

## 面板与命令面板

- **面板**：`TreeView` 数据源就是 `FEATURES`。注册失败的项仍然显示（标灰 + 悬停原因），
  这样"我明明写了却没出现"能被一眼看到；
- **命令面板**：靠 `package.json` 的 `contributes.commands` 声明，不看 `FEATURES`。
  两处不同步时：面板有点、命令面板搜不到（或反过来）——这是最容易踩的坑，已在文档和 PR 清单里强调。

## 配置

```jsonc
// 读取方：ctx.getConfig('hello.greeting', '世界')
// 声明方：package.json → contributes.configuration → syscomtool.hello.greeting
```

新增配置一律走 `contributes.configuration` 声明（这样设置页有说明、有默认值），
代码里通过 `ctx.getConfig` 读，不要直接 `workspace.getConfiguration`。

## 打包

`vsce package` 依据 `.vscodeignore` 决定内容，安装包里只应有：

```text
out/extension.js, out/core/*, out/features/*, media/*, package.json, README, LICENSE
```

`src/`、`out/test/`、`docs/`、`.vscode/`、`node_modules/` 都不该出现。
`npm run package` 之后用 `npx vsce ls --tree` 检查一遍。

## 测试策略

- `core/host.ts` 与 `core/types.ts` 不 import `vscode`，靠注入 `HostApi` 在 Node 里测；
- 测试直接 `node --test`（无需 mocha / Electron），编译产物在 `out/test/`；
- 功能文件依赖 `vscode`，不做单元测试，靠扩展开发宿主（F5）手工验证；
- 需要外部资源的逻辑（模型、llama.cpp）应放在被功能调用的独立脚本里，用脚本自己的测试覆盖。

## 后续扩展点

- 面板按 `requires` 分组（`TreeView` 两级）；
- 长任务统一 `withProgress` 包装，并把取消信号传给功能；
- 状态栏入口（当前运行的功能 / 最近一次结果）；
- 结果产物目录约定（`runs/<时间戳>/`），供 `bench` / `memtrace` / `report` 共享；
- 集成终端：把 `llama.cpp` 的命令跑在终端里，保留用户交互能力。
