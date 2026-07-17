# Web V1 Phase 1 风险验证报告

> 日期：2026-07-16
>
> 结论：`PASS WITH BOUNDED PHYSICAL RISK`
>
> 本报告是阶段一结论的持久摘要。完整实验产物位于 `/tmp/petscape-phase1/`，大型 GLB/STL/G-code 不纳入普通源码提交。

## 1. 验证目标

用真实、非 mock 证据验证两条链：

1. 2D 场景中选中的原创躲避屋能否形成可识别、可追溯的 3D 候选。
2. 该 3D 候选能否经过修复、归一化和真实切片，形成制造候选。

验收时严格区分：`3D candidate generated`、`sliceable`、`physically printed`、`production approved` 和 `pet safe`。

## 2. Gate A：2D selection → 3D candidate

结论：`PASS`。

| 证据 | 结果 |
|---|---|
| 2D source SHA-256 | `09b03d682b8c9c408eee7b8e187e8d0a092260274674c13fd77ac34f32ac03a5` |
| selection | 已保存与源图 hash/尺寸绑定的 bbox、polygon、mask 和 overlay |
| 实际 provider input SHA-256 | `cb0bfb6262e54a09afe32d009582f717d179cb0eebb8d693ef3cd341fbc12a24` |
| provider | Meshy image-to-3D，真实非 mock task `019f2849-8f78-76dd-a138-39d5608de7c7` |
| provider result | `SUCCEEDED`，progress 100，消耗 30 credits |
| raw candidate SHA-256 | `6f182cca9901ccb786687d248897c69b4fe9ca401e19a31df51c10b5a1297ff4` |
| 本地重开 | Blender 5.1.2 成功：1 mesh、68,225 vertices、99,531 polygons |

视觉复核确认：蓝色坡屋顶、木屋主体、大入口和躲避屋用途可识别；滚轮、桥、动物、木隧道和垫料没有主导 3D 候选。

保留边界：

- 历史 scene → clean provider input 的清理变换没有被记录，不能字节级重放。
- 源图只有正面三分之四视角，模型背面和部分内部结构属于生成推断。
- 源图是 hamster 场景，不证明 fancy rat 的内容、尺寸或安全。
- 当前 Meshy balance probe 返回 HTTP 200；历史 task 因过期返回 404，本地结果已归档。

## 3. Gate B：3D candidate → manufacturing candidate

结论：`PASS WITH BOUNDED PHYSICAL RISK`。

原始 Gate A candidate 不能直接作为制造网格：

- 127 个 connected components；
- 234 条 boundary edges；
- 129 条 non-manifold edges；
- `watertight=false`。

使用同一真实作业中已成功的 Meshy print-repair task `019f284c-d72a-7cd3-bf9f-909bc89fd537` 后，再进行可追溯归一化和切片：

| 证据 | 结果 |
|---|---|
| repaired GLB SHA-256 | `9d138586dff2d0eb0862ec1459238fbe96092139632986358c8c2420505e34c6` |
| final STL SHA-256 | `2a70b12ba07f97984b4c4296bdeaed9deb51bd93041e77382a69dcd30f84848f` |
| final mesh | 1 component、0 boundary edges、0 non-manifold edges、manifold/watertight |
| test envelope | 120.000 × 74.264 × 97.793 mm；仅为 Spike 输入，不是产品默认 |
| slicer | PrusaSlicer 2.9.6，真实本地执行 |
| G-code SHA-256 | `2c3c36ea83d301fb8bcb174c546e8ffb650bcfc1cfadc8d4bf4dc377f7500fa6` |
| G-code | 20,946,997 bytes，包含真实移动/挤出和结束指令 |
| 估算 | PLA 219.71 g；正常模式约 15h 8m 50s；supports enabled |

制造风险没有被自动修复掩盖：

- 22.475% 表面积命中 45° overhang 风险 proxy；
- 1,000 个 wall-thickness proxy hits 中 5 个低于 1 mm，14 个低于 3 mm；
- 排水、清洁、内部可达性、支撑拆除、尖锐边、强度、材料和啃咬风险需要人工/实物审核。

## 4. 实体打印边界

检查了 USB、serial、系统打印队列、常见 slicer 物理打印机配置、mDNS、当前网络邻居和有界常见 3D printer ports，没有发现可达 3D 打印机。系统中唯一队列是 C3500 办公 2D 打印机。

因此没有进行实体打印，不能声称实体成功。

当前独立状态：

- `sliceable=true`
- `physicallyPrinted=false`
- `productionApproved=false`
- `petSafe=false`

下一步实体动作是：在已知、校准的打印机上由操作员监督打印归档 G-code，记录首层、完成件、尺寸、支撑拆除、入口/内部可达性、尖锐边、强度、排水和清洗。

## 5. 独立复核

独立 verifier 没有参与 Builder A/B 产出，并重新核验了：

- source → selection → provider task → raw GLB → repaired GLB → STL → G-code 的 hash lineage；
- Blender/PrusaSlicer 重开、组件、manifold 和尺寸；
- G-code 非空、真实指令和切片摘要；
- report/manifest 状态一致，无 `AWAITING` 漂移；
- evidence 中未发现 key、Bearer secret 或签名 URL 泄漏；
- 阶段前后 repo status byte-for-byte 一致，Spike 没有污染既有 dirty worktree。

独立 verdict 为：`PASS WITH BOUNDED PHYSICAL RISK`，允许编写重构计划，不允许把结论扩大为实体、生产或宠物安全批准。

## 6. 对重构计划的约束

后续实施必须：

1. 保存 source version、selection/mask、cleanup recipe、provider input 和输出 artifacts 的 durable lineage。
2. 把 provider 任务设计为可恢复、可重试且保留成本/失败记录。
3. 把 raw candidate、repaired candidate、sliceable candidate、physical validation、production approval 和 pet safety 分成独立门禁。
4. 先支持一个 fancy-rat 原创躲避屋，不把 hamster Spike 尺寸或 120 mm envelope 写成产品默认。
5. 在第一份正式报价前完成绑定 revision 的真实打印与人工审核。
