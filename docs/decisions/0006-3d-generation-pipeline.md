# ADR-0006：3D 生成管线首版选型

- 状态：Accepted（2026-07-21 用户终审通过；图像引擎按终审修订记由 fal 修订为云雾 API）
- 决定日期：2026-07-21
- 适用阶段：P0 批次 3（生成链合流）起

## 背景

正式交易链（viewer 确认→报价→支付→订单）已在批次 2 落地，但其输入仍是 `temporary_catalog` 测试资产。产品核心路径「效果图 → 单物品 → 3D 模型」的实现停留在 landing 原型链：进程内任务、内存项目状态、`web/public/` 产物，且 fal、Tripo、Meshy 一直标注为「原型证据，非正式长期选型」（ARCHITECTURE §2）。

生成链合流（批次 3）要把这条链迁入正式基座（持久任务 + OSS + Asset），迁移前必须回答：迁的是哪套引擎，以什么身份。

## 决定

将原型已实证的生成管线固化为**正式首版选型**：

- **图像环节（2026-07-21 终审修订）**：云雾 API（OpenAI 兼容中转，`https://yunwu.ai`）承担效果图生成、物品白底隔离与四视图生成；默认模型 `gemini-3.1-flash-image-preview`（`YUNWU_API_KEY_LOWRATE`，特价banana 分组，实测 $0.1655/图），fallback `gemini-2.5-flash-image`（`YUNWU_API_KEY`，$0.36/图）与 `gpt-image-2`（default 分组，token 计费，注意风格与 gemini 系不一致）。key 与模型为耦合配置，provider 实现按「(key, model) 组」切换。原案 fal.ai 因账号被平台锁定于 2026-07-21 废弃（用户拍板不解锁）。事实正本=`docs/plans/reference-yunwu-api-research-2026-07-21.md`。
- **3D 环节**：Tripo `multiview_to_model` 为主引擎，双 API key 级联；Meshy 为兜底引擎。级联顺序 tripo#1 → tripo#2 → meshy（沿用原型 `MESH_ENGINE='auto'` 已实证行为）。
- **收编方式**：客户端实现收编进 `packages/server/src/infra/vendors/`，密钥一律经 `infra/config` 读取；对 application 层暴露 provider 端口（接口形态在 WP-G0 contract 中定义），引擎可替换而不改业务代码——与支付 `PaymentProviderPort` 同一模式。
- **任务化**：所有生成调用以持久任务（ADR-0003）执行于 worker，外部任务号记入 `Job.vendorTaskId`；产物落 OSS（ADR-0005 前缀）并登记 Asset。
- **测试口径**：mock 资产链升级为正式测试夹具，CI 与日常回归零外部调用；真实调用只发生在批次收口 E2E 与显式验证。

「首版」含义：这是当前已实证、成本可承受的选型，不是长期独家承诺。替换或增补引擎需要新 ADR 修订，但不需要重写业务层。

## 终审修订记（2026-07-21）

- fal → 云雾的替换经四用途实测（vibe t2i/i2i、白底提取、四视图均可承接；分割 mask 无能力，由自托管 SAM 承担，见 G4s 结论）。
- 默认模型全链用 `gemini-3.1-flash-image-preview` 由用户拍板；两个首测风险经受控实验证伪为 prompt/输入问题，实现必须固化两条约束（证据=`docs/plans/assets/adr-0006-imagegen/`）：
  1. **白底提取的输入必须是选区裁剪图**（selectionBox crop），不得用全场景图+文字描述——后者粒度歧义会抓出组合体；
  2. **四视图 prompt 必须携带显式无文字硬约束**（no letters/words/labels/captions/watermarks），否则模型会在图上印视图标签，污染下游裁切。
- 云雾连接层不稳且断连仍扣费：provider 实现的幂等重试（idempotencyKey 不重复扣费）从工程要求升格为本 ADR 约束。

## 关键理由

- 该管线已有一镜到底端到端实证（2026-07 原型链，含真实付费调用），是仓库内唯一走通「图→单物品→可打印网格」的组合；重新调研会拖慢主线且边际信息有限。
- 双 key 级联与 Meshy 兜底在原型期真实吸收过 Tripo 限流/失败，可用性策略已被实践检验。
- provider 端口使「首版选型」与「业务实现」解耦，未来换引擎的成本被限制在 infra/vendors 层。
- 维持「临时选型」标注的实际效果是让已在生产路径上的引擎永远欠一笔没有正本的决策债。

## 放弃的备选

### 先重新调研 3D 生成引擎再迁移

最稳妥但阻塞批次 3 主线；原型实证已覆盖关键不确定性（质量、延迟、失败模式），剩余不确定性（长期价格、配额）不因推迟迁移而减少。

### 单引擎无兜底

实现最简，但原型期已多次遇到 Tripo 侧失败/限流；去掉兜底是主动放弃已实证的可用性。

### 抽象多引擎编排框架

为「未来 N 个引擎」预建通用编排属于当前无消费方的复杂度；端口 + 级联函数已满足首版需要。

## 边界

- 本 ADR 不覆盖切片/G-code 工具选型（ARCHITECTURE §13 第 1 项，含 AGPL 服务端边界法务确认），该决策挂「真实制作开放前」另立 ADR。
- 本 ADR 不改变「fal/Tripo/Meshy 产物需经制作与安全审核才能进入真实交易」的既有门禁。
