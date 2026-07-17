# 模块盘点：LLM Agent 五件套（`llm-agents`）

覆盖路径：`web/app/lib/agents/{collecting,extract,preview,rendering,selecting}/{agent.ts,instructions.ts}`
排除：`design/` 全目录、`node_modules`、`.next`、`.git` 内部对象、`PRD.md`/`max最新版的PRD.docx`（未读，不作证据）。
证据方式：直接读代码 + 全项目 grep 调用点 + git log（design/ 路径改动已剔除）。生成时间：2026-07-04。

## 结构总览

五个 agent 高度同构：每个都是 `Codex SDK`（`@openai/codex-sdk`，订阅通道，零 API key，见下方"外部依赖"）单轮 `thread.run()` 调用 + JSON 抽取/校验 + 2 次重试 + 兜底文案。核心分歧点是**谁在活跃调用路径上**——这是本次盘点最重要的发现。

**关键裁决（已用 grep 坐实）**：当前产品唯一活跃前端是 `web/app/page.tsx`（tldraw 工作台）。它只调用 `/api/project/**` 路由，而这些路由里只有 `extract` 一个 agent 被接入。其余四个 agent（`collecting`/`rendering`/`selecting`/`preview`）全部只被 `web/app/lib/jobs/executor.ts` 调用，而 `executor.ts` 唯一的入口路由 `web/app/api/session/[id]/message/route.ts` 只被 `web/app/legacy/page.tsx`（8 阶段聊天页，CLAUDE.md 明确标注"保留可访问但已冻结"）调用。也就是说：**这四个 agent 的代码没有失效或被删，但在当前产品主干（工作台）里是不可达的死代码路径（reachability dead code），只在冻结的 legacy 页面里可达**。

---

## 能力 1：collecting agent — 收集阶段自然语言理解 + 阶段推进决策

- **名称**：`runCollectingAgent`
- **入口**：`web/app/lib/agents/collecting/agent.ts:46`
- **输入 → 输出**：`(session: Session, userText: string, photoAbsPath?: string)` → `CollectingAgentResult { brief, readyToRender, newConstraints, replyToUser }`。输入含可选照片（`local_image`，Codex SDK 多模态输入，`agent.ts:57`），用于识别宠物物种/外观但**不得**用于估算尺寸（instructions.ts:29 硬规则 1）。
- **外部依赖**：Codex SDK（订阅通道，走本机 `codex login` 凭证 `~/.codex/auth.json`，非项目 `.env` key；根据 `reference/codex-sdk-facts.md:22` 与 `agent.ts:1,50` 中 `new Codex()` 未传 `apiKey` 坐实）。**无需在 `.env` 配置 key**，只要求本机已 `codex login`（未在本次盘点范围内验证本机登录态，仅验证代码层不读取任何 env key）。
- **被谁调用**：`web/app/lib/jobs/executor.ts:4,32`（`handleCollecting`）。`executor.ts` 的唯一触发路由是 `web/app/api/session/[id]/message/route.ts:59`（`enqueueStageJob`），而该路由只被 `web/app/legacy/page.tsx:78` fetch。**当前工作台 `page.tsx` 不可达**。
- **成熟度初判**：looks-working（独立看：JSON 抽取/schema 校验/2 次重试/兜底文案齐全，硬规则清楚，git `c8f58a5`/`8d73a99` 显示经过独立验收 ACCEPT + E2E 死锁修复）；**但在当前产品主干语境下是 orphan-in-practice**（只在冻结 legacy 路径可达）。
- **是否核心管线能力**：按 `_map.md` 职责定义算，但按当前工作台产品主干判断，不在活跃路径上。

## 能力 2：collecting agent — JSON 容错抽取（`extractJson`）

- **名称**：`extractJson`（collecting 版本）
- **入口**：`web/app/lib/agents/collecting/agent.ts:9-18`
- **输入 → 输出**：Codex 返回的原始文本 → 解析出的 JS 对象。三级兜底：直接 `JSON.parse` → 抽取 ```json 代码块 → 抽取首尾花括号之间内容。
- **外部依赖**：无（纯字符串处理）。
- **被谁调用**：仅 `runCollectingAgent` 内部（`agent.ts:61`），无外部调用者。
- **成熟度初判**：looks-working（同构模式在五个 agent 里重复出现 5 次，见"横向观察"）。
- **是否核心管线能力**：否，是共享的健壮性 helper。

## 能力 3：extract agent — 静默字段抽取（唯一接入工作台的 agent）

- **名称**：`runExtractAgent`
- **入口**：`web/app/lib/agents/extract/agent.ts:62`
- **输入 → 输出**：`(message: string, currentBrief: Brief)` → `ExtractResult { patch: Partial<Brief>, reply: string }`。从一句自然语言中静默抽取 `species`（限定 5 个 slug 之一，`instructions.ts:4,27`）、`petName`、`petSize`、`style`、`traits`（映射到预设 chips）、`vibe`、`taboos`，不编造用户未说信息（instructions.ts:37 硬规则 1）。
- **外部依赖**：Codex SDK，同上，无项目 `.env` key 依赖。超时单独定制为 60s（`agent.ts:60`，注释说明 spec 要求 30s 但实测单轮耗时约 27.5s，放宽换低误报率）。
- **被谁调用**：`web/app/api/project/[id]/agent/extract/route.ts:4,22`（POST 路由，`agent.ts:22`）。此路由被 `web/app/page.tsx:273`（当前工作台右栏 Chat）实际 fetch 调用。**这是五个 agent 里唯一真正处于活跃产品路径上的一个**。
- **成熟度初判**：looks-working。git `df1ce85`（"feat: agent silent-extract — chat message auto-fills the brief (B4)"）为工作台阶段新增，晚于 legacy 冻结提交 `5273d75`，说明这是重锚定后专为工作台补建的能力，而非遗留代码。
- **是否核心管线能力**：是——五件套中唯一的核心管线能力（当前产品主干视角）。

## 能力 4：preview agent — 3D 预览意图理解（含正则启发式短路）

- **名称**：`runPreviewAgent`
- **入口**：`web/app/lib/agents/preview/agent.ts:39`
- **输入 → 输出**：`(session: Session, userText: string)` → `PreviewAgentResult { action: 'confirm'|'retry3d'|'modifyAppearance'|'reselect', replyToUser, parseFailed? }`。
- **外部依赖**：Codex SDK，同上。**但注意**：函数先跑本地正则 `heuristic()`（`agent.ts:31-37,40-41`）命中即直接返回，**完全不调用 Codex**——四类意图（重选/改外观/重跑3D/确认）各有一条正则，命中任一条就短路。只有正则全部不命中时才真正调用 LLM。这意味着"LLM 理解意图"这条能力在实际运行时有相当比例请求根本不经过 LLM。
- **被谁调用**：`web/app/lib/jobs/executor.ts:7,146`（`handlePreview`）。同 collecting，仅经冻结的 legacy 页面可达。
- **成熟度初判**：looks-working，但工程上是"正则优先、LLM 兜底"的混合设计，与其被定位为"LLM Agent"不完全相符——如果正则覆盖率高，LLM 调用路径可能长期零流量、退化为未实际验证的代码。git `9f8e04c`（"M4...preview四路由Agent"）显示曾独立验收 ACCEPT。
- **是否核心管线能力**：不在当前工作台主干上。

## 能力 5：rendering agent — 2D 效果图反馈理解 + 重生图 prompt 改写

- **名称**：`runRenderingAgent`
- **入口**：`web/app/lib/agents/rendering/agent.ts:39`
- **输入 → 输出**：`(session: Session, userText: string)` → `RenderingAgentResult { action: 'regenerate'|'proceed', revisedPrompt?, newConstraints, replyToUser, parseFailed? }`。`action==='regenerate'` 时必须提供完整可直接生图的中文 prompt（`instructions.ts:21`），校验层强制此约束（`agent.ts:26`：缺 `revisedPrompt` 直接 `throw`）。
- **外部依赖**：Codex SDK，同上。下游 `revisedPrompt` 会被 `executor.ts:80` 传给 fal.ai 生图链（`generateSceneImage`），但生图本身不在本模块职责内。
- **被谁调用**：`web/app/lib/jobs/executor.ts:5,59`（`handleRendering`）。同上，只经 legacy 页面可达。executor 里对此 agent 有额外说明性注释（`executor.ts:52-53`）：明确指出**不能用关键词正则抢跑**（会把"屋顶换成蓝色"因命中"屋"误判为选物），点名了本 agent 与 selecting 阶段之间过去存在过的正则冲突风险，是唯一一处显式要求"必须走 LLM、不能走正则"的 agent。
- **成熟度初判**：looks-working。git `512d416`（"M2: rendering 阶段...独立验收 ACCEPT, 真实生图验证屋顶变蓝"）显示曾用真实生图端到端验证过。
- **是否核心管线能力**：不在当前工作台主干上（若未来"售中重对话"或 legacy 链路复活则会重新相关，见 `PRD.md` §5 提及的"售中 Agent 调模型"接口点，本次未读 PRD 正文，仅代码侧标注此为"规划中未实现"的关联点）。

## 能力 6：selecting agent — 效果图中定位单一可打印物品（多模态 + 正则启发式短路）

- **名称**：`runSelectingAgent`
- **入口**：`web/app/lib/agents/selecting/agent.ts:57`
- **输入 → 输出**：`(session: Session, userText: string)` → `SelectingAgentResult { selectedItem, itemDescription, replyToUser, parseFailed }`。输入含最新场景图（`local_image`，`agent.ts:78`），要求 LLM 在图中定位用户想打印的单一物品并输出详细描述（供后续抠图保真，`instructions.ts:22`）。
- **外部依赖**：Codex SDK 多模态输入，同上。
- **被谁调用**：`web/app/lib/jobs/executor.ts:6,88`（`handleSelecting`）。同上，仅经 legacy 页面可达。
- **成熟度初判**：looks-working，但同 preview agent 一样存在**正则启发式短路**（`heuristicSelection`，`agent.ts:42-55,68-69`）：颜色+物品名关键词命中即直接返回，不经过 LLM 视觉理解；只有正则不命中才真正调用 Codex 视觉能力。git `f440a55` 显示该阶段"验收REJECT后修复"，说明历史上有过质量问题被打回重做。
- **是否核心管线能力**：不在当前工作台主干上。

## 能力 7：五件套共享的 JSON 容错抽取 + 2 次重试 + 兜底文案模式（横向观察，非独立能力）

- **证据**：`extractJson` 函数体在 `collecting/agent.ts:9-18`、`extract/agent.ts:13-26`、`preview/agent.ts:8-17`、`rendering/agent.ts:8-17`、`selecting/agent.ts:9-18` 五处**逐字重复**（仅 extract 版本注释略有差异）；2-attempt 重试循环在 collecting/preview/rendering/selecting 四处重复（`for (let attempt = 0; attempt < 2; attempt++)`），extract agent 是唯一没有重试循环、单次失败直接兜底的（`extract/agent.ts:63-78`）。
- **单一真相源违规**：这是同一段逻辑的 5 份拷贝，不是 5 条独立能力，但构成**维护风险**——任一份修 bug（例如 fenced JSON 正则、重试次数）都需要手动同步其余 4 份，否则产生行为漂移。不作为独立能力计分，但记录为技术债证据。

---

## TODO/FIXME/注释调用/永假 flag 排查结果

- 全目录 grep `TODO|FIXME|XXX`：**零命中**（`web/app/lib/agents/` 范围内无显式技术债标记）。
- 未发现被注释掉的 agent 调用（`executor.ts` 与 `extract/route.ts` 中五个调用点均为活代码，非注释）。
- 未发现永远为 false 的 feature flag 直接包裹某个 agent 调用。
- **但发现两处等价于"半失活"的证据，比 TODO 更隐蔽**：
  1. **可达性死代码**（本报告核心发现）：collecting/preview/rendering/selecting 四个 agent 的唯一入口链路（`executor.ts` → `/api/session/[id]/message` → `legacy/page.tsx`）在产品叙事上已被 CLAUDE.md 标注冻结，代码未删但无法从当前工作台触达。这是"文档没写但代码结构证实"的 half-done 证据，比注释掉的调用更容易被误判为"能力仍在维护"。
  2. **正则短路吃掉 LLM 调用**（preview agent `agent.ts:31-41` 、selecting agent `agent.ts:42-55,68-69`）：两个 agent 在实际请求分布里可能大比例走正则分支而非 LLM 分支，"LLM 意图理解"这条能力的真实调用频率、以及其 prompt/schema 是否仍随代码演进保持有效，缺乏证据支持。

---

## 结构化清单摘要（供上层聚合引用）

| Agent | 核心能力 | 活跃可达性 | 成熟度 | 核心管线（当前工作台视角） |
|---|---|---|---|---|
| collecting | 收集阶段 NLU + 阶段推进 | 仅经冻结 legacy 页 | looks-working（孤立看） | 否 |
| extract | 静默字段抽取 | **工作台活跃路径** | looks-working | **是** |
| preview | 3D预览意图理解（含正则短路） | 仅经冻结 legacy 页 | looks-working，但 LLM 分支实际调用率存疑 | 否 |
| rendering | 2D效果图反馈理解+prompt改写 | 仅经冻结 legacy 页 | looks-working | 否 |
| selecting | 效果图中定位物品（多模态+正则短路） | 仅经冻结 legacy 页 | looks-working，历史有 REJECT 记录 | 否 |

**一句话结论**：五件套代码质量本身相当一致、扎实（统一的 schema 校验 + 重试 + 兜底），git 历史显示多数经过独立验收。但产品重锚定（Max 电商漏斗 + 工作台）之后，只有 `extract` 真正长在当前主干上；另外四个是功能完整但当前不可达的遗留资产，若未来"售中重对话"或 legacy 链路被重新启用，可以直接复用，但现状不应被计入"当前工作台的核心能力"。
