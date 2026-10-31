"""SysComTool —— 面向功能赛 proj59 的插件化辅助工具集。

核心只负责「发现插件、装配命令行、分发执行」；
具体能力由一个个插件提供，见 ``syscomtool.plugins`` 与 ``docs/writing-a-plugin.md``。
"""

__version__ = "0.1.0"

__all__ = ["__version__"]
