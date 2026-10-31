# 架构说明

## 目标与非目标

**目标**

- 一个扩展里放多个互不相关的功能，加功能的成本是「新建一个文件 + 注册一行」；
- 每个功能独立执行、独立报错，**可以同时使用**；
- llama 这种重活有自己的并发模型（队列 + 上限 + 独立输出 + 可终止）；
- 单测能在纯 Node 里跑，不需要 Electron / VS Code 实例。

**非目标**

- 不做「扩展之间的插件市场」——VS Code 不允许一个扩展动态发现另一个扩展的导出；
- 不做通用任务调度器（llama 任务之外的异步逻辑，功能自己用 `withProgress` 处理）；
- 不替功能决定内部实现。

## 分层

```text
                ┌────────────────────────────────────────────┐
   activate ───▶│ extension.ts                               │
                │ 日志 → 状态 → 任务 → 面板 → 侧边栏 → 功能   │
                └───────┬───────────────────────┬────────────┘
                        │                       │
          ┌─────────────▼────────┐   ┌──────────▼─────────────┐
          │ core/                │   │ views/                 │
          │  types  契约          │   │  featureListView 侧边栏│
          │  host   注册/隔离     │   │  sidebarHtml   搜索/分组│
          │  context/log         │   │  llamaPanel/html 面板  │
          └─────────────┬────────┘   └──────────┬─────────────┘
                        │                       │
          ┌─────────────▼───────────────────────▼─────────────┐
          │ services/                                        │
          │  store        持久化（串行写）                    │
          │  llama/detect 找构建、认版本                      │
          │  llama/command 参数→argv（纯函数）                │
          │  llama/runs   并发队列 + 输出 + 终止              │
          │  update/*     查 Release → 下载 → 安装            │
          └──────────────────────────────────────────────────┘
```

依赖方向单向：`extension → core / views / services`，`features` 只依赖 `core` 的契约。

## 启动流程

1. `activate()` 建 `OutputLogger`、`FeatureContext`（读配置）、`Store`（globalState）；
2. 建 `RunManager`（并发上限来自 `llama.maxConcurrent`）与 `LlamaPanel`；
3. 建 `Updater` + `UpdateFlow`（自动检查是静默的，失败只写日志）；
4. `createFeatures({ panel, updateFlow })` 组装功能清单；
5. `FeatureHost.registerAll()` 注册命令，失败的记录进 `report.failed`；
6. 注册左侧栏 `WebviewViewProvider`，以及 `syscomtool.showLog`、`syscomtool.list` 两个内置命令；
7. `void updateFlow.maybeAuto()`——**不 await**，绝不阻塞启动。

## 功能契约

| 字段/方法 | 必需 | 说明 |
| --- | --- | --- |
| `id` | 是 | 命令 id，形如 `syscomtool.llama`，必须与 `package.json` 的 `contributes.commands` 一致 |
| `title` | 是 | 侧边栏与命令面板显示名 |
| `category` | 否 | 左侧栏分组标题，缺省「通用」 |
| `description` | 否 | 侧边栏第二行 + 悬停提示 |
| `requires` | 否 | 依赖的外部能力，仅提示 |
| `run(ctx)` | 是 | 执行体，`void | Promise<void>` |

`FeatureContext` 只给三样：`logger`、`extensionVersion`、`getConfig(key, fallback)`。
需要 `vscode` 就自己 import，核心不封装 API。

## 左侧栏（WebviewView）

用 webview 而不是 TreeView，是因为要「搜索框 + 分组」这两件树控件给不了的事：

- 初始化时把 `state`（功能清单 + 失败项 + 可用更新）以 JSON 注入 HTML；
- 之后状态变化通过 `postMessage({type:'state'})` 推送，由前端重新渲染列表；
- 前端只做过滤/分组/点击，**不做业务判断**；
- 回传只有三种消息：`run`（跑某个功能）、`update`（去更新）、`ready`（请求状态）。

搜索是纯前端过滤（title/description/id/category），不回到扩展进程，输入零延迟。

## llama 子系统

### 识别构建（detect.ts）

- 名字白名单：`llama-cli` / `llama-server` / `main` / `llama`（`.exe` 可有可无）；
- 广度优先扫描工作区、`llama.searchPaths`、已保存选项所在目录，**深度 4、条目上限 6000**，
  跳过 `node_modules`、`.git`、`models` 等目录；`build/bin` 下的候选排前面；
- 版本靠 `--version` 输出解析（`version: 4615 (6d1c3e1)` / `built with ...`），
  解析失败也照样保存路径，只提示「未识别到版本」；
- 同一份输出里顺手认 **GPU 后端**（CUDA / Vulkan / Metal / HIP / SYCL），存进选项，
  界面直接显示；认不出来就按「纯 CPU 构建」提示，避免用户以为切片参数没生效。

### 参数 → 命令（command.ts，纯函数）

- 空字符串/空白 = **不传这个参数**；GPU 与切片是例外中的显式开关，见下；
- 固定顺序
  `-m → -p → -ngl → --split-mode → -ts → -n → -c → -t → --temp → -b → -s → 额外参数`；
- GPU 加速三态：`off` 一定 `-ngl 0`（忽略层数）、`on` 一定带层数（空则 `99`）、
  `auto` 只在填了层数时才传 —— 这样「禁用加速」不会因为残留层数而失效；
- 多卡切片：`--split-mode none|layer|row` 与 `-ts 3,1`，不选即不传；
- 额外参数按 shell 规则切词，支持引号；
- 生成命令行时按 PowerShell 语法加引号，并把换行压成空格（终端里换行会断行）；
- **真正运行时走 argv 直传**，不经过 shell，所以引号和换行原样保留。

### 并发模型（runs.ts）

```text
start() ──▶ queued ──(有槽位)──▶ running ──▶ succeeded / failed / cancelled
                                   │
                                   └─ 输出 → 200k 字符上限，只留尾部
```

- 并发上限 `maxConcurrent`（默认 3），多出来的排队，`finish()` 时自动补位；
- 每个任务独立的 `output`、`status`、`exitCode`，输出通过 `onOutput` 逐块推给界面；
- 取消：排队中的直接标记取消；运行中的先 `taskkill /T /F`（Windows）或 `SIGTERM`；
- **任务不归面板所有**：面板关了任务照跑，重新打开时 `snapshots()` 把历史输出带回来；
- 定时器/轮询只在界面侧（500ms 刷新耗时），扩展侧不轮询。

## 更新子系统

```text
启动（24h 节流）或手动
   │
   ├─ GET feedUrl（默认 GitHub releases/latest）
   ├─ compareVersions(latest, current) ≤ 0 → 结束
   ├─ pickVsixAsset：优先平台名，其次通用包
   ├─ 下载到 globalStorage/updates/，清掉旧包
   ├─ spawn code --install-extension <vsix> --force
   └─ 提示「重启窗口」，用户点「立即重启」→ workbench.action.reloadWindow
```

为什么不走 Marketplace：扩展没有发布到市场，`code --install-extension` 对 VSIX 的支持
就是官方给的自更新通道。代价是必须有一个能访问的 Release 源，所以 `feedUrl` 可配置。

## 状态存储

- 全部放 `context.globalState` 的单一 key（`schema: 1`），读时补默认值；
- **写入串行化**：`Store` 内部维护一条 promise 链，多个功能同时写不会互相覆盖；
- 只存数据（选项、最近模型、更新时间），不存运行中的任务——进程状态不落盘；
- 换 schema 时递增 `schema` 并在读取处做迁移/丢弃。

## 并发与隔离

| 场景 | 处理 |
| --- | --- |
| 两个功能同时被点 | `FeatureHost` 各自独立 dispatch，互不等待 |
| 功能抛错 / Promise 拒绝 | 捕获 → 日志 + 一条提示，命令仍可再次执行 |
| 同时跑多个 llama 任务 | 队列 + 上限，独立输出与终止 |
| 面板关闭时任务仍在跑 | 任务由 `RunManager` 持有，与视图生命周期解耦 |
| 自动更新与手动更新同时在跑 | `UpdateFlow.checking` 互斥，重复调用直接返回 |
| 状态并发写 | `Store` 的 promise 链串行化 |
| 大输出 | 200k 字符上限，只留尾部并标记 `truncated` |

## 安全

- webview 用 CSP（`default-src 'none'`）+ 每次随机 nonce，脚本只加载内联的 nonce 脚本；
- 面板只渲染数据，不拼 HTML 字符串（`textContent` / DOM API），避免注入；
- 命令是「展示 + 复制」，真正执行一律 argv 直传，不把用户输入拼进 shell；
- 下载的 VSIX 直接交给 `code` 安装——所以 `feedUrl` 由用户控制，默认是官方仓库。

## 测试策略

- 纯逻辑（命令拼装、版本解析、版本比较、状态存取、并发队列）全部单测，`node --test` 运行；
- `RunManager` 注入假 `spawn`，用 `EventEmitter` 模拟子进程的 stdout/close，测排队、补位、
  取消、退出码、截断，不需要真的起进程；
- webview 只测 HTML 生成的烟雾测试（非空、nonce、CSP），渲染效果靠 F5 手工看。

## 后续扩展点

- 面板分组（按 `requires`）与结果产物目录（`runs/<时间戳>/`）；
- `bench` / `memtrace` 复用 `RunManager`，把指标写进同一份 manifest；
- llama 任务的「重新运行」「导出命令到脚本」；
- 更新源支持签名校验（当前只校验 HTTPS + 来源域名）。
