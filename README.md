# SysComTool

> 一个 VS Code 扩展：右侧栏按归属分组、可搜索的功能入口，外加一个图形化的 llama.cpp 运行器。

装好之后活动栏多一个图标，点开就是功能列表；每个功能是独立文件、独立命令，互不 import。
llama.cpp 那个功能可以同时跑多个任务，关掉面板也不会中断。

## 现在有什么

| 能力 | 说明 |
| --- | --- |
| 右侧栏功能面板 | 搜索框按名字/说明过滤，功能按 `category` 分组；点一项即执行 |
| 图形化 llama.cpp | 自动搜索/手动指定编译好的 llama.cpp，识别版本并存为「选项」；选模型、填参数、预览命令、复制、在终端跑、在面板里跑 |
| 多任务并行 | 运行有并发上限（默认 3），超出的排队；每个任务独立输出、独立终止 |
| 自动更新 | 启动时静默检查 GitHub Releases（24 小时节流），也可随时手动「检查更新」 |
| 日志 | 独立输出通道，功能的异常只记日志 + 一条提示，不弹堆栈 |

## 安装与更新

**第一次**（生成并安装 VSIX）：

```powershell
npm install
npm run package
code --install-extension syscomtool-0.2.1.vsix --force
```

之后**不用再手动装**：仓库里打了 `v*` 标签时，
[release.yml](.github/workflows/release.yml) 会构建 VSIX 并挂到 GitHub Release；
扩展启动时发现新版本会提示「立即更新」，点一下就走完下载 + `code --install-extension`，再点「立即重启」生效。

> 自动更新依赖 GitHub Releases 能访问。内网/离线环境把 `syscomtool.update.feedUrl`
> 指到自己的镜像，或直接把 `syscomtool.update.checkOnStartup` 关掉、手动装 VSIX。

**开发模式**（改代码）：

```powershell
npm install
npm run watch      # 或 Ctrl+Shift+B
```

用 VS Code 打开本目录按 `F5`，会启动扩展开发宿主；改完在宿主窗口 `Ctrl+R` 重载。

## 图形化 llama.cpp 怎么用

命令面板 → `SysComTool: 图形化 llama.cpp`，或直接点右侧栏里的这一项。面板分五段：

1. **llama.cpp**：点「自动搜索」，会在打开的工作区、`llama.searchPaths`、已保存选项的目录里找
   `llama-cli[.exe]` / `llama-server[.exe]` / `main[.exe]`，跑 `--version` 认出构建号，
   存成一条「选项」（路径 + 版本）。也可以「选文件夹」直接指定，比如 `build/bin`。
2. **模型**：选 `.gguf`，最近用过的会显示成小标签，点一下切回去。
3. **参数**：提示词、`-n`、`-c`、`-t`、`-ngl`、`--temp`、`-b`、`-s`，外加一个「额外参数」。
   **留空 = 不传这个参数**（不是传空字符串）。
4. **命令**：实时生成等价命令行。可以「复制」、「在终端运行」（保留交互，适合对话模式），
   或「运行」（在面板里跑，输出直接流到下方）。
5. **运行**：每个任务一张卡片，带状态、耗时、退出码、输出；可以单独「终止」或「移除」。
   超过并发上限的任务显示「排队中」，前面的结束后自动开始。

几点行为说明：

- 面板里「运行」用的是 argv 直传，不经 shell，所以提示词里的引号、换行原样传给 llama.cpp；
- 「在终端运行」的命令按 **PowerShell** 语法加引号（VS Code 在 Windows 上的默认终端），
  命令预览里换行会被压成空格；
- 关掉面板不会杀任务，重新打开还能看到输出（任务归 `RunManager` 管，不归面板）。

## 配置

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `syscomtool.llama.maxConcurrent` | `3` | 同时运行几个 llama 任务 |
| `syscomtool.llama.searchPaths` | `[]` | 「自动搜索」额外扫描的目录 |
| `syscomtool.update.checkOnStartup` | `true` | 启动时检查更新（24 小时节流） |
| `syscomtool.update.feedUrl` | GitHub latest | 更新源，可指向镜像 |
| `syscomtool.hello.greeting` | `世界` | 示例功能的问候对象 |

## 目录结构

```text
SysComTool/
├─ src/
│  ├─ extension.ts             # activate：装配日志/状态/任务/面板/侧边栏，启动自动更新检查
│  ├─ core/                    # 与具体功能无关
│  │  ├─ types.ts              # Feature / FeatureContext / HostApi 契约
│  │  ├─ host.ts               # 校验 + 注册 + 错误隔离（可在 Node 里单测）
│  │  ├─ context.ts            # syscomtool.* 配置读取
│  │  └─ log.ts                # OutputChannel 日志
│  ├─ services/
│  │  ├─ store.ts              # globalState 持久化，写入串行化
│  │  ├─ llama/
│  │  │  ├─ detect.ts          # 找可执行文件、解析 --version
│  │  │  ├─ command.ts         # 参数 → argv → 命令行（纯函数）
│  │  │  └─ runs.ts            # 并发队列、输出缓冲、终止
│  │  └─ update/
│  │     ├─ check.ts           # 版本比较、Release 解析、挑资产（纯函数）
│  │     ├─ updater.ts         # 下载 + code --install-extension
│  │     └─ updateFlow.ts      # 手动/静默更新的交互流程
│  ├─ views/
│  │  ├─ featureListView.ts    # 右侧栏 WebviewView
│  │  ├─ sidebarHtml.ts        # 搜索 + 分组
│  │  ├─ llamaPanel.ts         # llama 面板控制器
│  │  └─ llamaHtml.ts          # llama 面板界面
│  └─ features/                # 一个功能一个文件
│     ├─ index.ts              # createFeatures()：清单 + 依赖注入
│     ├─ hello.ts / llama.ts / update.ts
│  └─ test/                    # node:test，42 个用例
├─ docs/                       # 架构、加功能指南
├─ media/                      # 活动栏图标
├─ .github/workflows/
│  ├─ ci.yml                   # 类型检查 + 测试 + 打包
│  └─ release.yml              # 打 tag 时发 Release（自动更新的来源）
└─ package.json
```

## 加一个功能

```ts
// src/features/ping.ts
import * as vscode from 'vscode';
import type { Feature } from '../core/types';

export const pingFeature: Feature = {
  id: 'syscomtool.ping',
  title: 'Ping 一下',
  category: '通用',              // 右侧栏的分组标题
  description: '确认外部依赖是否可达',
  async run(ctx) {
    ctx.logger.info('ping 开始');
    await vscode.window.showInformationMessage('pong');
  },
};
```

再把它加进 `src/features/index.ts` 的 `createFeatures()`，并在 `package.json` 的
`contributes.commands` 里声明同 id 的命令。完整步骤见
[docs/writing-a-feature.md](docs/writing-a-feature.md)。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `npm install` | 装依赖（TypeScript、`@types/vscode`、vsce） |
| `npm run check` | 只做类型检查 |
| `npm test` | 编译 + `node --test`（纯 Node，不需要 Electron） |
| `npm run package` | 生成 `syscomtool-<version>.vsix` |
| `F5` | 扩展开发宿主调试 |

## 版本与发布

自动更新靠 Release：**改 `package.json` 的 version → 提交 → 打同名 tag → push tag**，
CI 会构建并发布 VSIX，已安装的扩展下次检查时就能升级。

## 协作

`main` 是受保护分支，改动走 PR —— 见 [CONTRIBUTING.md](CONTRIBUTING.md)。
设计取舍见 [docs/architecture.md](docs/architecture.md)。

## 许可

[MIT](LICENSE)。辅助工具为开源项目，欢迎在赛题之外复用。
