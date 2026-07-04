# 批次2 Builder 报告：vibe 环境改造效果图（F36-F39）

spec: `docs/specs/batch2-vibe-render.md`

## 结果

打通「笼箱照+宠物照+vibe 文字 → fal edit 改造后效果图 → 三态展示」全链路，含 mock 与真链。

- `app/lib/images/scenePrompt.ts` 新增 `buildVibePrompt(brief, vibeText, hasPetPhoto)`：参考 `buildRevampPrompts` 风格（硬约束保留笼箱结构、置入宠物），加「主体居中留白」构图约束。
- `app/lib/jobs/vibeJob.ts`（新建）：`startVibeJob` 同步置 `vibeRender.status=running`（beforeUrl=cage 原图）→ 后台 fal edit（多图输入：cage 主图+宠物照参考）→ 落盘 `public/generated/{projectId}/vibe/` → 状态机 done/failed。mock 模式延时 1s 拷贝现成图。
- `app/api/project/[id]/vibe/route.ts`（新建）：`POST` body `{vibe}`，cage 未上传 400，成功 202。
- `UploadVibeSection.jsx`：`<span>`→真 `<textarea>`（默认文案不变，可编辑）；笼箱位真实 `<input type=file>` 直传（POST upload kind=cage，即时预览）；宠物位自动带入 `petImageUrl` props（缩略图+可点击本地替换，替换不回写创建器 state）；生成按钮 onClick→POST vibe→轮询 project GET；cage 未传时按钮 disabled。
- `RenderSection.jsx`：轮询 project GET 读 `vibeRender`，三态：改造前=beforeUrl 原图直用、改造后=afterUrl、分享图=afterUrl 的 CSS `object-fit:cover` 3:4 中心裁切+品牌角标（`petscape-logo.png`+文案）。生成前保持 `AssetPlaceholder` 原占位。
- `styles.css` 新增 `.vibe-textarea` / `.vibe-generating-hint` / `.upload-vibe-card` / `.render-photo-card` / `.share-crop` / `.share-badge` 等，复用既有 `.prompt-box`/`.asset-placeholder`/`.brand-logo` 视觉语汇，未自创新风格。

验证方式：因项目目录 `.next/dev/lock` 被并行 builder 的 dev server 占用，端口 3002 无法直接复用同目录起服务；改在 `<USER_HOME>/Desktop/PetScape-final-batch2-verify`（独立 `pnpm install`，非 symlink）起 3002 dev server 验证，验证完已清理删除，未污染主项目。

## 验收证据（spec §4A）

1. **tsc + build 通过**：`npx tsc --noEmit` exit 0（无输出）；`pnpm build` 输出 `✓ Compiled successfully`，路由列表含 `ƒ /api/project/[id]/vibe`（唯一 warning 是 falClient.ts 既存的 NFT trace 提示，非本次改动引入，`scenes/route.ts` 早已有同款引用）。

2. **mock 链状态流转**：
   ```
   POST /api/project/{id}/vibe?mock=1 → {"ok":true,"vibeRender":{"status":"running","beforeUrl":"/uploads/.../cage.jpg"}}  HTTP 202
   （2s 后）GET /api/project/{id} → vibeRender: {"status":"done","beforeUrl":"/uploads/.../cage.jpg","afterUrl":"/generated/.../vibe/after-*.png"}
   beforeUrl curl: 200 / afterUrl curl: 200
   ```

3. **真链 E2E（成功 1 次即停）**：真实 cage 照（scheme-a-mushroom-v1.jpg）+ 宠物照（pet-hamster-ref.jpg）+ vibe 文字「温馨森林风，暖黄灯光，苔藓与原木装饰」→ POST vibe（无 mock）→ 轮询 4 次（每次 3s 间隔，共约 12-15s）到 done。产物：`public/generated/{projectId}/vibe/after-1783173136970.png`，1024×1024 PNG，1.4MB，人工确认图像质量：笼箱结构保留、宠物置入自然、氛围按文字改造、主体居中留白。

4. **cage 未上传 4xx**：
   ```
   POST /api/project/{id}/vibe → {"error":"请先上传笼箱照片"}  HTTP 400
   ```

5. **文件所有权零违规**：
   ```
   git diff --stat -- UploadVibeSection.jsx RenderSection.jsx styles.css scenePrompt.ts project.ts page.jsx
   → 只命中 UploadVibeSection.jsx / RenderSection.jsx / styles.css / scenePrompt.ts（+16 行，仅新增函数）
   → project.ts / page.jsx 未出现在 diff 中（零改动）
   git status --porcelain 确认新建：app/api/project/[id]/vibe/（untracked）、app/lib/jobs/vibeJob.ts（untracked）
   未执行任何 git add/commit/push。
   ```

## 额外验证（非 spec 强制，但工具成本低故做了）

4B 名义上归主控/独立 verifier 执行，但本地已有 Playwright+Chromium 缓存（成本近零），额外跑了一遍浏览器级验收，作为补充证据（不代替正式验收）：

- 前置校验：`disabledBefore=true` → 上传笼箱图后 `disabledAfterUpload=false`
- textarea 可编辑：`fill('温馨森林风')` → `inputValue()` 回读一致
- 点击生成：`disabledDuring=true`，按钮文案变「生成中…」，`.vibe-generating-hint` 可见
- 三态出图（mock，≤5s 内）：`renderPhotoCardCount=3`；`beforeSrc === cageImgSrc`（改造前=上传的笼箱原图同一文件）；`afterSrc` 为新生成图；`shareSrc === afterSrc`（分享图=改造后图裁切）；分享卡实测宽高比 `0.7499865858238987`（≈3/4）；`.share-badge` 可见。
- 截图：`/private/tmp/claude-501/-Users-alfred-gu-Desktop/6da835ce-b68c-416f-a8e4-de3532846153/scratchpad/screenshot_final.png`

## Observations

- `app/components/landing/styles.css` 是全局共享文件，spec 文件所有权列表未明确列出，但三个并行 builder（批次1/2/其它）大概率都需要改它才能贴现有视觉语汇。`git diff --stat` 显示同一次检查里已有 `EnvironmentPreviewSection.jsx`/`ManufacturingSection.jsx`/`OrderFlowSection.jsx`/`PetCreatorSection.jsx` 的改动（非本 builder 所为，判断是并行的批次1 builder），styles.css 合并冲突风险需主控在最终 review/合并阶段关注。
- `app/lib/images/falClient.ts` 触发的 Turbopack build warning（"Encountered unexpected file in NFT list"）是既存问题（`scenes/route.ts` 早已引入同款动态 `readFileSync` 读 `.env`），本次未引入新 warning，未处理（不在文件所有权内，falClient.ts 不可改）。
- Next.js dev server 对同一项目目录有单例锁（`.next/dev/lock`），三个并行 builder 若都需要本地起 dev server 验证会互相冲突；本次通过在项目同级建独立目录+独立 `pnpm install`（非 node_modules symlink，Turbopack 不接受跨 filesystem-root 的 symlink）规避，验证后已清理。后续批次若有类似并行验证需求，可考虑此模式或主控统一分配端口/工作目录。

## 改动文件

- `web/app/lib/images/scenePrompt.ts`（新增 `buildVibePrompt`，未动现有函数）
- `web/app/lib/jobs/vibeJob.ts`（新建）
- `web/app/api/project/[id]/vibe/route.ts`（新建）
- `web/app/components/landing/UploadVibeSection.jsx`
- `web/app/components/landing/RenderSection.jsx`
- `web/app/components/landing/styles.css`（新增 class，未删改既有规则）
