# PetScape / TinyHabitat AI — 黑客松交付版

宠物（异宠）3D 打印定制电商：上传宠物照片 → AI 生成游戏角色式 3D 形象 → 穿戴装扮 → 白底标品模块加入 3D 环境预览 → vibe 环境改造效果图 → 真实切片报价 → STL/G-code 下载。

前端为设计师定稿的 TinyHabitat 页面（视觉零回归移植），后端为已验证的生成管线（fal 生图 + Meshy/Tripo 图生3D + PrusaSlicer 切片）。

## 快速开始

```bash
cd web && pnpm install
# 项目根 .env 需要：FAL_KEY / MESHY_API_KEY（TRIPO_API_KEY 备用，当前额度耗尽）
pnpm dev            # 开发（含 dev overlay）
pnpm build && pnpm start   # demo 推荐：production 模式，无 overlay 干扰
```

- 首页 `/` = 完整产品页；`/workbench` = 旧工作台（后端能力调试入口）；`/scene-lab` = three.js 场景实验页。
- `?mock=1` = 全链 mock（零 API 消耗、秒级出结果）——**demo 网络故障时的保险丝**。
- `?project=<id>` = 恢复已有项目（舞台 GLB / 报价 / 下载全恢复）。

## Demo 双轨编排（重要）

后端 store 是**内存态**——server 重启项目即丢，以下流程在起服务后执行：

1. 起服务（推荐 production：`pnpm build && pnpm start`）。
2. 预热第二轨：`node tools/demo-prep.mjs --real`（约 3 分钟，真链）或省额度用 mock 版 `node tools/demo-prep.mjs`。脚本最后打印**恢复 URL**，在浏览器 tab B 打开备用。
3. 现场演示：tab A 走真实流程——填档案、传照片、点"生成 3D 可旋转预览"（真链约 3 分钟，舞台有管线阶段进度：风格化 → 3D 建模 → 切片报价）。
4. 等待期间切 tab B 讲已完成项目：可旋转 GLB、装扮、模块商城、环境预览、报价与 STL/G-code 下载。
5. 讲完回 tab A，第一轨已出炉。

## 关键配置（可调）

| 配置 | 位置 | 说明 |
|---|---|---|
| 风格化 prompt | `web/app/lib/prompts/avatarStyle.ts` | 游戏角色风格模板 + 装扮词表，**直接改文案即可调效果** |
| `STYLE_ENABLED` | 同上 | `false` = 跳过风格化直喂原图（效果不佳时的回退） |
| `MESH_ENGINE` | 同上 | `meshy`（当前默认）/ `tripo`（充值后可切回，走三视图管线） |
| 体型→打印尺寸 | 批次1 spec | 1-5 档 → 80/100/120/140/160mm，换档自动重切 |

## 架构一页

```
landing（V3 定稿页, app/page.jsx + components/landing/）
  ├─ 宠物创建器 → POST avatar：fal 风格化 → [Meshy 单图 | Tripo 三视图] → GLB
  │               └→ 自动切片（normalize → PrusaSlicer，不挖腔）→ 真实重量/时长 → STL/G-code 下载
  ├─ vibe 区 → POST vibe：笼箱照+宠物照+文字 → fal revamp → 改造前/后/分享图三态
  ├─ 环境预览 → SceneViewer（three.js）：5 个 Meshy 真资产 + billboard，宠物居中
  ├─ 场景包 → 模块子集批量加入 selectedIds（真数据流假闭环）
  └─ 订单条 → 按用户实际进度推导高亮（至"确认模型"）
store = globalThis 内存 Map（无数据库）；产物落 web/public/generated/
```

## 文档地图（真相源）

- `docs/integration-mapping.md` — **工程真相源**：51 前端功能点 × 74 后端能力映射、全部拍板记录、批次划分
- `docs/TinyHabitat-PRD.md` — 产品愿景（设计师侧）
- `docs/specs/` — 各批次闭合 spec（含验收 Story）；`docs/reports/` — builder/verifier 报告与证据
- `docs/research/` — 前端/后端两条隔离研究线的三级文档（worker → AGGREGATE）
- `assets-3d/` — 离线生成的 9 个 3D 资产（5 模块 + 4 装扮，Meshy，含预览图）
