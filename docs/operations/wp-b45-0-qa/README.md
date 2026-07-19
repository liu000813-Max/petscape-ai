# WP-B45-0 R3F 技术尖峰证据

验证日期：2026-07-19。验证面：本地 Next.js dev server + Codex in-app Chromium/WebGL；不涉及数据库、migration、报价或制造结论。

## 结论

**继续采用 `@react-three/fiber` 9.6.1 + `@react-three/drei` 10.7.7（three 0.185.1）。**

代表性 GLB 的加载/切换/取消旧请求、显式错误与重试、地面拖动、Orbit 与 TransformControls 生命周期协调、GizmoHelper、Html 尺寸标注、卸载释放和同场五模型均已在真实 Chromium/WebGL 中得到行为证据。AABB、尺寸、越界、碰撞和水平支撑面仍保持渲染无关纯函数。

尖峰期间真实抓到一次问题：仅靠 `onMouseUp` 手工恢复 Orbit 时，Gizmo 拖动结束后状态可能卡在「已暂停」。实现已改为监听 three.js `dragging-changed` 事件；复验后状态为 `可用 · 已暂停 1 次`。正式工作台继续以地面拖动为主要摆放手势，TransformControls 只提供受控辅助交互。

## TDD 红 → 绿

红灯（实现文件不存在，符合预期）：

```text
$ node --test packages/server/tests/scenes-contracts.test.mjs
ERR_MODULE_NOT_FOUND: packages/server/src/contracts/scenes.ts
tests 1, pass 0, fail 1

$ node --test web/tests/viewer-geometry.test.mjs
ERR_MODULE_NOT_FOUND: web/app/lib/viewer/geometry.ts
tests 1, pass 0, fail 1

$ node --test web/tests/viewer-catalog.test.mjs
ERR_MODULE_NOT_FOUND: web/app/lib/viewer/catalog.ts
tests 1, pass 0, fail 1
```

绿灯：

```text
$ node --test packages/server/tests/scenes-contracts.test.mjs
tests 9, pass 9, fail 0

$ node --test web/tests/viewer-geometry.test.mjs
tests 5, pass 5, fail 0

$ node --test web/tests/viewer-catalog.test.mjs
tests 2, pass 2, fail 0
```

覆盖：两阶段封闭状态、temporary_catalog 强制 sandbox/不可报价、owned_asset 非空 SHA-256、只允许等比缩放和 Y 轴旋转、唯一 target、SceneItem.instanceId 唯一、context 不得成为目标、snapshot schema version、revision 冲突形状、精确 revision 确认、旋转后 world AABB、笼舍越界、接触不算穿模、水平支撑面叠放。

## 冻结临时资产

精确文件、字节数与 SHA-256 由 `web/tests/viewer-catalog.test.mjs` 逐文件重算校验；全部 `quoteEligible=false`，单资产上限 4 MiB。

| role | assetKey | bytes | SHA-256 |
|---|---|---:|---|
| target | cheese-lounge-bed | 3,503,856 | `bbc2517c6503485c086d3b9e2987de1c75906426b5318d00e59ef232149d0112` |
| target | banana-bed | 3,503,696 | `a67ba88578cca7384364ea4a9e9d736fa86770f38cf64aa19a8ffda6e10b5dbe` |
| target | cheese-play-mat | 3,441,712 | `e3964778fd1aa6f39ee1bad9575beb87e909bafdd4646e77592393614cac213a` |
| context | cloud-moss-platform | 50,856 | `c1a24649398206aabc41de72625179f0c10a74ab345cbfc81a4be722ebef0254` |
| context | star-spiral-ramp | 125,668 | `68fe1cd98c45e27db9795f5e4fd14d0b3d1228b1342ef0df5e2c414cd9f83da0` |

## 真实浏览器行为

| 行为 | 可定位结果 | 证据 |
|---|---|---|
| 单模型加载 + Html 尺寸 | `ready`；`274.1 × 100.0 × 194.5 mm`；120 FPS | `r3f-spike-ready.png` |
| 错误可见 | 坏 URL 返回 `error · HTTP 404`，重试按钮启用 | `r3f-spike-load-error.png` |
| 错误重试 | 重试后回到 `ready`，尺寸标签恢复 | 浏览器探针输出：`载入 2 · 释放 1 · 取消 3` |
| 地面拖动 | 位置从 `0,0,0` 到 `97,0,-4`；pointer=`mouse`；Orbit 暂停并恢复 | `r3f-spike-ground-drag.png` |
| TransformControls 冲突 | `dragging-changed` 复验后 Orbit=`可用 · 已暂停 1 次` | `r3f-spike-transform-orbit-release.png` |
| 卸载资源 | 卸载后 `释放 1`，renderer geometry `8 → 7` | 浏览器探针输出 |
| 快速切模 | 连续切换三模型后最终为 `cloud-moss-platform`，旧请求取消 5 次，最终 `ready` | 浏览器探针输出 |
| 同场五模型 | 五个冻结 GLB 均可见；120 FPS；18 geometry | `r3f-spike-five-models.png` |
| 390×844 布局 | 控制区与 3D 视口纵向排列，Canvas 可操作 | `r3f-spike-mobile-390x844.png` |
| 390×844 真实 touch 拖动 | Chromium CDP 发出 `touchStart/touchMove/touchEnd`；页面收到 `pointerType=touch`；位置变为 `105, 0, 15`；Orbit 恢复为 `可用 · 已暂停 1 次` | `web/test-results/r3f-spike-touch.png`；`web/tests/e2e-r3f-spike-touch.test.mjs` |
| landing 首屏 | 原 landing 文件零改动；首屏布局、导航、CTA 和动态 hero 正常 | `landing-after-wp-b45-0-top.png` |
| production server | `next start` 的 `/r3f-spike` 返回 HTTP 200；Chrome 中 `ready` 且尺寸标签正确 | `r3f-spike-production-ready.png` |

## 非实现者浏览器 QA

独立 QA 首轮与针对性复验合计覆盖 8 项尖峰行为及 landing 首屏，最终全部 PASS：加载与尺寸、404/重试、快速切模、地面拖动与 Orbit 恢复、TransformControls 与 Orbit 恢复、资源卸载、同场五模型、390×844 响应式布局。关键复验截图位于 `screenshots/browser-qa/wp-b45-0-qa/`。

真实 touch 由另一名非实现者在同一 worktree 精确复跑：

```text
$ R3F_SPIKE_BASE_URL=http://127.0.0.1:3012 node --test tests/e2e-r3f-spike-touch.test.mjs
{"pointerKind":"touch","position":"105, 0, 15","orbit":"可用 · 已暂停 1 次","viewport":"390x844"}
tests 1, pass 1, fail 0
```

截图 `web/test-results/r3f-spike-touch.png` 为有效 PNG（98,467 bytes），SHA-256 `b036bc6eac310df4c803cbc11affba524bf6b8d781f177c2d9f2085973823fd2`。非实现者总判定：`PASS | Criteria 4/4 | Skipped 0`。

## 当前验证边界

- 390×844 Chromium 触控仿真已由非实现者验证到浏览器事件和应用状态层；真实物理移动设备仍未覆盖。
- 五模型结果是当前冻结 fixture 在本机 Chromium 的尖峰数据，不是低端移动设备性能承诺。
- Chrome extension 在后台 production 复验时因自动化/后台节流只报告 5 FPS；性能判断采用前台 in-app Chromium 的 120 FPS 证据，production 复验只用于证明构建产物真实可加载，不把两个环境的 FPS 混写。
- 本 WP 不触碰数据库、`schema.prisma` 或 migration；真实数据库验收属于 WP-B45-2。
- landing hero 是动态媒体，截图帧与历史基准可不同；本 WP 未修改 landing 源文件或样式。

## 实现者侧质量门禁

```text
web test:          11 pass, 0 fail
server test:       23 pass, 0 fail, 7 skip（既有 DB 集成套件；本 WP 无 DATABASE_URL / 无 DB 改动）
web typecheck:     PASS
server typecheck:  PASS
worker typecheck:  PASS
web lint:baseline: PASS（11/17 errors, 26 warnings；baseline accepted）
server lint:       PASS
worker lint:       PASS
web production build: PASS（/r3f-spike static，/viewer-spike protected dynamic）
production HTTP:      200 text/html; charset=utf-8（http://127.0.0.1:3013/r3f-spike）
```

Build 保留一个既有 Turbopack NFT tracing warning，import trace 指向 `runtimePublicFile.ts` / uploads route；本 WP 未触及该路径，未把 warning 写成“已修复”。
