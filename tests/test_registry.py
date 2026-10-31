"""插件发现、校验与登记表的行为。"""

from __future__ import annotations

import sys
import types

from syscomtool.core.errors import PluginError
from syscomtool.core.plugin import PLUGIN_API_VERSION, Plugin
from syscomtool.core.registry import Registry, discover, load_module


def _make_plugin_class(name: str = "demo", summary: str = "演示", api_version: int = PLUGIN_API_VERSION):
    class DemoPlugin(Plugin):
        def register(self, parser, ctx):  # pragma: no cover - 仅满足抽象方法
            parser.set_defaults(handler=lambda ctx, args: 0)

    DemoPlugin.name = name
    DemoPlugin.summary = summary
    DemoPlugin.api_version = api_version
    return DemoPlugin


def _fake_module(monkeypatch, name: str, plugin_obj) -> str:
    module = types.ModuleType(name)
    if plugin_obj is not None:
        module.PLUGIN = plugin_obj
    monkeypatch.setitem(sys.modules, name, module)
    return name


def test_discover_finds_builtin_hello():
    registry = discover(use_entry_points=False)

    assert registry.get("hello") is not None
    assert [p.name for p in registry.plugins] == ["hello"]
    assert registry.failures == []


def test_load_module_accepts_plugin_class(monkeypatch):
    module_name = _fake_module(monkeypatch, "fake_plugin_a", _make_plugin_class("alpha"))

    record = load_module(module_name, "test")

    assert record.ok
    assert record.name == "alpha"
    assert record.plugin is not None


def test_load_module_rejects_invalid_name(monkeypatch):
    module_name = _fake_module(monkeypatch, "fake_plugin_b", _make_plugin_class("Bad Name"))

    record = load_module(module_name, "test")

    assert not record.ok
    assert "不合法" in record.error


def test_load_module_rejects_missing_plugin(monkeypatch):
    module_name = _fake_module(monkeypatch, "fake_plugin_c", None)

    record = load_module(module_name, "test")

    assert not record.ok
    assert "PLUGIN" in record.error


def test_load_module_rejects_future_api_version(monkeypatch):
    module_name = _fake_module(
        monkeypatch, "fake_plugin_d", _make_plugin_class("future", api_version=PLUGIN_API_VERSION + 1)
    )

    record = load_module(module_name, "test")

    assert not record.ok
    assert "API" in record.error


def test_load_module_reports_import_error():
    record = load_module("syscomtool.plugins.does_not_exist", "test")

    assert not record.ok
    assert record.error


def test_registry_rejects_duplicate_name():
    plugin = _make_plugin_class("dup")()
    registry = Registry()
    from syscomtool.core.registry import PluginRecord

    registry.add(PluginRecord(name="dup", source="builtin:a", plugin=plugin))
    registry.add(PluginRecord(name="dup", source="builtin:b", plugin=plugin))

    assert len(registry.plugins) == 1
    assert len(registry.failures) == 1
    assert "重复" in registry.failures[0].error


def test_plugin_error_is_syscomtool_error():
    from syscomtool.core.errors import SysComToolError

    assert issubclass(PluginError, SysComToolError)
