"""异常类型。

预期内的错误统一挂在 :class:`SysComToolError` 下，
命令行入口捕获后只打印一行说明，不带 traceback。
"""


class SysComToolError(Exception):
    """所有预期内错误的根类型。"""


class PluginError(SysComToolError):
    """插件定义不合法，或插件加载失败。"""
