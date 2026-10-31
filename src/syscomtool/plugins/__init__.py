"""内置插件目录。

每个子包就是一个插件，模块里用 ``PLUGIN`` 导出插件类；
新增内置插件后，记得把它登记到 :data:`syscomtool.core.registry.BUILTIN_MODULES`。
"""
