# PetScape Web

当前 Web 是 `PetScape-PRD.md` 所定义产品的黑客松基线实现。产品范围以根目录 `PetScape-PRD.md` 为准，目标系统边界以 `ARCHITECTURE.md` 为准，当前行为以 active 代码为准。

## Active 入口

- `/`：当前产品页；
- `app/api/project/**`：首页仍在使用的项目、上传、Avatar、切片和 vibe API；
- `public/mockup-assets/`：`?mock=1` 的正式最小测试夹具，由 `tests/mockFixtures.test.mjs` 锁定；
- `public/generated/`：运行时写入目录，整体不受 Git 跟踪；
- `public/demo-baselines/`：三条固定演示或历史验收证据，不参与运行时项目恢复。

旧 `/workbench`、`/scene-lab`、专用 API、Gate Job 和历史验证资料已经迁入 `../archive/hackathon/`。它们不是 active route，也不能作为当前能力说明；完整处置证据见 `../docs/governance/phase-a-inventory.md`。

## 常用命令

```bash
pnpm install
pnpm dev
pnpm test
pnpm exec tsc --noEmit
pnpm lint:baseline
pnpm build
```

`pnpm lint` 会输出全部存量问题并以非零状态退出。迁移期合并门使用 `pnpm lint:baseline`：只允许既有“文件 + 规则”错误减少，不允许新增错误桶，总上限为 17。

当前原型仍使用内存项目状态和进程内异步任务，生成产物写入 `public/generated/<projectId>/`。这些都是待迁移事实，不是新增正式代码可以复制的目标架构。
