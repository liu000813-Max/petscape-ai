# PetScape 黑客松外层目录盘点

范围：`<USER_HOME>/Desktop/0-workspace/成熟项目族/PetScape黑客松/` 第一层（不进入 `current/PetScape-final` 内部；只读，无写操作）。

## 1. 外层第一层完整清单

| 路径 | 大小 (du -sh) | 身份 / 产生时间 | 当前角色 |
|---|---|---|---|
| `AGENTS.md` | — | 符号链接 → `CLAUDE.md` | 兼容指针 |
| `CLAUDE.md` | — | 2026-07-12 项目层指令 | 治理规则（已知，主控已读） |
| `README.md` | — | 2026-07-12 22:32 更新 | 项目簇导览，含研究报告链接 |
| `business/` | 165M | 融资 BP + 路演生产工作区 | 独立仓库(pointer repo, 2026-07-08 建) + 非仓库素材(`sources/`) |
| `current/` | 4.1G | 只含 `PetScape-final`（黑客松基线仓库，任务范围外） | 当前基线 |
| `evidence/` | 144M | Claude 会话 JSONL/日志证据（2026-07-04 产生） | 追溯用，非真相源 |
| `legacy/` | 9.1G | `3D宠物打印` 老仓库（第一天独立开发线，2026-07-02~07-04 主提交） | 只读骨架来源，被 `current/PetScape-final/CLAUDE.md` 引用 |
| `早期方案/` | 462M | `误闯天家队-音频震动方向原型`，独立仓库，2026-07-02 单次提交 | 早期探索原型，与当前 3D 打印方向平行/已弃 |
| `设计验证/` | 900K | `depth-2d-to-3d-visualizer`，纯静态 HTML+vendor JS 验证产物 | 非仓库，一次性验证工件 |
| `素材/` | **144G** | `2026-07-07-采访多机位原始素材`，67 文件 | **无第二份备份，禁止移动/删除/压缩** |

顶层总量 ≈ 158.6G（其中 144G 是素材，其余合计约 14.6G）。

## 2 & 3. Git 仓库 + Worktree 排查

`find . -maxdepth 4 -name ".git"` 命中 4 个独立仓库（均为目录而非 worktree gitlink 文件，即它们本身都是主仓库）：

```
./business/roadshow-production/.git      -> directory
./legacy/3D宠物打印/.git                  -> directory
./current/PetScape-final/.git             -> directory (任务范围声明为"已单独盘点"，仍纳入路径依赖排查)
./早期方案/误闯天家队-音频震动方向原型/.git -> directory
```

逐个 `branch / status --porcelain / remote -v / worktree list`：

**business/roadshow-production**
- 分支 `main`；未提交变更 **3 行**（`M .gitignore`，`?? bp-tech-pages/`，`?? projects/` 均为未跟踪目录，非仅文件）
- 无 remote（纯本地仓库）
- `git worktree list`：只有自身一条，无外部 worktree
- 最后提交：`0103825 2026-07-08 13:07:29 chore: initialize BP workspace as pointer repo`
- `bp-tech-pages/`(57M) 与 `projects/`(5.8M) 未跟踪但已是 BP README 中声明的"当前真相源"目录——即**存在未提交的重要内容**，迁移前需先决定是否 commit。

**legacy/3D宠物打印**
- 分支 `main`；未提交变更 **14 行**（多个 `experiments/fidelity-test*/` 脚本被改动 + `web/next-env.d.ts` + 两个未跟踪路径：`experiments/tripo-asset-demo/` 目录、`max最新版的PRD.docx` 文件）
- remote: `origin https://github.com/AlfredGuquan/petscape.git`
- `git worktree list`：**6 个内部 worktree**，全部在自身路径下 `.claude/worktrees/agent-*`（5个）+ `laughing-taussig-07b518`（detached HEAD），均指向仓库内部子路径，**无外部悬挂**
- 最后提交：`69195a0 2026-07-04 17:30:49`

**current/PetScape-final**（任务范围外，仅作路径依赖/worktree 校验）
- 分支 `main`；未提交变更 1 行（`M web/next-env.d.ts`）
- remote: `origin https://github.com/AlfredGuquan/petscape-final.git`
- `git worktree list`：**3 个 worktree 指向仓库外部路径** `~/.codex/worktrees/{30df,3a95,99f7}/PetScape-final`（其中 1 个在分支 `codex/pet-avatar-dropzone`，2 个 detached HEAD）——这是**外部对 current/PetScape-final 的反向引用**，说明该仓库当前仍被 codex CLI 的 worktree 机制主动占用，移动/重命名 `current/PetScape-final` 会直接破坏这些 worktree 的 gitdir 指针。

**早期方案/误闯天家队-音频震动方向原型**
- 分支 `main`；无未提交内容（status 空）
- 无 remote
- 无 worktree（仅自身）
- 单次提交：`f529849 2026-07-02 22:32:52`

## 4. 路径依赖排查

`grep -rlE` 匹配 `.sh/.mjs/.py/.json/.js/.ts`，查找兄弟目录或绝对路径引用（排除 node_modules/.git）：

- **10 个命中，全部在 `legacy/3D宠物打印` 内部**（`experiments/fidelity-test*/*.mjs`），均是脚本里硬编码的**自指绝对路径**（形如 `const ENV_PATH = '<USER_HOME>/Desktop/.../legacy/3D宠物打印/.env'`），即脚本引用自己所在仓库的绝对路径，**不是跨目录依赖**，但意味着若整个 `legacy/` 或其父目录被重命名/迁移，这些实验脚本会全部失效（低优先级——是废弃实验脚本，非活跃路径）。
- `current/PetScape-final` 内对外层的反向引用：grep 命中 3 个文件（`CLAUDE.md`, `docs/decisions/0005-object-storage.md`, `docs/operations/phase-b-step-0-cloud-resources.md`），复核后：
  - `CLAUDE.md:58` 唯一真实的兄弟目录引用：`` `../../legacy/3D宠物打印` 是本仓库的骨架来源（只读参考）``——**纯文档说明，非可执行代码路径**，但确认了 `current/PetScape-final` 对 `legacy/3D宠物打印` 存在文档层面的相对路径假设（`../../legacy` 相对于 `current/PetScape-final/` 即 `PetScape黑客松/legacy`，目录层级重排会使这句话失真，需要人工同步更新，非自动化风险）。
  - 另外两个文件命中的是 `orders/evidence/`（业务域内订单证据子目录名，与外层 `evidence/` 目录无关）——**误报，排除**。
- 未发现任何仓库脚本对 `素材/`、`business/`、`早期方案/`、`设计验证/`、`evidence/` 的可执行路径引用。

风险点小结：**2 处**值得记录——(a) `current/PetScape-final` 的 3 个外部 codex worktree 指针（会直接破坏，非文档层面）；(b) `CLAUDE.md` 里 1 处对 `../../legacy` 的文档性相对路径描述（迁移后需人工更新，不会造成运行时故障）。`legacy` 内部 10 处脚本自指绝对路径不计入风险（废弃实验代码，且是自指非跨目录）。

## 5. .env / 密钥文件排查

外层 `find -iname ".env*" -o -iname "*secret*" -o -iname "*credential*" -o -iname "*.pem" -o -iname "*apikey*"` 命中：

| 路径 | 键名（仅列名，未读值） |
|---|---|
| `legacy/3D宠物打印/.env` | `MESHY_API_KEY`, `TRIPO_API_KEY`, `FAL_KEY` |
| `current/PetScape-final/.env` | `MESHY_API_KEY`, `FAL_KEY`, `TRIPO_API_KEY`, `TRIPO_API_KEY_2`, `ALIBABA_CLOUD_*`(14个：REGION/VPC_ID/VSWITCH_ID/ECS_INSTANCE_ID/ECS_PRIVATE_IP/ECS_PUBLIC_IP/OSS_BUCKET/OSS_ENDPOINT/OSS_INTERNAL_ENDPOINT/ACCESS_KEY_ID/ACCESS_KEY_SECRET/RDS_INSTANCE_ID/RDS_HOST/RDS_PORT/RDS_DATABASE/RDS_USERNAME/RDS_PASSWORD) |
| `legacy/3D宠物打印/.claude/worktrees/agent-{a73d17c540e0399c8,a4a0ade8cc87bf36c,aaf7321262c1b2e8f,ae5f0c37cd433859e}/.env`（4份） | 各含 `MESHY_API_KEY`, `TRIPO_API_KEY`, `FAL_KEY`（worktree 各自独立副本，内容应与主仓库 `.env` 同源） |
| `business/roadshow-production/.claude/skills/ppt-master/.env.example` | 空（模板文件，无实际键值） |

未发现 `.pem`、独立 credential/secret 命名文件散落在仓库外层（即 `早期方案/`、`素材/`、`设计验证/`、`evidence/` 三层内无任何密钥文件）。

## 6. 144GB 素材构成

路径：`素材/2026-07-07-采访多机位原始素材/`，第一层 7 个子目录：

| 子目录 | 大小 |
|---|---|
| `采访全景` | 76G |
| `嘉宾中近景` | 64G |
| `女嘉宾1录音备份` | 1.2G |
| `女嘉宾2录音备份` | 1.2G |
| `男嘉宾1录音备份` | 924M |
| `男嘉宾2录音备份` | 924M |
| `主持人特写` | **8.0K**（异常——仅含 `CLIP/20260707_Gem.7264M01.XML`、`20260707_Gem.7263M01.XML` 两个相机元数据 XML，**无实际视频/音频文件**，疑似该机位素材未拷贝完整或原始卡内容缺失） |

合计约 144G（README 声明"67 个文件，约 144 GB"）。**"主持人特写"目录很可能是不完整/缺失素材，而非仅仅体积小——迁移方案制定前建议向用户确认此目录是否本应有更多内容**（这是唯一超出"只盘点"范围的判断性提示，标注为待用户确认而非结论）。

## 7. 各第一层目录与 `current/PetScape-final` 的关系

| 目录 | 关系类型 | 证据 |
|---|---|---|
| `legacy/3D宠物打印` | 被文档引用（骨架来源，只读参考） | `current/PetScape-final/CLAUDE.md:58` |
| `business/` | 独立史料，未见 current 仓库引用 | grep 无命中 |
| `evidence/` | 独立史料（会话证据），`evidence/sessions/README.md` 提到"如结论与当前 current/PetScape-final 文档冲突，以 current 为准"，是文档层面的从属声明，非路径/代码引用 | Read 输出 |
| `素材/` | 独立史料，无引用 | grep 无命中 |
| `早期方案/` | 独立史料，无引用 | grep 无命中 |
| `设计验证/` | 独立史料，无引用 | grep 无命中 |
| `current/PetScape-final` 自身 | 被外部反向引用：3 个 codex worktree 挂在 `~/.codex/worktrees/*`；Desktop 根有 1 个兼容符号链接 `~/Desktop/PetScape-final -> .../current/PetScape-final` | `git worktree list` 输出；`ls -la <USER_HOME>/Desktop` |
| `legacy/3D宠物打印` 自身 | Desktop 根有 1 个兼容符号链接 `~/Desktop/3D宠物打印 -> .../legacy/3D宠物打印` | 同上 |

## 未验证 / 盲区

- 未逐一读取 6 个 legacy worktree 和 3 个 codex worktree 内部改动内容细节（只确认了存在性和分支/HEAD 状态，未读 diff）。
- 未检查 `~/.codex/worktrees/*` 之外，是否还有其他外部工具（如 IDE、CI）对本目录树的路径缓存/书签引用（超出"外层目录 grep"范围，需要更广的系统级搜索才能穷尽，未做）。
- README 提到"旧 handoff ZIP 已确认完成临时传输并删除"——未去验证该删除的真实性（信任 README 陈述，未独立核实，因为 ZIP 已不存在，无法验证"确认删除"这个历史事实本身）。
- `素材/主持人特写` 内容缺失是否为用户已知情况，未与用户确认，仅作为观察列出。
