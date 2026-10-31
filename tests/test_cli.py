"""命令行装配与分发的行为。"""

from __future__ import annotations

import pytest

from syscomtool import __version__, cli


def test_plugins_lists_builtin(capsys):
    assert cli.main(["plugins"]) == 0

    out = capsys.readouterr().out
    assert "hello" in out
    assert "已启用插件" in out


def test_hello_runs(capsys):
    assert cli.main(["hello", "比赛"]) == 0

    assert "你好，比赛！" in capsys.readouterr().out


def test_hello_defaults_and_repeat(capsys):
    assert cli.main(["hello"]) == 0
    assert "你好，世界！" in capsys.readouterr().out

    assert cli.main(["hello", "-n", "3"]) == 0
    assert capsys.readouterr().out.count("你好") == 3


def test_verbose_goes_to_stderr(capsys):
    assert cli.main(["-v", "hello"]) == 0

    captured = capsys.readouterr()
    assert "[debug]" in captured.err
    assert "[debug]" not in captured.out


def test_no_command_prints_help(capsys):
    assert cli.main([]) == 0

    assert "usage: syscomtool" in capsys.readouterr().out


def test_unknown_command_exits_two(capsys):
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["nope"])

    assert excinfo.value.code == 2


def test_version_flag(capsys):
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["--version"])

    assert excinfo.value.code == 0
    assert __version__ in capsys.readouterr().out
