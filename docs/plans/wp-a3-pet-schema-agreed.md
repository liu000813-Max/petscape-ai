# A4 宠物档案字段与数据关系决策

状态：已拍板（2026-07-19）。文件名沿用早期计划中的 `wp-a3` 历史命名；实际归属产品模块 A4、工作包 WP-A4-1。

## 1. 领域边界

Pet 是用户长期维护的设计输入档案，不是医疗档案、社交主页或某个 Project 的临时副本。一个 User 可以拥有多只 Pet；首版一个 Pet 只保留一张封面照片。

Asset 的权限根是 User。Pet 和后续 Project 只引用 Asset，不取得 Asset 所有权；Pet 软删除后，照片仍属于用户且不随 Pet 删除。后续 B1 中一个 Project 必须且只能关联一只 Pet（`Pet 1:N Project`，`Project.petId` 非空），项目编辑期读取 Pet 当前档案，生成任务保存当次输入快照。

## 2. 首版字段

| 字段 | 数据库/契约类型 | 约束与用途 |
|---|---|---|
| `name` | `String` | 唯一必填；trim 后 1–80 字符 |
| `speciesCode` | enum / nullable | `rat`、`gecko`、`snake`、`parrot`、`spider`、`other`；稳定代码用于筛选和后续设计规则 |
| `customSpeciesName` | `String?` | 仅 `speciesCode=other` 时允许且必填；最多 120 字符 |
| `breed` | `String?` | 品种或品系；最多 120 字符 |
| `sizeLevel` | `Int?` | 1–5 的粗粒度体型档；用于早期推荐和筛选，不伪装成精确尺寸 |
| `lifeStage` | enum / nullable | `juvenile`、`adult`、`senior`、`unknown`；可能影响入口、坡度、活动空间等设计建议 |
| `behaviorTraits` | `String[]` | 最多 20 项、单项最多 40 字符、去重；记录会影响设计的稳定行为特征 |
| `environmentNotes` | `String?` | 最多 2000 字符；长期环境偏好与约束 |
| `specialNeeds` | `String?` | 最多 2000 字符；会影响设计的长期特殊需求，不作医疗诊断 |
| `coverAssetId` | `String?` | 当前用户拥有、已确认、`kind=pet_cover` 的 JPEG/PNG/WebP；单封面引用 |
| `deletedAt` | `DateTime?` | 软删除标记；默认查询排除已删除档案 |

所有公开 DTO 使用 ISO 8601 字符串表达 `createdAt`/`updatedAt`，不暴露 `ownerUserId`、`deletedAt`、`ossKey` 或 Asset 内部状态。

## 3. 有意不在首版固化的字段

- 出生日期、精确年龄、体重、身长等会随时间变化的数据暂不进入长期档案。后续设计模块确认计算用途后，应建带采集时间和单位的 measurement/snapshot，而不是不断覆盖一个无时间语义的数值。
- “性格”不设自由文本大字段；首版用可多选的 `behaviorTraits` 与环境/特殊需求备注承载真正会影响设计的信息。
- 医疗记录、过敏史、社交资料、多照片图库、Project 工作副本和生成供应商响应均不属于本工作包。

这不是永久排除：当 B2/B5 的设计规则能够明确回答“字段如何改变设计或安全判断”时，再以新 migration 增加，避免现在过度精简，也避免为未知用途提前固化错误类型。

## 4. API contracts 与错误语义

运行时契约正本是 `packages/server/src/contracts/pets.ts`，TypeScript DTO 从 Zod Schema 推导。必要端点：

- `POST /api/v1/pets`：创建；`GET /api/v1/pets`：当前用户列表。
- `GET/PATCH/DELETE /api/v1/pets/:id`：读取、编辑、软删除。
- `POST /api/v1/pets/:id/cover-upload`：为现存 Pet 创建 User-owned pending Asset 和短期 PUT URL；上传完成后复用既有 Asset confirm，再 PATCH `coverAssetId`。

Route Handler 对 JSON、path params 和 request shape 做 Zod 校验，并在输出前 parse 成功 DTO / 错误 envelope。非法 JSON 或 shape 返回 400；未登录返回 401；不存在、已软删除或非 owner 的 Pet/Asset 统一返回 404，避免泄漏资源存在性；无效封面返回结构化 400。服务器异常不伪装成业务错误。

## 5. 数据完整性与后续边界

- 数据库保留 `sizeLevel` 范围和 `other/customSpeciesName` 一致性 CHECK，防止绕过 API 的写入破坏核心不变量。
- `Asset.projectId` 变为 nullable，Project 删除对该引用使用 `SET NULL`；Asset 的授权始终只看 `ownerUserId`。
- Pet 的单封面关系不是图库。替换封面只改变引用，旧 Asset 仍归用户；孤立/长期 pending Asset 的生命周期由统一资产治理处理，不在 A4 中偷偷删除。
- B1 不复制 Pet 字段；生成、确认、报价和订单在各自边界保存不可变输入快照。
