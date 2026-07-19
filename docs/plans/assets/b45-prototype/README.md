# B4/B5 两阶段工作台视觉探索稿（2026-07-19 用户认可）

designer 探索稿快照，**用户 2026-07-19 认可为视觉与交互定调基准**（「前端交互整体 OK，先按这种方式」）。这是定调参考，不是实现代码；正式实现以 `../../b-line-b4-b5-execution-plan.md` 的行为验收为准。

## 打开方式

GLB 受 file:// CORS 限制，必须走 http：

```bash
cd docs/plans/assets/b45-prototype && python3 -m http.server 8123
# 浏览器打开 http://localhost:8123/
# 阶段二全提示态一键入口：http://localhost:8123/stage2.html?demo=states
# 阶段一左栏「原型演示」开关可切加载失败态
```

## 定调要点

- 视觉逐值复用正式站 psx token（ink/发丝线/999px 胶囊/24-28px 圆角/玻璃拟物/Inter 300 标题），警示色沿用 pets-alert 色系 + 低饱和琥珀，米白视口底。
- 真 three.js 交互：视角立方体、等比缩放联动尺寸常显、笼舍线框实时重建、越界/碰撞实时 AABB、草稿漂移与保存态。
- `assets/` 内 GLB 是 `web/public/scene-assets/` 归一化资产的**冻结拷贝**（探索稿快照有意不随源资产漂移）。

## 开放项（实现时定，不阻塞）

1. 阶段一右栏中段留白偏大：可保留 editorial 透气感，或加一张「检视要点」卡。
2. 花枝鼠比例参照是程序化几何（形似即可），正式版建议换真模型。

## 资产事实（WP-B4-1 需处理）

`starry-hideout.norm.glb` 无材质、无法线（原型用哑光兜底色绕过）；列入首批临时资产清单前需修复，否则剔除。
