"""命令行入口：发现插件 → 装配子命令 → 分发执行。"""

from __future__ import annotations

import argparse
from typing import Optional, Sequence

from . import __version__
from .core.context import Context
from .core.errors import SysComToolError
from .core.registry import Registry, discover

PROG = "syscomtool"


def build_parser(registry: Registry, ctx: Context) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=PROG,
        description="SysComTool：计算机系统能力大赛功能赛 proj59 的插件化辅助工具集",
        epilog="用 `syscomtool plugins` 查看已发现插件；用 `syscomtool <插件> --help` 查看插件用法。",
    )
    parser.add_argument("--version", action="version", version=f"{PROG} {__version__}")
    parser.add_argument(
        "-v", "--verbose", action="count", default=0, help="打印调试信息，可叠加 -vv"
    )

    subparsers = parser.add_subparsers(dest="command", metavar="<command>")
    subparsers.add_parser("plugins", help="列出已发现插件及加载状态")

    for plugin in sorted(registry.plugins, key=lambda item: item.name):
        plugin_parser = subparsers.add_parser(
            plugin.name,
            help=plugin.summary,
            description=plugin.description or plugin.summary,
        )
        plugin_parser.set_defaults(plugin_name=plugin.name)
        try:
            plugin.register(plugin_parser, ctx)
        except Exception as exc:  # noqa: BLE001 - 单个插件装配失败不影响其他插件
            ctx.warn(f"插件 {plugin.name} 装配失败：{type(exc).__name__}: {exc}")

    return parser


def _print_plugins(ctx: Context, registry: Registry) -> int:
    records = list(registry)
    ok = [r for r in records if r.ok and r.plugin is not None]
    failed = [r for r in records if not r.ok]

    if ok:
        width = max(len(r.name) for r in ok)
        ctx.echo(f"已启用插件（{len(ok)} 个）：")
        for record in sorted(ok, key=lambda item: item.name):
            plugin = record.plugin
            assert plugin is not None
            ctx.echo(f"  {record.name.ljust(width)}  {plugin.version:<7}  {record.source}")
            detail = f"{' ' * (2 + width + 2)}{plugin.summary}"
            if plugin.requires:
                detail += f"（依赖：{'、'.join(plugin.requires)}）"
            ctx.echo(detail)
    else:
        ctx.echo("没有可用的插件。")

    if failed:
        ctx.echo()
        ctx.echo(f"加载失败（{len(failed)} 个）：")
        for record in failed:
            ctx.echo(f"  {record.name}  {record.source}")
            ctx.echo(f"    {record.error}")

    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    ctx = Context()
    registry = discover()
    parser = build_parser(registry, ctx)
    args = parser.parse_args(argv)
    ctx.verbose = args.verbose

    if args.command is None:
        parser.print_help()
        return 0
    if args.command == "plugins":
        return _print_plugins(ctx, registry)

    handler = getattr(args, "handler", None)
    if handler is None:
        ctx.error(
            f"插件 {args.command} 没有注册执行函数"
            "（register() 中缺少 parser.set_defaults(handler=...)）"
        )
        return 2

    try:
        result = handler(ctx, args)
    except SysComToolError as exc:
        ctx.error(str(exc))
        return 1
    except KeyboardInterrupt:  # pragma: no cover - 交互中断
        ctx.error("已中断")
        return 130
    return 0 if result is None else int(result)


__all__ = ["main", "build_parser", "PROG"]
