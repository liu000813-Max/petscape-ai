# 批次2 独立验收报告（4B Story 1-4）

- Verifier：独立 agent（不了解实现过程），2026-07-04
- 环境：独立 worktree `agent-a82575011fef2753b`，`pnpm install` 后 `PORT=3012 pnpm dev`（Next.js 16.2.10 Turbopack）
- 模式：全程 `?mock=1`（真链已由 builder 4A-3 验证，不烧 fal 额度）
- 工具：Playwright 1.55.0 headless chromium（脚本 `tools/verify-batch2/verify.cjs`，断言明细 `tools/verify-batch2/results.json`）
- 上传素材：cage=`web/public/assets/scene-urban-base.jpg`；pet=`web/public/mockup-assets/pet-hamster-ref.jpg`；替换=`web/public/assets/species-rat.png`
- 截图：`tools/verify-batch2/shots/`（每 Story 操作前后）

## 总判定：PASS 4/4（自动化断言 19/19 通过）

| Story | 判定 | 断言 |
|---|---|---|
| 1 mock 全流程 | PASS | 10/10 |
| 2 前置校验 | PASS | 2/2 |
| 3 宠物照自动带入 | PASS | 3/3 |
| 4 文案可编辑 | PASS | 4/4 |

## Story 1：mock 全流程 — PASS

访问 `/?mock=1`（projectId=7c177d79…）→ 4:3 位上传笼箱图 → 位内出现预览（`/uploads/{id}/cage.jpg`，shots/story1-02）→ textarea 清空后输入"温馨森林风" → 点"生成"：

- 按钮 disabled + 文案"生成中…"，区块出现提示"正在生成改造效果图，请稍候…"（story1-03）
- **2419ms**（≤5s）后效果图区三格全部出图（story1-04）
- 第一格 src=`/uploads/{id}/cage.jpg` 与上传位预览 src 完全相同；HTTP 取回字节与本地原图 **byte-identical**（160423 bytes）
- 第二格为新生成图 `/generated/{id}/vibe/after-1783175363847.png`，HTTP 200
- 第三格与第二格同源图；`.share-crop` 容器实测宽高比 0.749（3:4），img `object-fit: cover` + `object-position: 50% 50%`（中心裁切）；品牌角标含 logo 图 + 文案"PetScape · 我的宠物小家改造"，位于卡片底部（bounding box 判定 bottom=true，story1-05）

## Story 2：前置校验 — PASS

- 未传笼箱照："生成"按钮 `disabled`（story2-01）
- 传图后：按钮恢复可点（story2-02）

## Story 3：宠物照自动带入 — PASS

- 创建器上传宠物照后，vibe 区 1:1 位显示**同一** blob URL 缩略（`blob:…53449c00`，story3-03）
- 点击 1:1 位另选一张 → 该位 src 变为新 blob（`…f2642de4`，story3-04）
- 创建器照片 src 不变（仍 `…53449c00`，story3-05）——双向独立性成立

## Story 4：文案可编辑 — PASS

- textarea 默认值 = "森林奶酪屋，童话厨房氛围，适合花枝鼠钻洞、觅食和攀爬。"，与原版 V3（git e21e99e 的 `<span>` 文案）逐字一致；prompt 胶囊视觉零回归（story4-01 对照占位视觉）
- 光标可聚焦；末尾键入"测试增字"成功、Backspace×4 退回默认（story4-02/03）

## 观察项（不影响 4B 判定）

1. **分享图角标视觉**：断言原文（"左下/右下可见品牌角标"）满足，但 story1-05 显示 logo 图占据角标主体、偏大，右侧一行文案"PetScape · 我的宠物小家改造"在卡片右缘发生竖排折行并被裁切，与 §3 "logo 小图 + 一行文案"的意图有出入。属视觉打磨项，建议主控目检 story1-05 后决定是否让 builder 收敛角标尺寸/文案换行。
2. 页面左下角 Next.js dev overlay 显示 "1 Issue"（dev 模式指示，非本批次断言范围）。

## 证据索引

- shots/story1-01…05、story2-01…02、story3-01…05、story4-01…03、final-fullpage.png
- 断言级明细：tools/verify-batch2/results.json（19 条全 PASS，含各断言实测值）
