# WP-2.1 workspace 骨架落地报告

范围：`docs/plans/phase-b-execution-plan.md` WP-2.1（目标结构见同文档「目标结构（R3，已拍板）」节 + `docs/governance/2026-07-18-directory-structure-plan.md` B.1 R3）。

## 落地内容

- 根 `pnpm-workspace.yaml`：成员 `web`、`worker`、`packages/*`；`web/pnpm-lock.yaml` 已删除，依赖锁定合并进根 `pnpm-lock.yaml`。
- 根 `package.json`：`packageManager: "pnpm@10.23.0"` + `engines`（Node ≥24.7.0、pnpm ≥10.23.0，均为本机实测版本）；`pnpm.onlyBuiltDependencies`（`sharp`，从 `web/package.json` 上移，workspace 化后该字段只在根生效）+ `pnpm.peerDependencyRules.allowedVersions`（放行 `@google/model-viewer` 对 `three@^0.183.0` 的既有 peer 不匹配——`three` 现锁 `0.185.1`，此不匹配是存量事实，非本次引入；workspace 化后 pnpm 的 peer 校验可见性变化才使其浮现，`web/` 单独安装时不显示这条警告）。
- `packages/server`（`@petscape/server`）：`src/{application,domain,infra/{config,db,jobs,oss,sms,vendors}}` 各放 `index.ts` 占位导出；入口 `src/index.ts` 顶部 `import 'server-only'` 防线；`package.json` 无 next/react 依赖；`prisma/` 目录只建 `.gitkeep` 空位（schema 留给 WP-2.3）。
- `worker/`（`@petscape/worker`）：`src/main.ts` 最小启动骨架（打印启动行 + `import '@petscape/server'` 验证跨包依赖可解析）；独立 `tsconfig.json`（`lib: ["es2022"]`，无 DOM/JSX）；`package.json` 依赖 `@petscape/server: workspace:*`。
- lint 边界规则：`no-restricted-imports`/`no-restricted-properties`/`no-restricted-syntax`（ESLint 原生规则，未引入 `eslint-plugin-boundaries`——效果等价且零新依赖，判定为"实现更简单"）：
  - `packages/server/eslint.config.mjs`：`application/`、`domain/` 禁 import next/react/`@prisma/client`；`infra/**`（除 `infra/db/**`）禁 import `@prisma/client`；`infra/config/**` 外禁读 `process.env`。
  - `worker/eslint.config.mjs`：禁 import next/react（物理层面 package.json 已无该依赖，这里补 lint 防线）。
  - `web/eslint.config.mjs`：新增禁止新建 `web/src/app`（Next.js 在根有 `app/` 时会静默忽略 `src/app`，见治理方案 B.1 R2 坑①，本仓库选 R3 但一并挡住该陷阱）；新增禁读 `process.env`（除既有 baseline 豁免清单）。

## CONFLICT：process.env 散点计数与 spec 不符

Spec 原文写"存量 9 处 `process.env` 散点用豁免清单锁存"。实测 `web/` 目录内实际 `process.env` 出现处为 **7 处**（4 个文件）：

```
web/app/lib/images/falClient.ts:13
web/app/lib/jobs/avatarJob.ts:71,180,443,444
web/app/lib/tripo/client.ts:25
web/app/api/vibe/rewrite/route.ts:20
```

按最小合理解释：豁免清单按代码实际（7 处，4 个文件）建立，而非凑数到 9。清单锁定在 `web/eslint.config.mjs` 的 `PROCESS_ENV_BASELINE`（文件级豁免，只降不升——新文件不得加入该清单，除非确有新的迁移前散点被发现）。

## 版本矩阵（本包拍定）

| 组件 | 版本 | 依据 |
|---|---|---|
| Node | ≥24.7.0 | 本机实测（`node --version`） |
| pnpm | ≥10.23.0 | 本机实测，且与 WP-2.0 tracer 容器锁定版本一致 |
| Next.js | ^16.2.10 | 沿用 `web/` 现状，不变更 |
| TypeScript | ^6.0.3 | 沿用 `web/` 现状，不变更 |
| Prisma | 7.8.0（后续 `packages/server` 落 schema 时锁 `^7.8.0`） | 对齐 `tracer/build-tracer/worker-probe` 实测版本 |
| Better Auth | 1.6.23（仅记录，本包不装） | 按主控拍板事实，正式安装留给 WP-3.1 |

CI frozen-lockfile：根 lockfile 已验证 `pnpm install`（无 `--frozen-lockfile` 参数时）全绿无 peer 警告；`--frozen-lockfile` 未在本包单独跑（CI 门禁在 WP-2.4 落地时补验），但本包保证的是"lockfile 可复现"这一前提——单次 `pnpm install` 后重跑 `pnpm install` 无变更（见下方证据）。

## Worker 制品契约：`pnpm deploy` flag 结论

**结论：沿用 WP-2.0 报告建议——`pnpm deploy --legacy`。**

本包在真实跨包依赖场景（`worker` depends on `@petscape/server`，WP-2.0 tracer 的 `probe-worker` 没有此依赖，是未验证的开放问题）下补做了对照实验：

1. **`pnpm --filter @petscape/worker deploy --legacy <dir>`**：开箱即用，无需修改 `pnpm-workspace.yaml` 任何持久配置。产出目录含 `node_modules/@petscape/server`（真实 clone 进虚拟 store，非空 stub），`test ! -d node_modules/next` 通过。
2. **`pnpm --filter @petscape/worker deploy <dir>` （非 legacy，默认 `inject-workspace-packages` 行为）**：**直接报错** `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`（"Cannot proceed with the frozen installation. The current settings.injectWorkspacePackages configuration doesn't match the value found in the lockfile"），pnpm 官方错误提示明确建议 `forceLegacyDeploy: true`（即改用 `--legacy`）。
3. 补测：在根 `pnpm-workspace.yaml` **持久声明** `injectWorkspacePackages: true` 并 `pnpm install --no-frozen-lockfile` 重新解析 lockfile 后，非 legacy 路径同样能跑通，产出等价（同样不含 next，同样能解析 `@petscape/server`，体积相同 ~51MB 未压缩）。

**取舍**：两条路径产物等价，但 `injectWorkspacePackages: true` 需要**全局持久配置**（写入 `pnpm-workspace.yaml`，影响所有 workspace 依赖解析行为，且需要 `--no-frozen-lockfile` 重新生成 lockfile），而 `--legacy` 是**一次性命令行 flag**，零持久配置改动、零 lockfile 格式变更。给 Dockerfile 场景，`--legacy` 更简单、侵入性更小、与 WP-2.0 报告的既有实证结论一致。**最终结论：worker 镜像构建统一用 `pnpm --filter @petscape/worker deploy --legacy <dir>`。**

（注：测试中发现深层中文路径 + 绝对路径拼接会触发 pnpm `_linkBins` 的相对路径计算 bug，`deploy` 目标必须用相对路径或短路径，不影响 Docker 容器内路径场景——记入 Observations。）

## Observations（spec 之外，未处理）

- Worker 骨架用 `node --experimental-strip-types src/main.ts` 起，但当依赖 `@petscape/server` 经 `pnpm deploy` 落进 `node_modules` 后，Node 拒绝对 `node_modules` 内的 `.ts` 源码做类型剥离（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。这意味着 `worker/` 的正式生产入口（WP-3.4）需要在构建期把 `packages/server` 预编译成 `.js`（`tsc` build 或打包），不能依赖运行时逐文件剥离类型；本包只验证了跨包依赖能被正确解析和 clone，未验证运行时执行链路（不在 WP-2.1 范围）。
- 本机绝对路径含中文字符 + 深层目录（worktree 路径）会触发 `pnpm deploy` 的 `_linkBins` 相对路径计算错误（尝试 `mkdir '/Users/tmp'`）；仅在 `deploy` 目标使用绝对路径或跨越很多层级的相对路径时复现，用项目内相对路径（如 `./deploy-out`）或 Docker 容器内路径（通常较浅、无中文）不受影响，因此不影响真实容器构建链，仅记录以防未来在本机路径下手工调试 `pnpm deploy` 时踩同一个坑。
- `web` Turbopack 构建仍保留 WP-2.0 报告记录的 1 条 NFT 警告（`app/lib/runtimePublicFile.ts`），本包未处理（不在 WP-2.1 范围）。

## 改动文件清单

- 根新增：`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`（合并自 `web/pnpm-lock.yaml`，后者已删除）
- `packages/server/`：`package.json`、`tsconfig.json`、`eslint.config.mjs`、`src/index.ts`、`src/application/index.ts`、`src/domain/index.ts`、`src/infra/{config,db,jobs,oss,sms,vendors}/index.ts`、`prisma/.gitkeep`
- `worker/`：`package.json`、`tsconfig.json`、`eslint.config.mjs`、`src/main.ts`
- `web/package.json`（移除已失效的 `pnpm.onlyBuiltDependencies`，上移至根）
- `web/eslint.config.mjs`（新增 `src/app` 守卫 + `process.env` 边界规则 + baseline 豁免清单）
- `web/next-env.d.ts`（Next.js 自动生成，`pnpm build` 产物路径从 dev 切到 build types，非本包语义改动）
- `docs/operations/wp-2-1-landing-check/`（`baseline-origin-main.png`、`branch-wp-2-1.png`，见下节验收 4 证据）
- `docs/operations/wp-2-1-report.md`（本文件）
