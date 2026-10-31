"""插件发现与登记。

发现顺序固定：先内置模块，再 entry point。
任何一步失败都只产生一条「失败记录」，不影响其余插件 ——
``syscomtool plugins`` 会把失败项与原因一并列出来。
"""

from __future__ import annotations

import importlib
import re
from dataclasses import dataclass
from importlib import metadata
from typing import Iterator, List, Optional, Sequence

from .errors import PluginError
from .plugin import PLUGIN_API_VERSION, Plugin

#: 独立分发的插件用这个 entry point 组登记自己
ENTRY_POINT_GROUP = "syscomtool.plugins"

#: 内置插件（本仓库自带），新增内置插件时在这里登记
BUILTIN_MODULES: Sequence[str] = (
    "syscomtool.plugins.hello",
)

_NAME_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")


@dataclass(frozen=True)
class PluginRecord:
    """一条发现结果：要么是可用的插件，要么是失败原因。"""

    name: str
    source: str
    plugin: Optional[Plugin] = None
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.error is None


def _guess_name(hint: str) -> str:
    """模块加载失败时，用模块名最后一段当展示名。"""
    tail = hint.rsplit(":", 1)[-1].rstrip("/").split("/")[-1]
    return tail.rsplit(".", 1)[-1] or hint


def _coerce(obj: object, hint: str) -> Plugin:
    if isinstance(obj, Plugin):
        return obj
    if isinstance(obj, type) and issubclass(obj, Plugin):
        return obj()
    raise PluginError(f"{hint}：PLUGIN 需要 Plugin 子类或实例，实际是 {type(obj).__name__}")


def _validate(plugin: Plugin, source: str) -> None:
    if not _NAME_RE.match(plugin.name or ""):
        raise PluginError(f"插件名 {plugin.name!r} 不合法，应形如 mem-trace")
    if not plugin.summary.strip():
        raise PluginError(f"插件 {plugin.name} 缺少 summary")
    if plugin.api_version > PLUGIN_API_VERSION:
        raise PluginError(
            f"插件 {plugin.name} 需要 API v{plugin.api_version}，"
            f"当前核心只支持 v{PLUGIN_API_VERSION}，请升级 SysComTool"
        )


def load_module(module_name: str, source: str) -> PluginRecord:
    try:
        module = importlib.import_module(module_name)
        candidate = getattr(module, "PLUGIN", None)
        if candidate is None:
            raise PluginError(f"模块 {module_name} 没有导出 PLUGIN")
        plugin = _coerce(candidate, module_name)
        _validate(plugin, source)
        return PluginRecord(name=plugin.name, source=source, plugin=plugin)
    except PluginError as exc:
        return PluginRecord(name=_guess_name(module_name), source=source, error=str(exc))
    except Exception as exc:  # noqa: BLE001 - 插件自己的 import 错误不该拖垮 CLI
        return PluginRecord(
            name=_guess_name(module_name), source=source, error=f"{type(exc).__name__}: {exc}"
        )


def load_entry_point(entry_point: "metadata.EntryPoint") -> PluginRecord:
    source = f"entry-point:{entry_point.name}"
    try:
        plugin = _coerce(entry_point.load(), source)
        _validate(plugin, source)
        return PluginRecord(name=plugin.name, source=source, plugin=plugin)
    except PluginError as exc:
        return PluginRecord(name=entry_point.name, source=source, error=str(exc))
    except Exception as exc:  # noqa: BLE001
        return PluginRecord(name=entry_point.name, source=source, error=f"{type(exc).__name__}: {exc}")


def _iter_entry_points() -> Iterator["metadata.EntryPoint"]:
    found = metadata.entry_points()
    if hasattr(found, "select"):  # Python 3.10+
        yield from found.select(group=ENTRY_POINT_GROUP)
    else:  # Python 3.9
        yield from found.get(ENTRY_POINT_GROUP, [])


class Registry:
    """插件登记表。"""

    def __init__(self) -> None:
        self._records: List[PluginRecord] = []

    def __iter__(self) -> Iterator[PluginRecord]:
        return iter(self._records)

    def __len__(self) -> int:
        return len(self._records)

    def add(self, record: PluginRecord) -> None:
        if record.ok:
            for other in self._records:
                if other.ok and other.name == record.name:
                    record = PluginRecord(
                        name=record.name,
                        source=record.source,
                        error=f"插件名与 {other.source} 重复",
                    )
                    break
        self._records.append(record)

    @property
    def plugins(self) -> List[Plugin]:
        """所有加载成功的插件。"""
        return [r.plugin for r in self._records if r.plugin is not None]

    @property
    def failures(self) -> List[PluginRecord]:
        return [r for r in self._records if not r.ok]

    def get(self, name: str) -> Optional[Plugin]:
        for record in self._records:
            if record.ok and record.name == name:
                return record.plugin
        return None


def discover(*, use_entry_points: bool = True) -> Registry:
    """发现全部插件。"""
    registry = Registry()
    for module_name in BUILTIN_MODULES:
        registry.add(load_module(module_name, f"builtin:{module_name}"))
    if use_entry_points:
        for entry_point in _iter_entry_points():
            registry.add(load_entry_point(entry_point))
    return registry
