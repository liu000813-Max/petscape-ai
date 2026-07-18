# PetScape 目录结构重构方案（两层，已拍板）

状态：已拍板（2026-07-18，用户对 C 节全部按推荐：A1 暂不改名 / A2 legacy 移入 archive / A3 business commit / A4 .env 原样保留 / B1 R3 / B2 tools 归档）。经 codex gpt-5.6-sol 第二意见修订。A 层迁移已于同日执行完成，操作记录见外层 `archive/MIGRATION-2026-07-18.md`；B 层结构由 `docs/plans/phase-b-execution-plan.md` 落地。
事实依据：两份只读侦察报告（`2026-07-18-inventory-repo.md` 仓库内、`2026-07-18-inventory-outer.md` 外层，同目录）+ codex 只读复核（Next 配置、worktree 实态、符号链接、文件系统设备号）。

---

## A 层：外层 `PetScape黑客松/` 重组

### A.0 现状与问题

第一层 7 个目录：`current/`（4.1G 基线仓库）、`business/`（165M 活跃 BP 仓库）、`legacy/`（9.1G 老仓库）、`早期方案/`（462M 已弃原型仓库）、`设计验证/`（900K 一次性验证产物）、`evidence/`（144M 会话证据）、`素材/`（**144G 采访素材，无二备，红线禁动**）。

问题本质：**活跃工程（current、business）与已终结史料平铺同一层**，顶层名"黑客松"不再匹配定位。

迁移敏感点（实测）：

1. `current/PetScape-final` 有 3 个外部 codex worktree 挂 `~/.codex/worktrees/*`，移动 current 会断链 → 方案不动 current；
2. `legacy` 有 6 个内部 worktree（gitdir 绝对路径）+ 主仓 14 行未提交变更 + 多份 ignored `.env`/生成物/venv——**`git worktree remove` 会连 ignored 文件一起物理删除，"status 干净"不构成可丢弃证明**；
3. `business` 有未提交的 BP 真相源（`bp-tech-pages/` 57M、`projects/` 5.8M 未跟踪）且**无 remote**（commit 只是版本记录，不是备份）；
4. Desktop 根 2 个符号链接：`~/Desktop/PetScape-final` → current、`~/Desktop/3D宠物打印` → legacy（后者随 A2 迁移必断，需重建）；
5. `素材/主持人特写` 仅 8K 元数据 XML、无视频，疑似缺失——与本方案无关，需你确认是否本应有内容；
6. 外部剪辑工程若按绝对路径引用 `素材/`，任何上层路径变更即断链，且无法从目录内部穷尽排查。

### A.1 推荐方案 O-1：最小归拢

```
PetScape黑客松/                  # 顶层名是否改：分叉 A1
├── CLAUDE.md / AGENTS.md / README.md
├── current/PetScape-final       # 不动
├── business/                    # 不动（未提交内容单独处理：A3）
├── archive/                     # 新建：已终结史料，各保原名不合并
│   ├── evidence/
│   ├── 早期方案/
│   ├── 设计验证/
│   └── legacy/3D宠物打印/       # 是否移入：分叉 A2
└── 素材/                        # 不动（144G 红线，路径零变更）
```

**迁移事务协议**（同卷已实测同设备号，`mv` 为原子 rename，无复制）：

1. 迁移前生成清单：每个待移仓库的 HEAD/branch/`status --porcelain`/worktree 列表/ignored 关键文件（`.env`、生成物），落盘存档；
2. `legacy` 不做 `worktree remove`：停止占用进程 → 整目录原子 `mv` 入 `archive/` → 在新路径 `git worktree repair` → 逐个 worktree 核对可用；只有你明确判某 worktree 废弃才 remove（remove 前先备份其 ignored 文件）；
3. `evidence/`、`早期方案/`（干净仓库）、`设计验证/` 直接 `mv`；
4. 每次 `mv` 后立即验证（文件数/worktree/链接），失败原路改名回滚；目的地必须预先不存在；
5. 收尾同步：重建 `~/Desktop/3D宠物打印` 符号链接指向新路径；更新外层 `CLAUDE.md`/`README.md` 与 `current/PetScape-final/CLAUDE.md:58` 的 `../../legacy` 引用。

### A.2 拍板分叉

**A1 顶层是否改名 `PetScape/`**：推荐**暂不改**。收益纯观感；代价含素材绝对路径变更（外部剪辑工程引用风险不可穷尽验证），与 144G 无二备红线相邻的操作保持最大保守。你若确认无外部工程引用素材路径，改名成本一次付清（修 3 worktree + 2 符号链接 + 文档）。

**A2 `legacy/3D宠物打印` 是否移入 archive/**：推荐**移入**，但有前置——主仓 14 行未提交变更与 6 个 worktree 里的内容需要你确认身份（史料封存 or 丢弃 or 需要 commit），"最后提交在 07-04"不足以自动判定已终结。保守选项：原地不动，只收拢另外三个目录。

**A3 `business` 未提交真相源**：独立于迁移（O-1 不动 business），但建议尽快处理：commit 进仓库（含审查那条未提交的 `.gitignore` 修改），且因无 remote，真正的备份需另行安排（如加 remote 推私有仓库）。是否现在做由你定。

**A4 archive 密钥治理（新增）**：`legacy` 主仓 + 4 个 worktree 各有一份 `.env`（`MESHY_API_KEY`/`TRIPO_API_KEY`/`FAL_KEY`，与 current 根 `.env` 同族）。拍板项：这些 key 是否仍有效、是否轮换、归档时 `.env` 保留原样还是脱敏（删除属不可逆操作，需你明确确认才做）。

---

## B 层：仓库内 `PetScape-final` 重排（Step 2 工程骨架地基）

### B.0 设计原则

1. **渐进接管**（ARCHITECTURE §11："不要先机械重排所有目录，再尝试恢复功能"）：现 `web/app/` 原型原地能跑，新正式代码进新结构，Phase C 逐链路迁移；
2. **landing 定稿页物理零触碰**——但如实区分：物理不动 ≠ 不受回归影响。Next 配置（standalone 本来就要新启用）、依赖版本、Docker 构建都覆盖整站构建面，**任何方案落地后都要以首页真实启动 + production build 的浏览器行为验收**，不能以"没动文件"为完成依据；
3. **依赖方向被结构+工具共同强制**：目标分层 = 客户端/传输/应用/领域/适配器/Worker 入口（ARCHITECTURE §5）；无论哪个选项，包边界都挡不住 `../../` 深层相对导入，lint 边界规则 + CI 门禁都是必配，不是 monorepo 的替代品；
4. **双进程边界物理可见**（ADR-0001）：哪些代码进 worker 镜像必须一眼可判。

### B.1 分叉 B1：三选一

**R3（推荐）：web 原地保留 + 独立 `worker/` package + 单个共享 `packages/server`（轻 pnpm workspace）**

```
PetScape-final/
├── pnpm-workspace.yaml           # 根 workspace：web、worker、packages/*
├── web/                          # 现 Next.js app 原地不动（目录内零新增），只成为 workspace 成员
├── worker/                       # 独立 package：Worker 进程入口 + 任务 handler 装配 + 重镜像 Dockerfile
│   ├── src/main.ts
│   └── package.json              # 依赖清单物理不含 next/react
├── packages/
│   └── server/                   # 唯一共享包（server-only）：新正式代码的家
│       ├── src/
│       │   ├── application/      # 用例层
│       │   ├── domain/           # 领域规则、模块模型、契约
│       │   └── infra/
│       │       ├── config/       # ★三个进程级 schema：common / web / worker，各自启动 fail-fast
│       │       ├── db/           # Prisma client 封装 + repositories
│       │       ├── jobs/         # 任务表适配（SKIP LOCKED、租约、幂等）
│       │       └── oss/ sms/ vendors(fal|tripo|meshy)/
│       ├── prisma/               # schema + migrations + 显式 client output
│       └── package.json          # 不依赖 next/react；入口加 server-only 防线
├── tools/  tracer/  docs/  archive/  assets-3d/ ...
```

- 新正式代码全部进 `packages/server` 与 `worker/`；web 的新正式 Route Handler 薄薄一层调 `@petscape/server` 用例——web 是消费者，不是新代码的家；
- worker 依赖隔离是**物理的**（package.json 就没有 next）；镜像构建首选 `pnpm deploy`（官方支持按 package 产出独立依赖树），备选 esbuild bundle；
- 真实代价（如实列）：pnpm workspace 化会把 `web/pnpm-lock.yaml` 上移合并为根 lockfile，CI/构建脚本路径要适配——这是对 web 构建链的真实触动（但 standalone 启用本来就是 Step 2 必做的构建链变更，不是本方案额外引入）。

**R2：单 package、`web/src/` 分层、双进程入口**（v1 原推荐）

新代码进 `web/src/{application,domain,infra,worker}`。已识别的坑：① Next 在根有 `app/` 时会静默忽略 `src/app`——若选 R2 必须禁止建 `src/app` 目录（lint 挡）；② worker 镜像纯净靠 esbuild bundle Prisma 7（WASM 引擎 + adapter-pg），**未经验证**；③ worker 复用 web 的 tsconfig（DOM/JSX lib）会掩盖 Node 构建问题，需独立 `tsconfig.worker.json`。

**R1：full monorepo（`apps/web` + `apps/worker` + `packages/*`）**

`web/` 整体搬入 `apps/`，全部构建/CI/import 路径跟着动，landing 进入最大回归面；多包拆分（core/infra/contracts）对当前 1–2 人是预付复杂度。

| 判据 | R3 轻 workspace | R2 单包双入口 | R1 full monorepo |
|---|---|---|---|
| worker 依赖隔离 | 物理（package 级） | 构建期（esbuild，未验证） | 物理（package 级） |
| web 触动面 | lockfile 上移 + workspace 配置，目录零动 | 目录内新增 src/（src/app 陷阱） | 整体搬迁，最大回归面 |
| 新旧代码分界 | 最清晰（新代码物理在 packages/server） | 混在 web 内，靠目录约定 | 清晰但代价大 |
| 复杂度 | 中（workspace 但仅 3 成员） | 最低 | 最高（多包+引用配置） |
| 升级路径 | server 包可再拆多包，平移 | 可平移到 R3/R1 | 终态 |

推荐 **R3**。无论选哪个，**Step 2 第一批必须含"构建链 tracer"工作包**：在 Linux 容器里实证 Next standalone 镜像 + worker 镜像（Prisma 7 client、pg adapter、WASM 引擎、Python/切片工具层）真实可构建可启动——目前没有任何选项的构建闭环是已验证事实（codex 复核同样结论）。

### B.2 共性决定（不随 B1 变化）

1. **配置入口**：`infra/config` 拆 `common`/`web`/`worker` 三个 zod schema——Web 不因缺切片器路径拒绝启动，Worker 不依赖 Cookie/公开 URL 配置；各进程启动只校验自己的 schema，fail-fast。现有 9 处散点 Phase C 迁链路时收敛；Step 2 起 lint 禁新代码在 config 外读 `process.env`。
2. **server 代码防线**：Prisma/OSS/短信/供应商适配器入口统一加 `server-only`，防 Client Component 经共享模块把服务端依赖带进前端 bundle（lint 单向禁 import 只是半张网）。
3. **Prisma 归属与执行者**：schema/migrations 随 B1 选定位置；`prisma generate` 进构建流水线；**`migrate deploy` 的执行者（CI 步骤 / 一次性 Compose job / 专用 migration 镜像）列为 Step 2 执行文档拍板项**，不含糊塞进应用启动。
4. **版本矩阵**（Step 2 执行文档拍板项）：固定 Node/pnpm/Next/TS/Prisma/Better Auth 版本，根目录 `packageManager` + `engines` + CI frozen-lockfile。
5. **Worker 制品契约**（Step 2 执行文档拍板项）：`pnpm deploy` / esbuild bundle / external+精简 node_modules 三选一，连同 Prisma WASM、Python/PrusaSlicer 层、健康检查、SIGTERM 退租如何进镜像，由构建链 tracer 的实证结果定。
6. **`tracer/` 保留为探针区**：完成使命后移 `archive/tracers/`，不删。
7. **`tools/` 治理（拍板项 B2）**：`verify-batch0`（硬编码本机绝对路径）、`asset-gen`（含指向已不存在旧仓库的路径）移 `archive/hackathon/tools/`；`aliyun`、`demo-prep.mjs`、`bake-assets/` 保留。
8. **`docs/` 增 `plans/`**：Phase B 执行文档落点。
9. **Step 2 明确不动**（防顺手扩大）：`app/generated`+`uploads` 双关命名混淆（OSS 接管后消亡）、内存 store、mock 链路、demo-prep。

### B.3 与 Step 2 的衔接

拍板 B1 后，执行文档按选定结构写死路径，工作包序列大致为：构建链 tracer（standalone + worker 镜像实证）→ 骨架包（workspace/目录/lint 边界/三 schema 配置入口）→ Prisma 7 + RDS tracer（ADR-0002 前置条件）→ CI 门禁包 → CI/CD 部署链包。landing 行为验收（真实浏览器 + production build）作为每个触及构建链工作包的验收项。

---

## C 拍板清单

**现在拍（目录结构）**：

| # | 问题 | 推荐 |
|---|---|---|
| A1 | 顶层是否改名 `PetScape/` | 暂不改 |
| A2 | `legacy` 移入 `archive/`（前置：你确认 14 行未提交 + 6 worktree 内容身份） | 移入 |
| A3 | `business` 未提交真相源：是否现在 commit + 另行安排备份 | commit，备份待议 |
| A4 | legacy 5 份 `.env` 归档策略：原样保留 / 脱敏（不可逆，需明确确认） | 先原样，key 轮换后再议 |
| B1 | R3 轻 workspace / R2 单包 / R1 full monorepo | R3 |
| B2 | `tools/verify-batch0`、`asset-gen` 移 `archive/hackathon/tools/` | 移 |
| — | 知悉项：`素材/主持人特写` 疑似缺失（仅 8K 元数据） | 请确认 |

**Step 2 执行文档里拍（工程细节，B1 定后展开）**：版本矩阵；Worker 制品契约（依 tracer 实证）；`migrate deploy` 执行者与失败/回滚策略。
