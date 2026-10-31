# SysComTool

> 为「计算机系统能力大赛 · 功能赛 **proj59**：内存受限环境的大语言模型推理优化」配套的辅助工具集。

赛题本身只关心最终的系统实现，但围绕它的杂活很多：反复跑 benchmark、记录内存与速度、
比较不同量化位宽的结果、检查环境、整理提交物…… **SysComTool 把这些杂活拆成一个个
互相独立、可插拔的小工具**，共用一个命令行入口，按需启用。

```text
syscomtool plugins          # 看装了哪些工具
syscomtool hello            # 跑某个工具
syscomtool hello --help     # 看某个工具怎么用
```

## 当前状态

骨架阶段（v0.1.0）：**插件框架已经跑通**，功能插件按下面的路线图逐个补。
现阶段请不要把这里当成品，接口还会变。

| 部分 | 状态 |
| --- | --- |
| 插件发现（内置 + entry point）、命令装配、错误隔离 | 可用 |
| `hello` 示例插件 / 新插件模板 | 可用 |
| `syscomtool plugins` 状态自检 | 可用 |
| 各功能插件（见下表） | 规划中，未实现 |
| 统一配置、运行日志、结果目录约定 | 规划中 |

## 为什么是插件

一个赛题里要用的工具会有很多，而且它们彼此无关：有的只读日志，有的要调 llama.cpp，
有的要画图，依赖差别很大。做成一个单体程序的话，任何一处改动都会牵连所有人。

所以这里只固定一条很窄的契约：

- **一个插件 = 一个顶层子命令**，自己解析参数、自己实现逻辑、自己声明依赖；
- 核心不 import 任何插件，插件之间也互不 import；
- 插件可以放本仓库（内置），也可以是独立的 pip 包（外部），装了就出现、卸了就消失；
- 某个插件加载失败只影响它自己，`syscomtool plugins` 会列出失败项和原因。

这样「加一个工具」的成本是**复制一个目录、改个名字**，而不是改核心。

## 快速开始

要求 Python **≥ 3.9**（核心只用标准库，不需要额外依赖）。

```powershell
git clone git@github.com:xuzhaotenfang/SysComTool.git
cd SysComTool

python -m venv .venv
.\.venv\Scripts\Activate.ps1

python -m pip install -e ".[dev]"
pytest -q

syscomtool plugins
syscomtool hello -n 3 比赛
```

不想装也能跑（直接从源码目录启动，测试同样适用）：

```powershell
$env:PYTHONPATH = "src"
python -m syscomtool plugins
python -m pytest -q
```

Linux / macOS 下把激活命令换成 `source .venv/bin/activate` 即可。

## 目录结构

```text
SysComTool/
├─ src/syscomtool/
│  ├─ cli.py                 # 入口：发现插件 → 装配子命令 → 分发
│  ├─ __main__.py            # python -m syscomtool
│  ├─ core/
│  │  ├─ plugin.py           # Plugin 基类与三条约定
│  │  ├─ registry.py         # 发现、校验、登记（内置模块 + entry point）
│  │  ├─ context.py          # 运行上下文：输出、调试信息
│  │  └─ errors.py           # SysComToolError / PluginError
│  └─ plugins/
│     └─ hello/              # 示例插件，复制它开始写新插件
├─ tests/                    # pytest：发现、校验、命令分发
├─ docs/
│  ├─ architecture.md        # 分层、生命周期、扩展点
│  └─ writing-a-plugin.md    # 从零写一个插件（含独立发布）
├─ .github/workflows/ci.yml  # Linux + Windows × 3.9 / 3.12
├─ pyproject.toml
├─ CONTRIBUTING.md
└─ README.md
```

## 插件一览

| 插件 | 状态 | 说明 |
| --- | --- | --- |
| `hello` | 可用 | 示例插件 / 新插件模板，打印一句问候 |
| `envcheck` | 规划中 | 环境自检：Python、编译器、内存与页大小、llama.cpp 版本与后端 |
| `bench` | 规划中 | 批量跑 benchmark，记录 tok/s、峰值内存等指标 |
| `memtrace` | 规划中 | 采样推理进程的内存 / 换页 / 显存，输出时序数据 |
| `report` | 规划中 | 把多次运行汇总成「内存 × 速度 × 质量」对比表和 Pareto 数据 |
| `pack` | 规划中 | 按赛题要求整理提交目录、校验文件完整性 |

「规划中」= 还没有代码，只有名字和职责。想认领其中任何一个，按
[CONTRIBUTING.md](CONTRIBUTING.md) 开分支即可。

## 写一个插件

最小可用的插件长这样（完整步骤见 [docs/writing-a-plugin.md](docs/writing-a-plugin.md)）：

```python
from syscomtool.core.plugin import Plugin


class PingPlugin(Plugin):
    name = "ping"                     # 子命令名
    summary = "确认外部依赖是否可达"   # 一行说明

    def register(self, parser, ctx):
        parser.add_argument("target", help="目标地址")
        parser.set_defaults(handler=self.run)

    def run(self, ctx, args):
        ctx.echo(f"ping {args.target}")
        return 0


PLUGIN = PingPlugin                   # 发现机制认这个名字
```

放进 `src/syscomtool/plugins/<name>/plugin.py`，再到
`src/syscomtool/core/registry.py` 的 `BUILTIN_MODULES` 里加一行就生效。
想独立发布成 pip 包也可以，见设计文档里的 entry point 用法。

## 开发与协作

- `main` 是受保护分支，**不能直接 push**，所有改动走 PR（详见 [CONTRIBUTING.md](CONTRIBUTING.md)）；
- 提交前跑 `pytest -q`，CI 会跑 Linux / Windows × Python 3.9 / 3.12；
- 新增或改名插件时，记得同步更新上面的「插件一览」表。

设计细节：

- [架构说明](docs/architecture.md)：分层、一次命令的生命周期、插件契约与版本策略
- [插件开发指南](docs/writing-a-plugin.md)：从复制模板到独立发布

## 许可

[MIT](LICENSE)。辅助工具为开源项目，欢迎在赛题之外复用。
