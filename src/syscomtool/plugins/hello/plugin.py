"""示例插件。

它只做一件事：打印一句问候，用来验证「插件发现 → 子命令装配 → 执行」这条链路。
自己写插件时，把整个 ``hello`` 目录复制成新名字再改即可，
详见 ``docs/writing-a-plugin.md``。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from syscomtool.core.plugin import Plugin

if TYPE_CHECKING:  # pragma: no cover - 仅类型检查
    import argparse

    from syscomtool.core.context import Context


class HelloPlugin(Plugin):
    name = "hello"
    summary = "打印一句问候，用来确认插件链路正常"
    description = "示例插件。复制 src/syscomtool/plugins/hello 就能开始写自己的插件。"
    version = "0.1.0"

    def register(self, parser: "argparse.ArgumentParser", ctx: "Context") -> None:
        parser.add_argument("who", nargs="?", default="世界", help="问候对象，默认「世界」")
        parser.add_argument(
            "-n", "--repeat", type=int, default=1, metavar="N", help="重复次数，默认 1"
        )
        parser.set_defaults(handler=self.run)

    def run(self, ctx: "Context", args: "argparse.Namespace") -> int:
        times = max(1, args.repeat)
        for _ in range(times):
            ctx.echo(f"你好，{args.who}！")
        ctx.debug(f"hello 插件执行完毕，重复 {times} 次")
        return 0


#: 模块级导出：发现机制认这个名字
PLUGIN = HelloPlugin
