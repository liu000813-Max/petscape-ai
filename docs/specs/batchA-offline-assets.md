# 批次A Spec：离线生成 3D 资产（4 装扮 + 5 热门模块 GLB）

> 上游依据：`../integration-mapping.md` grilling #3/#7。与批次0 并行，产物供批次1b（装扮挂载）与批次3（环境预览）消费。
> **真调付费 API（fal + Tripo），已获用户授权。**

## 1. 任务

用项目已验证的「图→四视图网格→裁切→Tripo 图生3D」管线，离线生成 9 个 GLB 资产：V3 前端的 4 件装扮 + 5 个热门标品模块，产物落盘并附渲染预览图供人工挑质量。

## 2. 输入

- **装扮清单（4 件）**：从 `<USER_HOME>/Desktop/设计师前端页面/src/main.jsx` 的 `wearableItems` 数组取真实 id/名称/描述。装扮无商品图 → 先 fal 文生图（白底、单物件、商品摄影风格、居中）再进管线。
- **模块清单（5 个）**：**按 V3 页面展示顺序取前 5 个模块**（`modules` 数组序：奶酪软垫小床、香蕉软垫小床、夹层香蕉垫……以数组实际前 5 为准）。已有白底商品图（`public/assets/`）。
- **管线（2026-07-04 用户改道拍板）**：**放弃四视图网格，直接单图调 Tripo image-to-model**——白底商品图一步转 3D。**并发提交、并发轮询**（Tripo 任务级并发，5 模块同时在跑；轮询容错沿用 client 模式）。装扮仍需先 fal 文生图再单图转，排在模块之后。
- **model_version = `v3.1`（2026-07-04 用户拍板升级）**：不再用老仓库 client 硬编码的 `v3.0-20250812`；提交 body 里显式传 v3.1（具体版本串以 Tripo API 接受为准，v3.1 家族最新 stable）。旧四视图中间产物（assets-3d/modules/ 下旧 top5 目录的 grid/views png）作废可清。
  - 实测追记：v3.1 在本账户 enum 不存在（code=2017），可用最高 = v3.0-20250812。
- **引擎兜底 = Meshy（2026-07-04 用户拍板）**：Tripo 余额耗尽（2010）且不充值，改用 **Meshy image-to-3d 单图**跑同一管线。参考老仓库 `web/app/lib/meshy/client.ts`（submitImageTo3d/getImageTo3d/pollTask/glbUrlFrom，M 系验收通过的实现）与 `experiments/meshy-test*/`；`MESHY_API_KEY` 在老仓库 `.env`。manifest 记录 engine=meshy。Tripo 若日后充值可回切。
- **参考（老仓库只读）**：`<USER_HOME>/Desktop/3D宠物打印` —— API key 在根 `.env`；单图 image-to-model 的已验证参考在 `experiments/fidelity-test/`（single 配置）与 `web/app/lib/tripo/client.ts`（upload/轮询/下载，body 结构参考，不必 import TS）。

## 3. 步骤

1. 读 V3 数据，定 9 个资产清单（落盘 manifest）。
2. 写 standalone 驱动脚本于 `<USER_HOME>/Desktop/PetScape-final/tools/asset-gen/`（.mjs，参考 experiments 模式；从老仓库 `.env` 读 key，不硬编码）。
3. 逐资产执行：装扮先 fal 文生图 → （全部）fal 四视图网格 → 裁切 4 视图 → Tripo 提交/轮询 → 下载 GLB。串行跑（Tripo 轮询期间可提交下一个，最多 2 并发，防限流）。
4. 每个 GLB 出一张渲染预览图（参考老仓库 `experiments/fidelity-test-v2/` 的 python 渲染检查脚本模式，或 three.js 无头截图；实在不行用四视图源图代替并注明）。
5. 失败资产重试 1 次；仍失败则记录跳过，不阻塞其余。

## 4. 产物结构

```
PetScape-final/assets-3d/
  manifest.json            # 9 项：id/类型/名称/来源图/GLB路径/预览图路径/状态
  wearables/{id}/source.png + raw.glb + preview.png
  modules/{id}/source.png + raw.glb + preview.png
```

## 5. 完成标准

1. manifest.json 存在且 ≥7/9 项 status=ok（附每项 Tripo task 成功响应摘录）。
2. 每个 ok 项的 raw.glb 文件 >100KB（非空壳），预览图存在。
3. 老仓库零改动（`git -C <USER_HOME>/Desktop/3D宠物打印 status` 干净，除未跟踪的临时产物——临时产物也不要留在老仓库）。
4. API 用量统计：fal 调用次数 / Tripo task 数，写进报告。

## 6. 不要做

- 不改老仓库与 V3 目录的任何文件。
- 不做挂点/offset 调参（批次1b 的事）。
- 不生成 5 个以外的模块（额度纪律）。
- 单资产重试超 1 次不再烧额度。

## 7. 产出形式

- 报告：`<USER_HOME>/Desktop/PetScape-final/docs/reports/batchA-assets-report.md`（每资产：来源→各步结果→耗时；失败项附原因）。
- stdout ≤200 字：{ok 数量/9, 报告路径}。
- 未完成 → 报告顶部 `INCOMPLETE:`。

## 8. 档位

opus（涉及真实额度消耗与多 API 编排，首派即高档）。
