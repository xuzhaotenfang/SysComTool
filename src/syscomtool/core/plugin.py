"""插件模型。

约定很短，只有三条：

1. 一个插件对应一个顶层子命令（``syscomtool <name> ...``）；
2. 插件是 :class:`Plugin` 的子类，模块里用 ``PLUGIN`` 导出（类或实例都行）；
3. 在 ``register()`` 里向 argparse 注册参数，并用
   ``parser.set_defaults(handler=...)`` 交出真正的执行函数，
   执行函数签名固定为 ``handler(ctx, args) -> int | None``，
   返回 ``None`` 视作 0，非 0 即进程退出码。
"""

from __future__ import annotations

import abc
from typing import TYPE_CHECKING, ClassVar, Sequence

if TYPE_CHECKING:  # pragma: no cover - 仅用于类型检查
    import argparse

    from .context import Context

# 插件 API 版本。破坏性改动时 +1；插件声明高于核心的版本会被拒绝加载。
PLUGIN_API_VERSION = 1


class Plugin(abc.ABC):
    """一个插件的全部声明。"""

    #: 插件遵循的 API 版本，一般不用改
    api_version: ClassVar[int] = PLUGIN_API_VERSION

    #: 子命令名，小写短横线风格，例如 ``mem-trace``
    name: ClassVar[str] = ""

    #: 一行说明，出现在 ``--help`` 与 ``syscomtool plugins`` 里
    summary: ClassVar[str] = ""

    #: 长说明，出现在 ``syscomtool <name> --help`` 的开头
    description: ClassVar[str] = ""

    #: 插件自身版本
    version: ClassVar[str] = "0.1.0"

    #: 依赖的外部能力（模型文件、llama.cpp 构建产物等），仅用于提示
    requires: ClassVar[Sequence[str]] = ()

    @abc.abstractmethod
    def register(self, parser: "argparse.ArgumentParser", ctx: "Context") -> None:
        """向自己的子命令解析器注册参数与处理函数。"""
        raise NotImplementedError
