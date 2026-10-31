# 架构说明

## 目标与非目标

**目标**

- 新增一个工具 = 新增一个目录，不改核心；
- 工具之间零耦合，任何一个坏掉不影响其他的；
- 核心极薄：只依赖 Python 标准库，能在一台只有解释器的比赛机器上跑起来。

**非目标**

- 不做通用插件框架（不需要热插拔、沙箱、权限模型）；
- 不做 GUI；
- 不替插件决定它内部怎么实现——核心只规定「怎么被找到、怎么被调用」。

## 分层

```text
                 ┌──────────────────────────────┐
   argv ────────▶│ cli.py                       │
                 │  解析全局参数、装配子命令、分发 │
                 └──────────────┬───────────────┘
                                │
                 ┌──────────────▼───────────────┐
                 │ core/                       │
                 │  registry  发现 + 校验 + 登记│
                 │  plugin    Plugin 基类/契约  │
                 │  context   输出与调试通道    │
                 │  errors    错误类型          │
                 └──────────────┬───────────────┘
                                │ 只调用 register(parser, ctx)
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
 plugins/hello          外部插件包（entry point）   未来的 bench / memtrace …
```

依赖方向是单向的：`cli → core ← plugins`。核心不认识任何具体插件，
插件只认识 `syscomtool.core.plugin.Plugin` 和 `syscomtool.core.context.Context`。

## 一次命令的生命周期

以 `syscomtool -v hello 比赛` 为例：

1. `main()` 创建 `Context`（输出流在此刻绑定，便于测试替换）；
2. `discover()` 依次加载内置模块与 entry point，得到 `Registry`；
   加载失败只留下一条 `PluginRecord(error=...)`，不抛异常；
3. `build_parser()` 为每个加载成功的插件建一个子命令解析器，调用其 `register()`；
   某个插件装配失败会打印警告并跳过；
4. `parse_args()` 解析用户输入，插件的 `register()` 已经把
   `handler(ctx, args)` 塞进 `args`；
5. 分发：`handler(ctx, args)`，返回值即退出码（`None` → 0）；
6. `SysComToolError` 被捕获成一行中文错误 + 退出码 1；`KeyboardInterrupt` → 130。

`syscomtool plugins` 是核心自带的内置命令（不是插件），列出成功与失败的记录。

## 插件契约

一个插件要提供三样东西：

| 位置 | 内容 |
| --- | --- |
| 类属性 | `name`（小写短横线）、`summary`（一行）、可选 `description` / `version` / `requires`、`api_version` |
| `register(parser, ctx)` | 注册参数，并用 `set_defaults(handler=...)` 交出执行函数 |
| 模块/包级 `PLUGIN` | `Plugin` 子类或实例（也允许返回实例的工厂函数） |

`handler` 的签名固定为 `handler(ctx, args) -> int | None`：

- `ctx` 提供 `echo / debug / warn / error`，插件不要直接 `print`；
- `args` 是 argparse 的命名空间，插件自己定义字段；
- 返回值是退出码。

约定之外的一切（子命令嵌套、参数风格、输出格式、第三方依赖）都由插件自己决定。

## 发现与失败语义

发现顺序固定：**内置模块 → entry point**，同名时后到的记为失败（`插件名与 … 重复`）。

每条记录三种结局：

| 结局 | 触发条件 |
| --- | --- |
| 成功 | 能导入、有 `PLUGIN`、名字合法、`summary` 非空、`api_version` 不高于核心 |
| 失败 | 导入异常、缺少 `PLUGIN`、名字不合法、版本过高、重名 |

失败项出现在 `syscomtool plugins` 的「加载失败」段落里，附原因；
命令行其余部分照常工作。这是刻意的：比赛期间插件多、更新频繁，
一个写坏的插件不该让别人连帮助都打不开。

## 扩展点与后续

已留出、尚未实现的扩展点（实现前不要写进 README 当既成事实）：

- **配置**：`syscomtool.toml`（项目根）+ `~/.config/syscomtool/config.toml`，
  提供给 `Context.config`，插件只读；
- **运行产物**：统一 `runs/<时间戳>/` 目录与 `manifest.json`，让 `bench` / `memtrace`
  的产物可以被 `report` 直接消费；
- **共享能力**：进程采样、llama.cpp 调用封装，做成 `core/` 之外的库模块，
  供多个插件复用（而不是插件之间互相 import）；
- **输出格式**：`--format table|json|markdown`，放在核心而不是每个插件各写一份。

## 版本与兼容

- 核心与插件各自独立版本；
- `core/plugin.py` 的 `PLUGIN_API_VERSION` 标记契约版本，破坏性改动时 +1；
- 插件声明的版本高于核心时，加载阶段直接拒绝并提示升级，避免「能加载但行为错」；
- 插件版本与其依赖的外部能力（llama.cpp 构建、模型文件）用 `requires` 做**提示**，
  不做强制检查——检查动作留给 `envcheck` 这类插件。

## 测试策略

- 核心逻辑（发现、校验、重名、装配、退出码）用单元测试覆盖，`tests/` 下不起子进程；
- 插件测试直接调用 `cli.main([...])` 并断言输出，避免每条都跑 `subprocess`；
- 需要外部资源的插件（模型、llama.cpp）要把「真跑」的部分隔离在可跳过的测试里，
  默认测试必须能在干净机器上通过。
