"""运行上下文。

插件不直接 ``print``，而是通过上下文输出：
这样测试可以替换输出流，将来也能统一加上 ``--quiet`` / 日志文件等行为。
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Optional, TextIO


@dataclass
class Context:
    """一次命令运行的上下文。"""

    verbose: int = 0
    out: Optional[TextIO] = field(default=None, repr=False)
    err: Optional[TextIO] = field(default=None, repr=False)

    def __post_init__(self) -> None:
        # 不要在这里绑定默认参数里的 sys.stdout：pytest 等工具会替换输出流。
        if self.out is None:
            self.out = sys.stdout
        if self.err is None:
            self.err = sys.stderr

    def echo(self, message: str = "") -> None:
        """正常输出。"""
        print(message, file=self.out)

    def debug(self, message: str) -> None:
        """仅在 ``-v`` 时输出。"""
        if self.verbose:
            print(f"[debug] {message}", file=self.err)

    def warn(self, message: str) -> None:
        print(f"警告：{message}", file=self.err)

    def error(self, message: str) -> None:
        print(f"错误：{message}", file=self.err)
