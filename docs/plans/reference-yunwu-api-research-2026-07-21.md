# 云雾 API 图像能力调研（2026-07-21）

背景：fal 账号被平台锁定（见 `p0-batch-3-execution-plan.md` 风险区），用户拍板切换生图服务商为云雾 API（国内中转）。本文是调研代理实测结论的正本，供 G3/G5 spec 与 ADR-0006 终审引用。产物图与逐笔记账在调研 session scratchpad（`yunwu-research/`，7 张产物图）；本次调研花费 $3.77。

## 工程接入事实（全部实测）

- Base URL：`https://yunwu.ai`（`api.yunwu.ai` 亦通）；鉴权 `Authorization: Bearer sk-...`；OpenAI 兼容（new-api 系中转）。key 在项目根 `.env` `YUNWU_API_KEY`。
- gemini 系图像模型走 `/v1/chat/completions`，产物内嵌于 content 的 markdown `![image](data:image/png;base64,...)`，需正则抽取，PNG 带 C2PA 水印元数据；gpt-image 系走 `/v1/images/generations` 标准 `b64_json`。
- 计费：gemini 图像模型按次计费，实扣 = 标价 × key 分组倍率（本 key **2.4**，扣费差值实测定标）。定价表免鉴权：`GET https://yunwu.ai/api/pricing`。余额/用量：`/v1/dashboard/billing/usage`。
- 实测坑：
  1. **连接层不稳**：响应中途断连需重试，且**断连仍扣费**——provider 实现必须幂等重试（与 g-line G3 TDD 的 idempotencyKey 要求吻合）。
  2. **图像模型不可探活**：发一句文本也按整图扣费（$0.36）。
  3. `/v1/models` 不含 gemini 系但实际可调；可用性以 `/api/pricing` + 实调为准。
  4. 无 `nano-banana` 别名，用正式名 `gemini-2.5-flash-image`；`-preview`/`nano-banana-2` 无渠道。
  5. images/edits 上传图需 <4MB .png（文档口径）。

## 四用途结论

| 用途 | 结论 | 模型/端点 | 实测 |
|---|---|---|---|
| vibe 效果图 t2i/i2i | **可承接** | `gemini-2.5-flash-image` @ chat/completions | t2i 8.0s、i2i 31.1s，1024×1024，质量达标 |
| 白底隔离提取 | **可承接** | 同上，指令式提取 | 37.8s 一次通过，复杂笼内场景抠取质量高 |
| 物品级分割 mask | **不可承接** | 无 SAM 类模型（全目录检索证实） | — |
| 四视图（单图 2×2） | **可承接** | 同上 | 12.7s 一次通过，四格一致性好；back/side 靠模型脑补（与 fal 同源局限） |

备选：`gpt-image-1` low 档 $0.066/图（token 计费），可做草稿/占位，风格与 nano-banana 系不一致。

## 成本红旗（已闭环，2026-07-21 当日）

本 key（`YUNWU_API_KEY`，default 分组倍率 2.4）→ gemini-2.5-flash-image 实价 **$0.36/图 ≈ Google 官方（$0.039）的 9 倍**。fal 已废弃（账号锁定，用户拍板不解锁），云雾为唯一图像供应商。

**低倍率令牌已建并实测**（`YUNWU_API_KEY_LOWRATE`，名 petscape-lowrate，绑「特价banana」倍率 1.0，无限额度永不过期）：
- 本账户可选分组 33 个（全表存于 token session scratchpad `self-groups.json`）；图像相关低倍率仅「特价banana」。
- **模型耦合事实**：「特价banana」仅含 `gemini-3.1-flash-image-preview`（$0.1655/图）与 `gemini-3-pro-image-preview`（$0.33/图）；`gemini-2.5-flash-image` 本账户只有 2.4 倍率——**换低价必须同时换新一代模型**。
- 实测：一次真实调用 22.1s，账户 quota 差值与新 key usage 双口径一致 = $0.1655/图（省 54%）；样张 2048×2048 质量佳。
- 遗留决策：默认模型（2.5@$0.36 vs 3.1-preview@$0.1655）随 ADR-0006 终审定，G3 provider 实现应把 key+model 作为一组配置切换。

## 未验证边界

并发限流上限、低倍率分组的可开通性、`gemini-3-pro-image-preview` 出图质量（仅探活）。
