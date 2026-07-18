# WP-A3-2 QA 验收关键帧（2026-07-19）

独立 QA agent（非实现者）在 production 模式（`pnpm build` + `next start`，SMS/MAIL 均 log 通道，一次性本地 PG + `prisma migrate deploy`）下用 Playwright 真实浏览器走完邮箱验证码登录 + 双向凭证绑定全流程的截图证据。完整录屏（53s，720p/H.264）见仓库 `qa-evidence` release（`wp-a3-2-qa-recording.mp4`），逐步观察与判定见 PR #26 QA 评论。

- `01` 邮箱注册→登录落 `/account`：邮箱行已绑定、手机号行未绑定（脚注 User.id 为同账户断言基准）。
- `02` 账户页绑定手机号成功后**不刷新即显**（window marker 存活证明无整页刷新；User.id 不变；同 session 双凭证同屏）。
- `04` 手机号注册用户绑定邮箱（占位 `@phone.petscape.local` 迁移为真实邮箱）后即时展示，User.id 不变。
- `05` **问题证据**：绑定已被占用邮箱 → 服务端 `request-email-change` 返回 200 但不发码（防枚举静默），UI 却显示"验证码已发送"，用户死路于"验证码错误"——规约要求的内联冲突提示不可达（手机号侧同场景可正常返回 `PHONE_NUMBER_EXIST` 结构化冲突，问题仅在邮箱侧）。
- `06` 60s 内第二次发码被服务端拒绝（内联提示；文案为英文 "Too many requests. Please try again later."，未映射中文——见 PR 评论问题清单）。
- `07` `xxx@phone.petscape.local` 占位域在登录入口发码被拦（服务端 400 `INVALID_EMAIL`，中文内联提示，日志确认零发码）。

QA 期间对同一目标"绑定后立即重新登录"的 60s 冷却按 `web/tests/e2e-credentials.test.mjs` 同款方式手动清 `otp_send_record` 记录绕过，不改产品语义。
