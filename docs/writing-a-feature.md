# 加一个功能

目标：10 分钟内让 `SysComTool: Ping 一下` 出现在右侧栏（分组 + 可搜索）和命令面板里。
现成例子：`src/features/hello.ts`、`src/features/llama.ts`。

## 第 1 步：新建功能文件

`src/features/ping.ts`：

```ts
import * as vscode from 'vscode';
import type { Feature } from '../core/types';

export const pingFeature: Feature = {
  id: 'syscomtool.ping',                 // 命令 id，也是侧边栏项的 id
  title: 'Ping 一下',
  category: '通用',                      // 右侧栏的分组标题
  description: '确认外部依赖是否可达',
  async run(ctx) {
    ctx.logger.info('ping 开始');
    await vscode.window.showInformationMessage('pong');
  },
};
```

## 第 2 步：加进清单

`src/features/index.ts`：

```ts
export function createFeatures(deps: FeatureDeps): Feature[] {
  return [
    helloFeature,
    createLlamaFeature(deps.panel),
    pingFeature,                       // 新增
    createUpdateFeature(/* ... */),
  ];
}
```

## 第 3 步：在 package.json 声明命令

不声明的话，右侧栏能看到，**命令面板里搜不到**：

```jsonc
"contributes": {
  "commands": [
    { "command": "syscomtool.ping", "title": "Ping 一下", "category": "SysComTool" }
  ]
}
```

`command` 必须与 `Feature.id` 完全一致。

## 第 4 步：需要配置就声明

```jsonc
"configuration": {
  "properties": {
    "syscomtool.ping.timeout": {
      "type": "number",
      "default": 3,
      "description": "超时时间（秒）"
    }
  }
}
```

代码里读：

```ts
const timeout = ctx.getConfig('ping.timeout', 3);   // 注意不带 "syscomtool." 前缀
```

## 第 5 步：需要共享依赖时注入

功能如果需要面板、任务队列这类对象，写成工厂函数，由 `createFeatures(deps)` 传入，
**不要在功能文件里 import `extension.ts`**（会成环，也没法单测）：

```ts
// src/features/memtrace.ts
export function createMemtraceFeature(runs: RunManager): Feature {
  return { id: 'syscomtool.memtrace', title: '内存采样', category: '评测', run: () => { /* 用 runs 起任务 */ } };
}
```

## 第 6 步：跑起来

```powershell
npm run check
npm test
```

按 `F5` 启动扩展开发宿主，确认：右侧栏有这一项、搜索能搜到、点了能执行、日志有记录。

## 约定

| 项 | 约定 |
| --- | --- |
| `id` | `syscomtool.<name>`，全小写，可多级：`syscomtool.mem.trace` |
| `category` | 简短名词，同一批功能用同一个：`通用`、`llama`、`评测` |
| 文件名 | 小写短横线：`mem-trace.ts` |
| 标题 | 动词短语，能独立看懂：`跑一次采样`，不要 `功能一` |
| 输出 | `ctx.logger.info/warn/error/debug`，不用 `console.log` |
| 错误 | 直接 `throw new Error('...')`，宿主统一转成日志 + 提示；不要 `process.exit` |
| 依赖 | 只有本功能用的第三方包，PR 里说明必要性 |

## 并发：别把别人堵住

功能之间是独立 dispatch 的，但**别在 `run()` 里做同步长阻塞**，否则会卡住整个扩展宿主。三种做法：

**短任务 + 进度**（30 秒以内）

```ts
await vscode.window.withProgress(
  { location: vscode.ProgressLocation.Notification, title: '采样中', cancellable: true },
  async (progress, token) => {
    for (let i = 0; i < 10 && !token.isCancellationRequested; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      progress.report({ increment: 10, message: `${i + 1}/10` });
    }
  },
);
```

**长任务且要并行**：接 `RunManager`（`deps.runs`），它已经处理了队列、上限、输出、终止，
并且任务生命周期与视图解耦。参考 `src/services/llama/runs.ts`。

**长时间交互**：开终端，让命令跑在终端里（`createTerminal` + `sendText`），
用户能自己 Ctrl+C，扩展这边不留状态。

## 要做界面的话

- 需要「搜索 + 分组」这类列表：参考 `views/sidebarHtml.ts`（webview，前端过滤）；
- 需要表单 + 长任务：参考 `views/llamaPanel.ts` + `views/llamaHtml.ts`；
- 两条硬规则：**CSP 带 nonce**、**只用 `textContent` 渲染用户数据**（不拼 HTML）。

## 检查单

- [ ] `src/features/<name>.ts` 已建，导出 `Feature`（或工厂函数）
- [ ] 已加入 `createFeatures()`
- [ ] `package.json` 的 `contributes.commands` 有同 id 的命令
- [ ] 新配置项在 `contributes.configuration` 里声明
- [ ] 有纯逻辑就补单测（`src/test/*.test.ts`）
- [ ] `npm run check`、`npm test` 通过
- [ ] F5 宿主里：侧边栏分组正确、搜索能命中、执行有日志
- [ ] `npm run package` 后 `npx vsce ls --tree` 里没有多余文件
