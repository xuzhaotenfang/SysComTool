# SysComTool

> 一个 VS Code 扩展：把 proj59 需要的多个小功能，收在**侧边栏的一个面板 + 命令面板**里。

装好之后活动栏会多一个图标，点开就是功能列表；也可以 `Ctrl+Shift+P` 搜 `SysComTool: ...`。
每个功能是独立的文件、独立的命令，互相不 import —— 加功能不用动核心。

## 现在有什么

| 能力 | 说明 |
| --- | --- |
| 侧边栏「功能」面板 | 列出现有功能，点一下执行；加载失败的功能标灰并写明原因 |
| 命令面板 | 每个功能一个命令，另有「打开功能面板」「查看日志」 |
| 日志面板 | 独立的 OutputChannel，带时间戳；功能内部异常不外冒，只记日志 + 一条提示 |
| 配置项 | 功能通过上下文读取 `syscomtool.*` 设置（示例：`syscomtool.hello.greeting`） |

目前只有一个示例功能 `hello`（打个招呼），其余是骨架，见下方路线图。

## 安装

**A. 装 VSIX（日常使用）**

```powershell
npm install
npm run package        # 生成 syscomtool-0.1.0.vsix
code --install-extension syscomtool-0.1.0.vsix --force
```

也可以在扩展面板右上角 `...` → 「从 VSIX 安装…」。

**B. 开发模式（改代码）**

```powershell
npm install
npm run watch          # 或 Ctrl+Shift+B 跑 compile
```

用 VS Code 打开本目录，按 `F5` 会启动「扩展开发宿主」窗口 —— 里面加载的就是当前代码。
改完之后在宿主窗口按 `Ctrl+R` 重载即可。

## 用法

- 活动栏点 SysComTool 图标 → 「功能」→ 点某一项；
- 或 `Ctrl+Shift+P` → `SysComTool: 打开功能面板` → 选功能；
- `SysComTool: 查看日志` 打开输出面板，功能里的 `ctx.logger.*` 都写在这儿；
- 设置里搜 `syscomtool`，可以改示例功能的问候对象。

## 目录结构

```text
SysComTool/
├─ src/
│  ├─ extension.ts           # 入口：activate → 建日志/上下文 → 注册功能 → 建面板
│  ├─ core/
│  │  ├─ types.ts            # Feature / FeatureContext / HostApi 契约（不 import vscode）
│  │  ├─ host.ts             # 校验 + 注册 + 错误隔离（可在 Node 里单测）
│  │  ├─ context.ts          # 读取 syscomtool.* 配置
│  │  ├─ log.ts              # OutputChannel 日志
│  │  └─ tree.ts             # 侧边栏功能列表
│  ├─ features/
│  │  ├─ index.ts            # 内置功能清单，加功能就改这里
│  │  └─ hello.ts            # 示例功能，兼模板
│  └─ test/host.test.ts      # node:test 单测
├─ media/syscomtool.svg      # 活动栏图标
├─ docs/
│  ├─ architecture.md        # 分层、生命周期、契约、打包
│  └─ writing-a-feature.md   # 从零加一个功能
├─ .vscode/                  # F5 调试与编译任务
├─ .vscodeignore             # 决定打进 VSIX 的文件
├─ package.json              # 扩展清单：命令、视图、配置
├─ CONTRIBUTING.md
└─ README.md
```

## 加一个功能

```ts
// src/features/ping.ts
import * as vscode from 'vscode';
import type { Feature } from '../core/types';

export const pingFeature: Feature = {
  id: 'syscomtool.ping',            // 必须与 package.json 的 commands 一致
  title: 'Ping 一下',
  description: '确认外部依赖是否可达',
  async run(ctx) {
    ctx.logger.info('ping 开始');
    await vscode.window.showInformationMessage('pong');
  },
};
```

然后两步：把 `pingFeature` 加进 `src/features/index.ts` 的 `FEATURES`，再在
`package.json` 的 `contributes.commands` 里声明 `syscomtool.ping`。

完整步骤（含测试、长任务、外部进程）见 [docs/writing-a-feature.md](docs/writing-a-feature.md)。

## 状态与路线图

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 功能面板 / 命令面板 / 日志 / 配置 | 可用 | 骨架已跑通 |
| `hello` | 可用 | 示例，兼新功能模板 |
| `envcheck` | 规划中 | 环境自检：Python、编译器、内存与页大小、llama.cpp 版本与后端 |
| `bench` | 规划中 | 批量跑 benchmark，记录 tok/s、峰值内存 |
| `memtrace` | 规划中 | 采样推理进程的内存 / 换页 / 显存 |
| `report` | 规划中 | 汇总成「内存 × 速度 × 质量」对比表 |
| `pack` | 规划中 | 按赛题要求整理提交目录 |

「规划中」= 只有名字和职责，还没有代码。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `npm install` | 装依赖（TypeScript、`@types/vscode`、vsce） |
| `npm run check` | 只做类型检查，不产出 |
| `npm run compile` | 编译到 `out/` |
| `npm run watch` | 监听编译 |
| `npm test` | 编译 + `node --test` 跑 `src/test/*.test.ts` |
| `npm run package` | 生成 `syscomtool-<version>.vsix` |
| `F5` | 启动扩展开发宿主调试 |

## 协作

`main` 是受保护分支，改动走 PR —— 见 [CONTRIBUTING.md](CONTRIBUTING.md)。
设计取舍见 [docs/architecture.md](docs/architecture.md)。

## 许可

[MIT](LICENSE)。辅助工具为开源项目，欢迎在赛题之外复用。
