# 成熟度取证：LLM Agent 五件套 — extract agent（核心能力）

取证范围：`web/app/lib/agents/extract/{agent.ts,instructions.ts}` 及其调用链。
排除：`design/` 全目录、`PRD.md`/`.docx`（未读，不作证据）、`node_modules`/`.next`/`.git` 内部对象。
取证方式：读代码（活跃调用链端到端）+ git log + 依赖/凭证存在性核验 + 测试盘点。生成时间：2026-07-04。
红线遵守：未真调任何外部付费 API（Codex/LLM），未改任何源文件，未 npm install。

---

## 能力：extract agent — 静默字段抽取（唯一接入工作台的 agent）

- **初判**：looks-working（keyCapability=true）
- **终判：能跑**（活跃产品路径上唯一真正长在主干的 agent；代码闭合、依赖到位、失败兜底不阻塞表单；未能自动化的残量仅剩「真调一次 Codex 看抽取质量」，因红线禁止付费调用而未爬上顶档，见下方残量说明）

### 端到端调用链已坐实（reachability = 活跃）

完整活跃链条逐跳验证，无断点：

1. 前端触发：`web/app/page.tsx:266 sendChatMessage()` → 由回车（`:625`）与发送按钮（`:633`）调用，POST `/api/project/${id}/agent/extract`（`:273`）。
2. 路由：`web/app/api/project/[id]/agent/extract/route.ts:22` 调 `runExtractAgent(message, project.brief)`，将返回 `patch` 逐字段合并进 server in-memory 单例 brief（`:24-37`，空字符串/空数组跳过），返回 `{patched, missing, reply}`。
3. 前端回填：`page.tsx:288-293` 用 `data.reply` 追加助手消息、`data.missing` 更新缺口、再 GET 刷新 brief 让左栏可见。
4. **不经 legacy**：`grep` 确认 `web/app/legacy/` 完全不引用 `agent/extract` 或 `runExtractAgent`——extract 是工作台独有，与另外四个「仅 legacy 可达」的 agent 相反。这佐证了模块盘点「五件套里唯一在活跃主干上」的裁决。

### 代码层健壮性（读 `agent.ts` 坐实）

- JSON 三级容错抽取 `extractJson`（`agent.ts:13-26`）：直接 parse → ```json fenced → 首尾花括号切片。
- 校验层 `validate`（`:32-54`）：`species` 强制限定 5 个 slug 白名单（`isSpeciesSlug`，非法值丢弃）；`traits` 强制过滤到 6 个预设 chip 白名单（`:44-46`）；字符串字段 trim 后空值丢弃；`reply` 缺失即 throw。这直接实现了「不编造未说信息」——非枚举值在校验层被静默丢弃而非落表。
- 失败兜底（`:75-78`）：任何异常（超时/SDK 报错/JSON 解析失败）都被 catch，返回 `{patch:{}, reply: FALLBACK_REPLY}`（「我这边开小差了，请直接在左侧表单填写」）。**空 patch 在路由层不 touch project**，表单不被污染、不被阻塞——契合「不阻塞表单」核心验收。
- 与另外四个 agent 的差异：extract 是唯一**无 2-attempt 重试循环**的（单次失败直接兜底），系有意为之——超时已放宽到 60s，且失败路径是「转手填表」而非「必须成功」。

### 外部依赖已到位（存在性核验，未触发付费调用）

- SDK 已安装：`web/node_modules/@openai/codex-sdk/package.json` 存在，version `0.142.5`，与 `web/package.json` 声明的 `^0.142.5` 一致。
- 凭证通道：`new Codex()` 未传 apiKey（`agent.ts:64`），按 `reference/codex-sdk-facts.md` SDK 默认自动读本机 `codex login` 凭证；本机 `~/.codex/auth.json` **存在**（仅核验文件存在，未打印任何 token 值）。故运行时凭证链具备（登录态是否未过期未真调验证，属残量）。
- 超时定制：`EXTRACT_TIMEOUT_MS = 60_000`（`agent.ts:60`），注释说明 spec 要求 30s 但实测裸调约 27.5s、30s 近必超时，故放宽。经 `runCodexTurn('agentReply', 60_000, …)`（`timeouts.ts:54`）驱动——注意首参 `'agentReply'` 只用于日志/错误标签（`JOB_TIMEOUT_MS.agentReply=180_000` 未被使用），实际生效的是显式传入的 60_000，非配置表值。设计一致，无 bug。

### git 成熟度证据

- 唯一实质提交 `df1ce85`（2026-07-04 15:19）：`feat: agent silent-extract — chat message auto-fills the brief (B4)`。
- commit body（WHY 三要素完整）明确：为 Max 电商漏斗「wow 前最小摩擦」把「完整对话 Agent 面板」重切为「生成前静默抽取器、重对话后移到定金后段」；此前 Chat 栏是「disabled shell，自然语言到表单无路径」；本次一次 Codex 调用抽取仅用户明说字段并合并进 brief。**并声明已验证幻觉护栏（vague input patches nothing）与 60s 超时来由（裸调实测 27.5s）**。
- 这是重锚定后**专为工作台补建**的能力，晚于 legacy 冻结，非遗留代码。commit message 自述含验证结论（虽为提交者自述、非本轮独立复现，但与代码校验层逻辑一致互证）。

### 测试盘点

- `web/tests/` 下仅 `timeoutQueue.test.mjs` 一个测试，`grep` 确认**零引用 extract**（不覆盖本能力）。extract agent 无专属自动化测试。
- 无 `experiments/` 产物可作端到端证据——extract 是纯文本 agent，不落盘产物（`find` 命中的 `*extract*` 均为无关 scipy venv 文件），符合其性质，此项对该能力不适用。

### 未爬到顶的残量（诚实标注）

- **抽取质量本身未真调验证**：判定「能跑」基于——活跃链路端到端无断点、依赖+凭证到位、校验层强约束（白名单丢弃非法值）、失败兜底不阻塞表单，均为代码层可坐实的硬证据；加 git commit 自述的幻觉护栏验证。
- 唯一未覆盖的一档 = 真发一句自然语言、真调一次 Codex、观察 species slug 映射/trait chip 映射/vague-input-不落表的实际输出。此档因**红线禁止真调付费 LLM API** 而不可自动化爬升，非「能爬没爬」。这一档若要爬，需用户授权一次真实 Codex 调用（成本极低但触及付费通道边界）。
- 结论不因此降级：即便抽取质量偶有偏差，校验层白名单 + 失败兜底保证「最坏情况 = 少落几个字段或转手填表」，不会污染表单或阻塞流程——「能跑」的判据（可达、闭合、不阻塞）已被硬证据满足。

---

## 一句话结论

extract agent 是五件套里**唯一长在当前工作台主干、且端到端可达闭合**的 agent：前端→路由→agent→回填全链无断点，SDK+凭证到位，校验层强约束落实「不编造」，失败兜底不阻塞表单，git 显示为重锚定后专建并附验证自述。判**能跑**。唯一残量（真调 Codex 看抽取质量）受「不真调付费 API」红线所限不可自动化爬升，已诚实标注。
