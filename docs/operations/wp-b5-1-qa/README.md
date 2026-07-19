# WP-B5-1 场景交互与纯逻辑证据

验证日期：2026-07-19。基线：`ea7da414ce05b8ee7683206559346b513b5a7512`（WP-B4-1）。范围：内存 Scene state、参数化笼舍、唯一 target、context、程序化花枝鼠比例参照、摆放与确认；无 Prisma/schema/migration 变更。

## 用户行为结论

- 模型确认后进入独立“布置笼舍”阶段，常显明确 Project 和 `temporary catalog · sandbox only`。
- 笼舍内部 X/Y/Z 以 mm 参数化；尺寸变化立即重新校验。
- 场景始终恰有一个不可删除 target；可加入 `cloud-moss-platform`、`star-spiral-ramp` 两个 context。
- 支持画布地面拖动、精确 X/Z 输入、绕 Y 轴旋转、等比缩放、水平支撑面吸附、单项/全部重置和删除 context。
- 旋转 AABB、碰撞、越界与水平支撑均由渲染无关纯函数决定。碰撞 mutation 被拒绝并保留上一个合法位置；无效笼舍尺寸会阻断确认。
- 通用成年花枝鼠是固定 `220 × 110 × 80 mm` 的程序化比例参照，只能显隐，不能移动、旋转或缩放，也不参与制造或报价。
- “确认场景（仅内存）”只冻结当前浏览器内存预览；刷新后消失，明确不代表写库、可制造、宠物安全、报价或成交。

## 红 → 绿

```text
场景状态红测：7c4d598
场景状态实现：731e555
场景 UI：56e6f3a

花枝鼠锁定红测：1db6ddc
花枝鼠锁定与相机复位：fd10a4e

浏览器碰撞/touch 红测：d6e5470
red：真实 RDS E2E 找不到“位置 X (mm)”，0 pass / 1 fail
精确位置绿实现：f973ab9
碰撞语义收紧：d0c5c0c
green：真实 RDS E2E 1 pass / 0 fail
```

纯状态测试 11/11 PASS，覆盖唯一 target、context 角色、花枝鼠锁定、旋转 AABB、越界、碰撞拒绝、水平叠放、重置与确认资格。

## 真实 RDS + 浏览器竖切

实现者和非实现者均通过独立 ECS SSH 隧道连接真实 RDS，使用真实 Better Auth OTP session 和正式 Project API；未 mock Route Handler。

```text
$ E2E_VIEWER_PHONE=<独立 QA 号码> node --test tests/e2e-viewer-model.test.mjs
✔ 登录后确认模型并完成不可变内存场景确认
tests 1, pass 1, fail 0, skipped 0
```

竖切路径：OTP 登录 → 显式创建 Project → banana `1.25×` → ModelConfirmation → 参数化笼舍 → 唯一 target → context → `1.10×` → 精确位置触发碰撞并拒绝非法 Z → 花枝鼠显隐/锁定 → 缩窄笼舍触发越界 → 恢复 → 390×844 CDP touch 调整 Y 旋转 → SceneConfirmation 内存预览 → 回到原点。

非实现者最终判定：核心桌面流程 14 项 PASS；最初缺失的碰撞与 touch 两项在精确位置控件和 CDP 测试加入后分别复核 PASS。SSH 隧道、QA server 与浏览器进程均已清理。

## 行为证据

| 证据 | 路径 |
|---|---|
| 完整独立 QA 录屏 | `screenshots/browser-qa/wp-b5-1/independent_full-flow.webm` |
| 未登录 Viewer 重定向 | `screenshots/browser-qa/wp-b5-1/independent_verdict_01_unauth-viewer-login.png` |
| landing 首屏零回归 | `screenshots/browser-qa/wp-b5-1/independent_verdict_02_landing-first-fold.png` |
| 显式 Project 与三个 target | `screenshots/browser-qa/wp-b5-1/independent_verdict_03_explicit-project-created.png` |
| banana `1.25×` 与最终尺寸 | `screenshots/browser-qa/wp-b5-1/independent_verdict_04_banana-scale-125.png` |
| 参数化笼舍与阶段边界 | `screenshots/browser-qa/wp-b5-1/independent_verdict_05_scene-entered.png` |
| 两个 context | `screenshots/browser-qa/wp-b5-1/independent_verdict_07_contexts-added.png` |
| 旋转/缩放/位置 | `screenshots/browser-qa/wp-b5-1/independent_verdict_08_transform-controls.png` |
| 单项/全部重置 | `screenshots/browser-qa/wp-b5-1/independent_verdict_09_resets.png` |
| 越界阻断 | `screenshots/browser-qa/wp-b5-1/independent_verdict_10_boundary-blocked.png` |
| 花枝鼠固定尺寸 | `screenshots/browser-qa/wp-b5-1/independent_verdict_12_reference-dimensions.png` |
| 内存 SceneConfirmation | `screenshots/browser-qa/wp-b5-1/independent_verdict_13_memory-confirmation.png` |
| 相机回到原点 | `screenshots/browser-qa/wp-b5-1/independent_verdict_14_back-to-origin.png` |
| 碰撞 mutation 被拒绝、Z 保持 130 | `screenshots/browser-qa/wp-b5-1/independent_final_collision.png` |
| 390×844 CDP touch 后 Y 旋转 98° | `screenshots/browser-qa/wp-b5-1/independent_final_touch.png` |

## 质量门禁

```text
web unit:            27 pass, 0 fail
scene state:         11 pass, 0 fail
server test:         45 pass, 0 fail, 9 explicit no-DATABASE_URL skips
web/server/worker tsc: PASS
server/worker lint:  PASS
web targeted lint:  PASS
web lint:baseline:  accepted existing 11/17 errors, 26 warnings
web production build: PASS
git diff --check:    PASS
```

Production build 仍有既有 Turbopack NFT tracing warning，import trace 指向 `runtimePublicFile.ts` / uploads route；本 WP 未触碰该路径。

## 未验证边界

- Scene 与两类 Confirmation 尚未持久化；自动保存、刷新/服务器重启恢复、revision 冲突和确认幂等属于 WP-B45-2。
- 当前只使用冻结 temporary catalog，全部 sandbox-only / quote-ineligible；owned Asset 接线属于 WP-B45-2。
- CDP 证明 Chromium touch event 和响应式布局，未在物理移动设备或低端设备上测性能。
- 未验证 production 公网 `/viewer`：`petscape3d.com` 受既存 ICP 403 / HTTPS 握手阻断；不归因于本 WP，也不在 Viewer 线改变备案或部署边界。
- 不声称 AI 生成、通用上传、制造可行性、宠物安全、真实报价或成交。
