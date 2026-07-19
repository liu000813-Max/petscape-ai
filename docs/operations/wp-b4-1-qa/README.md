# WP-B4-1 单品检视与模型确认证据

验证日期：2026-07-19。范围：登录后的明确 Project 选择、冻结 temporary catalog 目标模型、真实 GLB 单品检视、等比缩放和内存 ModelConfirmation 阶段交接。无 Prisma/schema/migration 变更。

## 用户行为结论

- `/viewer` 位于登录保护区；未登录访问真实跳转 `/login`。
- 无 `projectId` 时先显示项目选择/显式创建引导，不自动拿最新项目，也不静默创建。
- 首批只暴露 `cheese-lounge-bed`、`banana-bed`、`cheese-play-mat` 三个 target；全部标记 `temporary catalog · sandbox only` 和“AI 生成链尚未接入”。
- Viewer 支持 GLB 加载/取消旧请求/失败重试、Orbit 查看、Gizmo 视角、回到原点、原始与最终 mm 尺寸常显。
- 尺寸只允许统一比例，三轴联动；确认按钮在模型 ready 前不可用。
- “确认此模型，进入场景”冻结 modelRef/checksum、原始包围盒、统一比例、最终 mm 尺寸和确认时间；同一内存会话重新选择会 append 新确认，不覆盖旧对象。
- 当前 ModelConfirmation 明确标为内存占位，不代表已写入数据库、可制造、宠物安全或可报价。

## 红 → 绿

```text
初始红测：1bb7176（model-inspection 模块不存在）
初始实现：3ec7c27

语义收紧红测：2aff3ee
tests 5, pass 4, fail 1
actual stage: scene-placeholder
expected stage: scene_editing

绿实现：90549e7
tests 5, pass 5, fail 0
```

纯逻辑覆盖：固定 target 列表、切模旧请求不能覆盖当前状态、加载失败与重试、异常模型禁止确认、等比尺寸计算、冻结 ModelConfirmation snapshot、append-only 内存历史。

## 真实 RDS + 浏览器竖切

实现者与非实现者均通过既有 ECS SSH 隧道连接真实 RDS，使用真实 Better Auth OTP session 和正式 `/api/v1/projects`，未 mock Route Handler。

```text
$ E2E_VIEWER_PHONE=<独立 QA 号码> node --test tests/e2e-viewer-model.test.mjs
✔ 登录后明确创建项目，检视缩放模型并生成不可变内存确认
tests 1, pass 1, fail 0, skipped 0
```

验证路径：OTP 登录 → `/viewer` → 明确创建命名 Project → 选择 `banana-bed` → GLB ready → 统一比例 `1.25` → 最终尺寸 `292.6 × 125.0 × 118.4 mm` → 确认 → 冻结内存快照。测试完成后 QA server 与 SSH 隧道均关闭。

| 证据 | 路径 |
|---|---|
| 非实现者确认结果 | `web/test-results/viewer-model-confirmation.png` |
| 未登录 Viewer 重定向 | `screenshots/browser-qa/wp-b4-1/verdict_03_independent-unauth-viewer-redirect-login.png` |
| landing 首屏零回归 | `screenshots/browser-qa/wp-b4-1/verdict_04_independent-landing-first-fold.png` |

非实现者总判定：`PASS | Criteria 3/3 | Skipped 0`。

## 质量门禁

```text
web unit:         16 pass, 0 fail
server test:      29 pass, 0 fail, 7 explicit local DB skips
web/server/worker typecheck: PASS
web lint:baseline: 11/17 errors, 26 warnings（既有 baseline，未增加）
server/worker lint: PASS
web production build: PASS（/viewer 为受保护 dynamic route）
```

Production build 仍有既有 Turbopack NFT tracing warning，import trace 指向 `runtimePublicFile.ts` / uploads route；本 WP 未触碰该路径。

PR CI 新增 `viewer-model-e2e`：PostgreSQL 16 service → Prisma generate/migrate deploy → Linux Chromium → 真实登录/Project/Viewer E2E，并上传确认截图。GitHub checks 在 PR 发布后作为最终门禁。

## 未验证边界

- ModelConfirmation 尚未写数据库；不可变持久化、刷新/重启恢复属于 WP-B45-2。
- 当前仅 temporary catalog，全部不可报价；owned Asset 校验与正式 ModelConfirmation 接线属于 WP-B45-2。
- 未覆盖物理移动设备、低端设备、其他模型/比例组合或 production deployment。
- 本 WP 不声称 AI 生成、通用上传、制造可行性、宠物安全、真实报价或成交。
