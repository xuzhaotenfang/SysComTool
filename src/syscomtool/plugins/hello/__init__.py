"""示例插件：最小可用的插件骨架，也是写新插件时直接复制的那份模板。

包级 ``PLUGIN`` 是发现机制认的名字，这里把它从 :mod:`.plugin` 转出来。
"""

from .plugin import PLUGIN

__all__ = ["PLUGIN"]
