# 批次2 Spec：vibe 环境改造效果图（F36-F39）

> 历史交付 Spec，不作为当前开发计划；当前产品范围见根目录 `PetScape-PRD.md`，当前实现以代码为准。
> 文件所有权：只改/新建——`app/components/landing/UploadVibeSection.jsx`、`RenderSection.jsx`、`app/api/project/[id]/vibe/**`（新建）、`app/lib/jobs/vibeJob.ts`（新建）。**`app/lib/types/project.ts` 已由接驳层预铺 `VibeRenderJob` 字段（注意字段名是 `vibeRender`，因 brief 里已有 `vibe?: string` 文本字段）——只消费、禁改**；`app/page.jsx` 已注入 projectId/mockMode/petImageUrl props，禁改。**不改其它组件、不动 scenePrompt.ts 现有函数（可新增函数）。不执行任何 git 操作——完成后报告，由主控统一 commit。** 验证用自己起的 dev server（端口 3002）。越界需求停下报主控。

## 1. 任务

打通「可选笼箱照 + 宠物照 + vibe 文字 → fal 生成改造/造景效果图 → 三态展示（改造前/改造后/分享图）」，含 loading 与 mock。没有真实环境图时，生成入口仍可用，并从 vibe 描述生成完整宠物小家造景图。

## 2. 后端

新建 `vibeJob.ts` + `POST /api/project/[id]/vibe`：

1. 输入：cage 照可选（upload API kind=cage，已有）、宠物照（project.brief 里已传的 pet 照自动带入）、vibe 文字。
2. prompt：`buildVibePrompt` 同时覆盖两种语义：有 cage 照时参考 `buildRevampPrompts` 的 revamp 硬约束风格（保持笼箱结构、置入宠物、按 vibe 文字改造氛围）；无 cage 照时生成完整宠物小家造景图；两者都加"主体居中"约束，为 3:4 裁切留构图余量。
3. 有 cage 或 pet 参考图时走 fal edit（`falEditImage`，多图输入：cage 照 + 宠物照参考）；无参考图时走 fal generate（`falGenerateImage`）→ 下载落盘 `public/generated/{projectId}/vibe/`。
4. project 追加 `vibeRender: {status, beforeUrl?, afterUrl, error}`；`beforeUrl` 仅在有 cage 照时写入。
5. mock：`?mock=1` 走 `mockup-assets/` 现成图，延时 1s。

## 3. 前端

- **F36 输入框**：伪 `<span>` 改真 `<textarea>`，默认值=原示例文案（视觉不变），可编辑。
- **F38 上传位**：笼箱位（4:3）补真实 `<input type=file>`（POST upload kind=cage，本地即时预览）；宠物位（1:1）**自动带入**创建器已传照片（显示缩略图+可点击换图）；两者都空时保持原占位视觉。
- **F37 生成按钮**：补 onClick → POST vibe → 轮询；生成中按钮 disabled + 区块内 loading 提示（复用批次1 之前的 V3 现有语汇，不自创样式）。前置校验：project 已初始化且 vibe 文案非空；cage 照不是必填。
- **F39 三态**：改造前 = 有 cage 时直用 cage 原图，否则保持示例占位；改造后 = afterUrl；小红书分享图 = **改造后图的 CSS 中心裁切**（3:4 容器 + `object-fit: cover`）叠品牌角标（logo 小图 + 一行文案，样式贴 V3）。生成前三格保持原占位。

## 4. 完成标准

### 4A. builder 自验（每条附证据）

1. `npx tsc --noEmit` + `pnpm build` 通过。
2. mock 链状态流转（curl 级）：不上传 cage 照直接 POST vibe 后轮询 project JSON，`vibeRender.status` 到 done，`afterUrl` 非空且返回 200；`beforeUrl` 应为空或缺省。
3. 真链 E2E 至少 1 次：无真实笼箱照 + 宠物照或纯 vibe 文字 → fal 产出造景图落盘（附产物路径与耗时）。成功 1 次即停。
4. cage 未上传时 POST vibe 返回 202 并进入生成状态（curl 证据）。
5. 文件所有权零违规（git diff --stat）。

### 4B. 验收 Story（主控/独立 verifier 浏览器执行；自包含断言）

1. **mock 全流程**：访问 `/?mock=1` → vibe 区上传一张笼箱图（4:3 位）→ 位内出现该图预览 → textarea 清空后输入"温馨森林风" → 点"生成" → 按钮 disabled + 区块出现生成中提示 → ≤5s 后效果图区三格全部出图：第一格图像与上传的笼箱原图相同（src 指向同一文件）、第二格为新生成图、第三格为第二格的 3:4 中心裁切且左下/右下可见品牌角标。
2. **无笼箱图生成**：未传笼箱照时"生成"按钮可点；点击后按钮进入生成中 disabled；≤5s 后效果图区出现 after 图，改造前卡保持示例占位。
3. **宠物照自动带入**：先在创建器上传宠物照 → 滚到 vibe 区 → 宠物位（1:1）已显示同一张图的缩略；点击该位可另选一张替换，替换后创建器的照片不受影响。
4. **文案可编辑**：textarea 默认文案与原版示例一致（视觉零回归），光标可进入、可增删文字。

## 5. 不要做

- 不做拖动裁切窗（构图偏移再补）。不做分享/导出文件功能（展示级）。
- 不动创建器上传逻辑本身（批次1 所有权），只读其 state/props。
- 不反复烧 fal 额度。

## 6. 产出

报告：`docs/reports/batch2-builder-report.md`；stdout ≤200 字；未达标 `INCOMPLETE:`。

## 7. 档位

sonnet（链路单薄、参考模式现成：upload/scenes 路由 + revamp prompt 都有近似实现）。失败 1 次升 opus。
