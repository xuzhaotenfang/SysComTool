# 贡献指南

## 分支模型

`main` 是**受保护分支**：不允许直接 push，也不能强推或删除。所有改动必须经由 PR 合入。

| 分支 | 用途 |
| --- | --- |
| `main` | 始终可运行，CI 为绿 |
| `feat/<short-name>` | 新功能、新面板交互 |
| `fix/<short-name>` | 修 bug |
| `docs/<short-name>` | 只动文档 |
| `chore/<short-name>` | 工程杂项（CI、依赖、打包） |

一次分支只做一件事。

## 日常流程

```powershell
git switch main
git pull

git switch -c feat/memtrace-panel

npm install
# ... 改代码 ...
npm run check
npm test

git add -A
git commit -m "feat(memtrace): 采样进程 RSS 与页错误计数"
git push -u origin feat/memtrace-panel
```

`origin` 配了两个推送地址：**GitHub 主库 + CNB 镜像**，一次 `git push` 会先后推到两边。
只想推某一个时用完整地址显式指定，例如
`git push git@github.com:xuzhaotenfang/SysComTool.git HEAD`。

推送后在 GitHub 开 PR，合并前需要：CI 通过 + 至少一个 review。

## 提交信息

沿用 Conventional Commits 的子集，标题一行，正文写「为什么」：

```text
<type>(<scope>): <不超过 50 字的摘要>

可选正文：动机、取舍、影响面。中文即可。
```

| type | 含义 |
| --- | --- |
| `feat` | 新增功能或交互 |
| `fix` | 修 bug |
| `docs` | 文档 |
| `refactor` | 不改行为的重构 |
| `test` | 测试 |
| `chore` | 构建、CI、依赖、打包 |

`scope` 一般是功能名（`hello`、`memtrace`）或 `core`。

## PR 检查清单

- [ ] 分支从最新 `main` 切出，只包含本次改动
- [ ] `npm run check` 与 `npm test` 都通过；新增行为有测试
- [ ] 新功能已三处同步：`src/features/<name>.ts`、`src/features/index.ts`、`package.json` 的 `contributes.commands`
- [ ] 改了 `Feature` / `FeatureContext` 契约时，在 PR 里写明影响面与迁移方式
- [ ] 需要用户可见的配置项，已加到 `package.json` 的 `contributes.configuration`
- [ ] `npm run package` 能出包，且 `npx vsce ls --tree` 里没有 `src/`、`out/test/`、`node_modules/`
- [ ] PR 描述写清「做了什么 / 为什么 / 怎么验证」

## 代码风格

- TypeScript `strict`，不用 `any` 兜底；确要逃逸时写注释说明原因；
- `core/` 里除了 `log.ts` / `context.ts` / `tree.ts` 这类必须碰 VS Code API 的文件，其余不要 import `vscode`（保持可单测）；
- 命名：功能 id 小写点分 `syscomtool.<name>`，文件名小写短横线；
- 注释与用户可见文案用中文，标识符用英文；
- 功能内不要 `console.log`，统一 `ctx.logger`；
- 异步错误交给宿主兜底，但要在错误信息里写清「哪个功能、哪一步、怎么修」。

## 版本与发布

- 扩展版本在 `package.json` 的 `version`，功能不单独发版；
- `CHANGELOG` 尚未引入，改动写进 PR 描述即可；
- 打包：`npm run package`，生成的 `*.vsix` 不入库（已在 `.gitignore` 里）。
