# 加一个功能

目标：10 分钟内让 `SysComTool: Ping 一下` 出现在面板和命令面板里。
可直接对照的现成例子：`src/features/hello.ts`。

## 第 1 步：新建功能文件

`src/features/ping.ts`：

```ts
import * as vscode from 'vscode';
import type { Feature } from '../core/types';

export const pingFeature: Feature = {
  id: 'syscomtool.ping',                       // 命令 id，同时也是面板项的 id
  title: 'Ping 一下',
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
import { helloFeature } from './hello';
import { pingFeature } from './ping';        // 新增
import type { Feature } from '../core/types';

export const FEATURES: readonly Feature[] = [
  helloFeature,
  pingFeature,                               // 新增
];
```

## 第 3 步：在 package.json 里声明命令

不声明的话，功能只在侧边栏出现，**命令面板里搜不到**：

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

## 第 5 步：跑起来

```powershell
npm run check
npm test
```

然后在 VS Code 里按 `F5` 启动扩展开发宿主，在新窗口里验证面板和命令面板都出现了。
改代码时用 `npm run watch`，宿主窗口 `Ctrl+R` 重载。

## 约定

| 项 | 约定 |
| --- | --- |
| `id` | `syscomtool.<name>`，全小写，可多级：`syscomtool.mem.trace` |
| 文件名 | 小写短横线：`mem-trace.ts` |
| 标题 | 动词短语，短，能独立看懂：`跑一次采样`，不要 `功能一` |
| 输出 | `ctx.logger.info/warn/error/debug`，不用 `console.log` |
| 用户可见结果 | 成功用通知或面板结果，失败用 `showErrorMessage` 并写清「怎么办」 |
| 错误 | 直接 `throw new Error('...')`，宿主会统一转成日志 + 提示 |
| 依赖 | 只有本功能用的第三方包，在 PR 里说明必要性；能不加就不加 |

## 常见写法

**长任务 + 进度**

```ts
await vscode.window.withProgress(
  { location: vscode.ProgressLocation.Notification, title: '采样中', cancellable: true },
  async (progress, token) => {
    for (let i = 0; i < 10 && !token.isCancellationRequested; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      progress.report({ increment: 10, message: `${i + 1}/10` });
    }
  },
);
```

**调用外部程序（跑 benchmark、llama.cpp）**

```ts
import { spawn } from 'node:child_process';

async function runCommand(ctx: FeatureContext, command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: true });
    child.stdout.on('data', (chunk: Buffer) => ctx.logger.info(chunk.toString().trim()));
    child.stderr.on('data', (chunk: Buffer) => ctx.logger.warn(chunk.toString().trim()));
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}
```

**要用户输入**

```ts
const target = await vscode.window.showInputBox({ prompt: '目标地址', placeHolder: '127.0.0.1:8080' });
if (!target) {
  return;   // 用户取消，静默返回，不要当错误
}
```

**在终端里跑（保留交互）**

```ts
const terminal = vscode.window.createTerminal('llama.cpp');
terminal.show();
terminal.sendText('./build/bin/llama-cli -m model.gguf -p "你好"');
```

## 检查单

- [ ] `src/features/<name>.ts` 已建，导出 `Feature`
- [ ] 已加入 `src/features/index.ts` 的 `FEATURES`
- [ ] `package.json` 的 `contributes.commands` 有同 id 的命令
- [ ] 新配置项在 `contributes.configuration` 里声明过
- [ ] `npm run check`、`npm test` 通过
- [ ] F5 的宿主窗口里：面板能点、命令面板能搜到、日志有输出
- [ ] `npm run package` 后 `npx vsce ls --tree` 里没有多余文件
