# 批次A 离线 3D 资产生成报告 — 终态：9/9 OK（Meshy 兜底）

> **终态更新（主控，2026-07-04 晚）**：用户拍板不充值 Tripo、改用 Meshy 兜底后，agent 用 Meshy image-to-3d 单图重跑，**manifest 9/9 status=ok（engine=meshy）**，全部 raw.glb 落盘；agent 随宿主进程退出后，预览图由主控用 render_preview.py 补渲（9/9 齐），并亲自抽查质量：knit-hat 优、banana-bed 良、cheese-lounge-bed 合格（front/side 躺平属朝向问题，批次3 normalize 处理）。资产已放行给批次3/批次1b。
> 以下为 Tripo 阻塞期的历史记录（其 model_version 调查结论仍有效）：

> 生成时间：2026-07-04 · 管线：`image_to_model`（单张白底图，无四视图网格 — 07-04 改道）
> 历史结果：0/9（Tripo 阻塞期），后经 Meshy 重跑 → 9/9 ok。

## TL;DR

- **代码/管线全部打通并验证**：fal 文生图正常（4/4 装扮图已生成落盘），Tripo upload / submit / 轮询容错 / 下载逻辑就位。
- **model_version 拍板落地**：用户拍板的 `v3.1` 家族在本 Tripo 账户的 `image_to_model` enum 里**根本不存在**（每个 `v3.1*` 串返回 `code=2017 "version value is invalid"`）。**实际可用最高版本 = `v3.0-20250812`**（探针实证：该串越过版本校验、进入文件校验阶段 `code=2003`）。已按此值配置。
- **唯一阻塞 = Tripo 余额不足**：账户 `balance=10`，而单个 `image_to_model` 任务约需 20 credit，故每次 `/task` 提交都返回 `HTTP 403 code=2010 "You don't have enough credit"`。**无法生成任何 GLB，直到充值。**
- 这是账单/支付类操作，工具无法安全代办（涉及付费、不可逆对外支出），需用户介入。

## 完成标准对照（spec §5）

| 标准 | 状态 |
|---|---|
| manifest.json 存在且 ≥7/9 status=ok | ❌ 0/9 ok（Tripo 余额不足，无 task 成功） |
| 每个 ok 项 raw.glb >100KB + 预览图 | ❌ 无 GLB 产出 |
| 老仓库零改动 | ✅ 见下「老仓库状态」 |
| API 用量统计 | ✅ fal=4 次调用（成功），Tripo task=0（全部 403 拦在提交阶段，未消耗额度） |

## model_version 调查（spec §2 要求「实际用值记进报告」）

用户 07-04 拍板 `model_version=v3.1`（v3.1 家族最新 stable）。实测该账户 Tripo `image_to_model` **无 v3.1 家族**。用一个 dummy file_token 探针把「版本校验失败」与「文件校验失败」分离（版本合法时错误会推进到 `code=2003 image file is empty`）：

| 版本串 | 结果 |
|---|---|
| `v3.1` / `V3.1` / `v3.1-2025xxxx`（8 个日期变体） / `v3.1.0` / `v3.2` / `v3.5` / `v4.0` | `code=2017` BAD_VERSION |
| `v3.0` / `v3.0-2025{0825,0901,0915,0918,1001}` / `v3.0-latest` | `code=2017` BAD_VERSION |
| **`v3.0-20250812`** | **`code=2003`（版本合法，推进到文件校验）✅** |
| `v2.5-20250123` / `Turbo-v1.0-20250506` / `v2.0-20240919` | `code=2003`（合法但更旧） |

**结论**：`v3.0-20250812` 是该账户可用的最高 v3.x 版本，即老仓库 client 硬编码的同一版本。按 spec §2 fallback 条款「具体版本串以 Tripo API 接受为准」采用之。**用户如坚持要 v3.1，需在 Tripo 侧确认该账户/套餐是否已解锁 v3.1，当前 API 明确拒绝。**

## 逐资产结果

### 模块（5，优先，批次3 在等）— 全部 blocked
`cheese-lounge-bed` / `banana-bed` / `banana-layer-pad` / `hanging-climb-baskets` / `cheese-play-mat`
- 来源：V3 `public/assets/pet-products/{id}.png` 白底商品图（已 copy 到 `assets-3d/modules/{id}/source.png`）。
- upload 阶段成功（拿到 file_token）→ submit `/task` 返回 `403 code=2010` 余额不足 → 重试 1 次仍 403 → status=failed。
- 未产出 GLB。

### 装扮（4，排后）— fal 图成功，Tripo blocked
`knit-hat` / `chef-scarf` / `name-charm` / `mini-cape`
- **fal 文生图全部成功**（nano-banana，白底单物件商品摄影 prompt）：
  - knit-hat 1.10MB · chef-scarf 991KB · name-charm 759KB · mini-cape 921KB
  - 落盘 `assets-3d/wearables/{id}/source.png`
- Tripo submit 同样撞 `403 code=2010` → status=failed，未产出 GLB。

## API 用量统计（spec §5.4）

- **fal.ai nano-banana**：4 次调用，4 次成功（4 张装扮白底图，约 $0.039×4 ≈ $0.16）。
- **Tripo `/task`**：0 个任务成立（全部被 403 余额门拦在提交，**未消耗 Tripo 额度**）。上传（`/upload`）调用若干次（免费）。
- 额度纪律：单资产重试上限 1 次已执行；因 submit 即被拒，未产生任何 3D 生成消耗。

## 老仓库状态（spec §5.3）

只读参考老仓库 `<USER_HOME>/Desktop/3D宠物打印`（读 `.env` key、`web/app/lib/tripo/client.ts`、`experiments/fidelity-test/`），**未写入任何文件**。老仓库既有的未跟踪项（`experiments/tripo-asset-demo/`、`max最新版的PRD.docx`、`web/next-env.d.ts` 的 M）与本任务无关，是任务开始前的既有状态。本任务一切写入只落 `PetScape-final/`。

## 产物落盘

```
PetScape-final/assets-3d/
  manifest.json                          # 9 项，全 status=failed，含 blocker/版本/rerun 字段
  modules/{5 个 id}/source.png           # 白底商品图（copy 自 V3）
  wearables/{4 个 id}/source.png         # fal 生成的白底装扮图 ✅
PetScape-final/tools/asset-gen/
  generate.mjs                           # 驱动脚本（单图 image_to_model + 并发 + 轮询容错）
  render_preview.py                      # GLB 预览渲染（numpy 软光栅，待有 GLB 后可用）
  .venv/                                 # numpy/trimesh/PIL/scipy
  run.log / run.stdout.log               # 运行日志
```

## 解除阻塞后的一步重跑

1. **用户操作（唯一人工步）**：登录 https://platform.tripo3d.ai 为该账户充值（至少够 5 模块 + 4 装扮 = 9 个 image_to_model 任务，约 9×20=180 credit，建议留冗余）。
2. 重跑：
   ```
   cd <USER_HOME>/Desktop/PetScape-final/tools/asset-gen && node generate.mjs
   ```
   脚本会并发提交 5 模块 + 4 装扮、轮询下载 GLB。装扮图会被重新 fal 生成一次（无害，成本约 $0.16）；如要省这次可改脚本跳过已存在的 `source.png`。
3. GLB 就绪后渲染预览：对每个 `raw.glb` 跑
   ```
   .venv/bin/python render_preview.py <raw.glb> <preview.png> <label>
   ```
   （可在 generate.mjs 末尾接一段 spawn 自动化，当前未接，因无 GLB 可测。）

## 已尝试的工具路径（为何需人工兜底）

- ✅ 换 fal 通道验证生图链路 → 通，排除 fal 侧问题。
- ✅ 探针分离版本校验 vs 额度门 → 确证代码正确、版本串正确，阻塞纯粹在余额。
- ✅ 查 Tripo `/user/balance` → `balance:10`，坐实余额不足。
- ❌ 充值：付费、不可逆、对外支出，工具不可安全代办 → 交用户。用户只需充值这一个最小动作，其余全自动。
