# 写一个插件

目标：10 分钟内让 `syscomtool ping 1.2.3.4` 能跑起来。下面的例子都在仓库里可直接对照：

- 模板本体：`src/syscomtool/plugins/hello/`
- 契约说明：[architecture.md](architecture.md)

## 第 1 步：复制模板

```powershell
Copy-Item -Recurse src/syscomtool/plugins/hello src/syscomtool/plugins/ping
```

删掉新目录里的说明文件，只保留：

```text
src/syscomtool/plugins/ping/
├─ __init__.py      # 转出 PLUGIN
└─ plugin.py        # 插件本体
```

## 第 2 步：改插件本体

```python
"""ping：确认外部依赖是否可达。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from syscomtool.core.plugin import Plugin

if TYPE_CHECKING:  # 仅类型检查时需要
    import argparse

    from syscomtool.core.context import Context


class PingPlugin(Plugin):
    name = "ping"
    summary = "确认外部依赖是否可达"
    description = "对目标地址做一次连通性检查，用于跑批前确认环境。"
    version = "0.1.0"
    requires = ()                      # 需要的外部能力，仅用于展示

    def register(self, parser: "argparse.ArgumentParser", ctx: "Context") -> None:
        parser.add_argument("target", help="目标地址，例如 1.2.3.4")
        parser.add_argument("--timeout", type=float, default=3.0, metavar="SEC")
        parser.set_defaults(handler=self.run)

    def run(self, ctx: "Context", args: "argparse.Namespace") -> int:
        ctx.debug(f"ping {args.target}，超时 {args.timeout}s")
        ctx.echo(f"{args.target} 可达")
        return 0


PLUGIN = PingPlugin
```

`__init__.py` 保持一行：

```python
from .plugin import PLUGIN

__all__ = ["PLUGIN"]
```

## 第 3 步：登记

在 `src/syscomtool/core/registry.py` 的 `BUILTIN_MODULES` 里加一行：

```python
BUILTIN_MODULES: Sequence[str] = (
    "syscomtool.plugins.hello",
    "syscomtool.plugins.ping",       # 新增
)
```

然后验证：

```powershell
$env:PYTHONPATH = "src"
python -m syscomtool plugins
python -m syscomtool ping 1.2.3.4
python -m syscomtool ping --help
```

## 第 4 步：加测试

```python
from syscomtool import cli


def test_ping_runs(capsys):
    assert cli.main(["ping", "1.2.3.4"]) == 0
    assert "可达" in capsys.readouterr().out
```

## 第 5 步：更新插件表

README 的「插件一览」里加一行；不要顺手把「规划中」的插件改成「可用」，
除非它真的能跑。

## 约定

| 项 | 约定 |
| --- | --- |
| `name` | 小写，短横线分词：`mem-trace`、`env-check` |
| `summary` | 一句话，动词开头，不超过 25 字，会进 `--help` 和插件表 |
| `version` | 自己的版本号，与核心无关 |
| `requires` | 依赖的外部能力（`"llama.cpp"`、`"模型文件"`），只做提示 |
| 输出 | 一律 `ctx.echo / ctx.warn / ctx.error / ctx.debug`，不用 `print` |
| 退出码 | 成功返回 `0` 或 `None`；失败返回非 0，并 `ctx.error` 说明原因 |
| 错误 | 预期内错误抛 `syscomtool.core.errors.PluginError`（或其它 `SysComToolError` 子类），CLI 只打印一行；不要 `sys.exit()` |

## 逻辑复杂一点时

插件内部可以自由嵌套子命令——`register()` 收到的就是它自己的 `ArgumentParser`：

```python
def register(self, parser, ctx):
    sub = parser.add_subparsers(dest="action", metavar="{run,list}")

    run = sub.add_parser("run", help="跑一次采样")
    run.add_argument("--duration", type=float, default=30.0)
    run.set_defaults(handler=self.run_sampler)

    sub.add_parser("list", help="列出历史采样").set_defaults(handler=self.list_runs)
```

也建议按功能拆文件，插件内部结构不受限制：

```text
plugins/memtrace/
├─ __init__.py
├─ plugin.py        # 只做参数与分发
└─ sampler.py       # 真正的实现
```

## 独立发布（不进本仓库）

插件也可以是自己维护的 pip 包，不需要动本仓库的 `BUILTIN_MODULES`：

```toml
# 你的包：pyproject.toml
[project]
name = "syscomtool-bench"
version = "0.2.0"
dependencies = ["syscomtool>=0.1", "psutil>=5"]

[project.entry-points."syscomtool.plugins"]
bench = "syscomtool_bench.plugin:PLUGIN"
```

```powershell
python -m pip install -e .
syscomtool plugins     # bench 会出现在列表里，来源显示为 entry-point:bench
```

注意事项：

- entry point 的值指向模块里的 `PLUGIN`（类或实例都行）；
- 包名建议 `syscomtool-<name>`，避免与内置插件重名（重名时后加载的会失败）；
- 依赖写在你自己的 `pyproject.toml` 里，不要往核心加；
- 如果更新了插件契约（`PLUGIN_API_VERSION`），旧插件会在加载时被拒绝并提示，这是预期行为。

## 提交前检查

- [ ] `pytest -q` 全绿
- [ ] `syscomtool plugins` 里能正常列出，无「加载失败」
- [ ] `syscomtool <name> --help` 说明清楚
- [ ] README 插件表已更新
- [ ] 默认测试不依赖模型文件、llama.cpp 或网络
