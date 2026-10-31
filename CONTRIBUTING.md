# 贡献指南

## 分支模型

`main` 是**受保护分支**：不允许直接 push，也不能强推或删除。所有改动必须经由 PR 合入。

| 分支 | 用途 |
| --- | --- |
| `main` | 始终可运行，CI 为绿 |
| `feat/<short-name>` | 新功能、新插件 |
| `fix/<short-name>` | 修 bug |
| `docs/<short-name>` | 只动文档 |
| `chore/<short-name>` | 工程杂项（CI、依赖、脚手架） |

一次分支只做一件事；超过两三天的改动考虑拆开。

## 日常流程

```powershell
git switch main
git pull

git switch -c feat/memtrace-sampler

# ... 改代码 ...
pytest -q

git add -A
git commit -m "feat(memtrace): 采样进程 RSS 与页错误计数"
git push -u origin feat/memtrace-sampler
```

`origin` 配了两个推送地址：**GitHub 主库 + CNB 镜像**，一次 `git push` 会先后推到两边。
如果只想推某一个，用完整地址显式指定，例如 `git push git@github.com:xuzhaotenfang/SysComTool.git HEAD`。

推送后在 GitHub 上开 PR，合并前需要：CI 通过 + 至少一个 review。

## 提交信息

沿用 Conventional Commits 的子集，标题一行，正文写「为什么」：

```text
<type>(<scope>): <不超过 50 字的摘要>

可选正文：动机、取舍、影响面。中文即可。
可选脚注：Refs #12
```

`type` 取以下之一：

| type | 含义 |
| --- | --- |
| `feat` | 新增能力（包括新增插件） |
| `fix` | 修 bug |
| `docs` | 文档 |
| `refactor` | 不改行为的重构 |
| `test` | 测试 |
| `chore` | 构建、CI、依赖、脚手架 |

`scope` 一般是插件名（`bench`、`memtrace`）或 `core`；不写也行。

## PR 检查清单

- [ ] 分支从最新 `main` 切出，且只包含本次改动
- [ ] `pytest -q` 全绿；新增行为有对应测试
- [ ] 新增插件时：已登记到 `BUILTIN_MODULES`、README 插件表、`docs/writing-a-plugin.md` 的示例不需要改
- [ ] 改了插件契约（`Plugin` 的字段或 `handler` 签名）时：`PLUGIN_API_VERSION` 已 +1，并在 PR 里说明迁移方式
- [ ] PR 描述里写清「做了什么 / 为什么 / 怎么验证」

## 新增一个插件

1. 复制 `src/syscomtool/plugins/hello/` 成 `src/syscomtool/plugins/<name>/`；
2. 改 `plugin.py` 里的 `name` / `summary` / `description` / `version`；
3. 把包的 `__init__.py` 里的 `from .plugin import PLUGIN` 保留（发现机制读的是包级 `PLUGIN`）；
4. 在 `src/syscomtool/core/registry.py` 的 `BUILTIN_MODULES` 里加一行 `"syscomtool.plugins.<name>"`；
5. 加测试（至少覆盖 `--help` 能装配、主流程返回值），并更新 README 的插件表。

细则见 [docs/writing-a-plugin.md](docs/writing-a-plugin.md)。

## 代码风格

- 核心（`core/`）**只允许标准库**；第三方依赖放在插件自己的 `pyproject.toml` 里；
- Python ≥ 3.9 语法，文件开头统一 `from __future__ import annotations`；
- 标识符英文、注释与输出中文；公开函数写 docstring；
- 错误分两类：预期内抛 `SysComToolError` 子类（CLI 只打印一行），意外错误带 traceback；
- 插件不直接 `print`，一律走 `ctx.echo / ctx.warn / ctx.error / ctx.debug`。

## 版本与兼容

- 每个插件有自己的 `version`，与核心版本无关；
- 核心的插件契约有 `PLUGIN_API_VERSION`，破坏性改动时 +1；声明了更高版本的插件会被拒绝加载并给出提示，而不是带着错误运行。
