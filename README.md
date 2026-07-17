# PetScape / TinyHabitat AI — 黑客松交付版

宠物（异宠）3D 打印定制电商：上传宠物照片 → AI 生成游戏角色式 3D 形象 → 穿戴装扮 → 白底标品模块加入 3D 环境预览 → vibe 环境改造效果图 → 真实切片报价 → STL/G-code 下载。

前端为设计师定稿的 TinyHabitat 页面（视觉零回归移植），后端为黑客松期间已验证的生成管线（fal 生图 + Meshy/Tripo 图生3D + PrusaSlicer 切片）。这里列出的是当前实现事实，不代表这些工具已经成为正式技术选型。

## 当前产品方向

黑客松版本同时展示了宠物 Avatar、AI 环境效果图、3D 场景和切片下载。当前产品方向聚焦一条真实交易闭环：用户生成或上传一个物品模型，在完整 3D 场景中确认摆放、比例和效果，选择材料和颜色，通过制作与宠物安全检查，获得自动报价并直接付款，随后通过真实订单跟踪生产与物流。

当前代码仍是黑客松交付基线，不代表这条产品链已经完成。完整产品定义以根目录的 `PetScape-PRD.md` 为准，目标系统结构以 `ARCHITECTURE.md` 为准，当前实现行为以代码为准。

## 快速开始

```bash
cd web && pnpm install
# 项目根 .env 需要：FAL_KEY / MESHY_API_KEY（TRIPO_API_KEY 备用，当前额度耗尽）
pnpm dev            # 开发（含 dev overlay）
pnpm build && pnpm exec next start   # demo 推荐：production 模式，无 overlay 干扰
```

- 首页 `/` = 当前产品页；`/workbench` = 历史工作台原型；`/scene-lab` = three.js 场景实验页。两者都不是未来产品架构入口。
- `?mock=1` = 全链 mock（零 API 消耗、秒级出结果）——**demo 网络故障时的保险丝**。
- `?project=<id>` = 恢复已有项目（舞台 GLB / 报价 / 下载全恢复）。

## Demo 双轨编排（重要）

后端 store 是**内存态**——server 重启项目即丢，以下流程在起服务后执行：

1. 起服务（推荐 production：`pnpm build && pnpm exec next start`）。
2. 预热第二轨：`node tools/demo-prep.mjs --real`（约 3 分钟，真链）或省额度用 mock 版 `node tools/demo-prep.mjs`。脚本最后打印**恢复 URL**，在浏览器 tab B 打开备用。
3. 现场演示：tab A 走真实流程——填档案、传照片、点"生成 3D 可旋转预览"（真链约 3 分钟，舞台有管线阶段进度：风格化 → 3D 建模 → 切片报价）。
4. 等待期间切 tab B 讲已完成项目：可旋转 GLB、装扮、模块商城、环境预览、报价与 STL/G-code 下载。
5. 讲完回 tab A，第一轨已出炉。

## 关键配置（可调）

| 配置 | 位置 | 说明 |
|---|---|---|
| 风格化 prompt | `web/app/lib/prompts/avatarStyle.ts` | 游戏角色风格模板 + 装扮词表，**直接改文案即可调效果** |
| `STYLE_ENABLED` | 同上 | `false` = 跳过风格化直喂原图（效果不佳时的回退） |
| `MESH_ENGINE` | `web/app/lib/jobs/avatarJob.ts` | `auto`（默认）= tripo#key1 → tripo#key2 → meshy 级联降级（瞬时错误每级重试一次，额度/认证类硬错误直接降级）；`tripo` = 只级联双 key；`meshy` = 直连单图 |
| Tripo 双 key | 项目根 `.env` | `TRIPO_API_KEY` + `TRIPO_API_KEY_2`，级联顺序即优先级 |
| 体型→打印尺寸 | 批次1 spec | 1-5 档 → 80/100/120/140/160mm，换档自动重切 |

## 当前黑客松基线架构（非目标架构）

```
landing（V3 定稿页, app/page.jsx + components/landing/）
  ├─ 宠物创建器 → POST avatar：fal 风格化 → [Tripo#1 → Tripo#2 → Meshy 级联] → GLB
  │               └→ 自动切片（normalize → PrusaSlicer，不挖腔）→ 真实重量/时长 → STL/G-code 下载
  ├─ vibe 区 → POST vibe：可选笼箱照+宠物照+文字 → fal revamp 或 t2i 造景 → 改造前/后/分享图三态
  ├─ 环境预览 → SceneViewer（three.js）：5 个 Meshy 真资产 + billboard，宠物居中
  ├─ 场景包 → 模块子集批量加入 selectedIds（真数据流假闭环）
  └─ 订单条 → 按用户实际进度推导高亮（至"确认模型"）
store = globalThis 内存 Map（无数据库）；产物落 web/public/generated/
```

## 文档地图（真相源）

- `PetScape-PRD.md` — **产品真相源**：产品定位、核心闭环、模块定义与范围边界
- `ARCHITECTURE.md` — **架构真相源**：目标系统结构、模块与数据归属、依赖方向和迁移边界
- `DEVELOPMENT-PLAYBOOK.md` — 开发流程与可靠性方法，不定义产品或架构结论
- `docs/specs/`、`docs/reports/` — 黑客松批次的历史 Spec 与验收证据，不自动约束未来实现
- `docs/research/` — 历史研究与探查证据，不作为当前架构或代码现状的正本
- `assets-3d/` — 离线 3D 素材、生成来源与参考资产；迁移或清理前必须先分类
