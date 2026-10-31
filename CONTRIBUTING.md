# 贡献指南

## 分支模型

`main` 是**受保护分支**：不允许直接 push，也不能强推或删除。所有改动必须经由 PR 合入。

| 分支 | 用途 |
| --- | --- |
| `main` | 始终可运行，CI 为绿 |
| `feat/<short-name>` | 新功能、新面板交互 |
| `fix/<short-name>` | 修 bug |
| `docs/<short-name>` | 只动文档 |
| `chore/<short-name>` | 工程杂项（CI、依赖、打包、发版） |

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

`scope` 一般是功能名（`llama`、`hello`）或模块（`core`、`views`、`update`）。

## PR 检查清单

- [ ] 分支从最新 `main` 切出，只包含本次改动
- [ ] `npm run check` 与 `npm test` 都通过；新增的纯逻辑有单测
- [ ] 新功能已三处同步：`src/features/<name>.ts`、`createFeatures()`、`package.json` 的 `contributes.commands`
- [ ] 新配置项已加到 `contributes.configuration`，并在 README 的配置表里补一行
- [ ] 动了 webview 的话：CSP/nonce 仍在、用户数据用 `textContent` 渲染
- [ ] 动了并发相关代码的话：说明上限/排队/终止行为是否变化，并补 `runs.test.ts` 用例
- [ ] `npm run package` 能出包，`npx vsce ls --tree` 里没有 `src/`、`out/test/`、`docs/`、`node_modules/`
- [ ] PR 描述写清「做了什么 / 为什么 / 怎么验证」

## 代码风格

- TypeScript `strict`，不用 `any` 兜底；确要逃逸时写注释说明原因；
- `core/`、`services/*/command.ts`、`services/*/check.ts`、`services/store.ts` 不 import `vscode`
  （或只用 `import type`），保证能在纯 Node 里单测；
- 命名：命令 id 小写点分 `syscomtool.<name>`，文件名小写短横线；
- 注释与用户可见文案用中文，标识符用英文；
- 功能里不要 `console.log`，统一 `ctx.logger`；
- 不阻塞：`run()` 里避免同步长任务，用 `withProgress` / `RunManager` / 终端。

## 版本与发布

自动更新依赖 GitHub Release，所以发版就是打 tag：

1. 改 `package.json` 的 `version`（例如 `0.2.1`）；
2. 提交并合并到 `main`；
3. 打 tag 并推送：

```powershell
git tag v0.2.1
git push origin v0.2.1
```

4. `release.yml` 会跑检查、打包并创建 Release（挂上 `syscomtool-<version>.vsix`）；
5. 已安装的扩展在下一次检查时看到新版本，提示更新。

> tag 必须是 `v<version>` 且与 `package.json` 的 version 一致，否则装上去的版本号对不上，
> 会反复提示更新。

本地验证打包：`npm run package`，产物 `*.vsix` 不入库（已在 `.gitignore` 里）。
