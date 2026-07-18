# P0 批次 1 执行文档：A 线锚点闭环（A3 + A4）

状态：v1（2026-07-18，用户拍板后编写）。上游：`docs/plans/p0-kickoff-brief.md`（差额分析与开放问题）、`PRODUCT-MODULES.md`（模块正本）、`ARCHITECTURE.md` §11（DoD 三条）、`docs/governance/engineering-conventions.md`（测试分级/zod）。

## 本批次已拍板（2026-07-18，用户确认）

1. **7 月"线上"口径**：接受"临时入口跑通第一笔真实订单全链、正式域名随备案（≈07-29）切换后复验"。备案不做验收关键路径。
2. **A3 登录方式**：手机号 + 邮箱，均为验证码（OTP）登录，**不做密码**。邮箱在同模块内作后续工作包（WP-A4），不阻塞锚点闭环。
3. **生成引擎沿用**（影响后续 B 线）：B2/B4 吸收原型时沿用 fal / tripo→meshy 级联引擎组合，只迁执行环境（进程内 → 任务表+worker），不重选型。切片/模型处理仍走 ADR（R 线）。
4. **批次收窄**：首轮只跑 A 线（App 壳 + A3 + A4）拿锚点闭环；R 线（切片 ADR 调研）后台并行；B 线与 C 骨架待锚点验收后启动。
5. A4 多宠物：数据模型支持多只，UI 首版为基础增删列表。

**锚点闭环验收（批次完成定义）**：用户在真实浏览器注册登录 → 建一只宠物档案（含照片）→ 服务器重启后档案仍在 → 另一账号看不到它。

## 编排约定（增补 phase-b 版）

- phase-b 执行文档的编排约定全部沿用（证据先行、★ 包主控终审、失败两次升档、RDS 经 SSH 隧道、`tools/aliyun`）。
- merge 前用 `gh pr checks <PR> --json state,conclusion` 显式判定结论，不信 `--watch` 的 exit code。
- 执行者在独立 git worktree 工作；worktree 不含根 `.env`，需从主 checkout 复制（不提交）。
- **builder 一律 TDD**（2026-07-18 用户增补）：凡 spec 含可测行为面，builder 先提交失败测试并附**红灯输出证据**，再实现至绿灯；PR 验收材料必须含红→绿两段证据，缺红灯证据视为未按 TDD 执行。纯文档/纯视觉部分由下条 QA 证据兜底。载体：builder agent 定义已内置该契约，spec 内的验收测试清单是出题依据。
- **LLM 模拟用户 QA 验收**（2026-07-18 用户增补）：含用户可见面的包，merge 前由**非实现者**的 QA agent 以真实浏览器模拟用户完整走一遍目标流程——纯页面出全页截图，含交互的录屏视频；证据贴进 PR。视频体积：ffmpeg 压缩（720p/H.264）后 ≤10MB 直接贴 PR 评论；仍过大则 `gh release upload qa-evidence <file>` 传到仓库的 rolling release，PR 里贴资产链接（release 附件无 10MB 限制且可 CLI 自动化）。
- **spec 派发前的用户确认**（2026-07-18 用户增补）：每个 WP 闭合 spec 前，先把用户大概率想调整的决策亮给用户确认——**数据模型变更、新类型/接口、一切用户可见行为**置顶；纯机械改动（接线、重构、配置）不问，直接执行。
- **migration 串行**：本批次只有 WP-A3 动 `schema.prisma`；任何其他包不得新增 migration。
- **landing 零回归**：所有触及 `web/` 构建面的包，验收含 production build 后首页真实浏览器截图对照。新页面新增路由实现，不改 `app/page.jsx` 之外的 landing 文件；page.jsx 只做计划内最小改动（登录入口）。
- **样式边界**：新 UI 不得引入影响全局的样式重置（Tailwind preflight 污染 landing 是已知事故）；新页面样式作用域自包含。
- 原型退役划账：涉及台账部件的包，完成时更新 `docs/governance/prototype-retirement-ledger.md`。

## WP-A0 挂牌小包（本批次 kickoff PR 完成）

原型退役台账建账（`docs/governance/prototype-retirement-ledger.md`）、根 README 重写为当前仓库身份、`wp-2-5-report.md` 陈旧状态补记。验收：文档互引无断链；PR merge。

## WP-A1 正式 App 壳 + 登录/注册页首版 ★（designer 档）

正式站第一批用户界面，同时确立**登录后界面的视觉基准**（landing 是像素定稿，登录后区域此前无基准；本包产出经用户验收后即成为后续所有正式 UI 的基准）。

范围：
a. 路由骨架：`/login`（登录/注册合一，手机号验证码；邮箱入口占位禁用态）、`/account`（账户页：已绑凭证展示、退出）、受保护布局（未登录访问 → 302 `/login`）；
b. App 壳：登录后的顶部导航/布局容器（延续 landing 视觉语言：字体、色板、组件质感取自 `components/landing/styles.css` 的既有 token）；
c. `page.jsx` 最小解冻：landing 增加登录入口（右上角），登录态显示进入应用入口；
d. 本包只做 UI 与骨架，OTP 发送/校验可为桩（WP-A2 接线）；删除空目录 `web/app/lib/printability/`。

验收（机器可判 + 行为层）：
1. `pnpm lint:baseline`、三包 `tsc --noEmit`、`pnpm build` 全过；
2. production build 下真实浏览器截图：`/login`、`/account`（桩登录态）、landing 首页对照基准无视觉回归；
3. 未登录访问 `/account` 返回 302 → `/login`（curl 断言）；
4. 用户过目 UI 首版并认可为视觉基准（主控终审前置）。

## WP-A2 手机号 OTP 登录流接线 ★

范围：`/login` 接 Better Auth phone-number 插件真实流（`createAuth` 已有，`app/api/auth/[...all]` 已挂载；客户端用 better-auth 客户端 SDK 或直调 REST）：发送验证码（含倒计时/重发）、校验登录、会话持久（DB Session）、退出；`/account` 显示真实用户（手机号脱敏）；受保护布局读真实 session。开发/验收环境 `smsChannel` 用现有 `log` 通道取码，真发 PNVS 仅冒烟一次。

验收：
1. headless 浏览器脚本走通：输入手机号 → 从结构化日志取码 → 登录成功 → `/account` 显示该用户 → 退出后 302；
2. `docker compose` 重启 web 容器后原会话仍有效（Session 在 RDS）；
3. 权限清单（conventions §1）：未登录调 `/api/me` 401；伪造 session cookie 被拒；
4. PNVS 真发冒烟：真实手机收码登录一次（截图/日志为证）。

## WP-A3 宠物档案（A4 模块主体）★（测试先行：权限类）

范围：
a. `Pet` 表 migration（ownerUserId、名称、物种/品种、体型档、生活环境、特殊需求、照片 Asset 引用；软删除标记）；本批次唯一 schema 变更；
b. 应用层 `application/pets.ts`（CRUD + 所有权断言复用 `domain/ownership.ts`；zod 出入参）；`/api/v1/pets*` 薄 Route Handler；
c. 照片上传复用 WP-3.2 OSS 私有资产直传链（不落 `public/`）；
d. UI：宠物列表 + 新建/编辑表单 + 照片上传，挂在 App 壳内；表单语义参考原型 `PetCreatorSection` 的档案字段（DoD(b)：吸收的是语义不是代码，原型表单本体随 B 线退役，本包在台账记"语义已吸收"）。

验收：
1. **测试先行**：实现前提交失败的权限/持久集成测试——A 用户持 B 的 petId 读/改/删 404；未登录 401；创建后重查字段一致；照片 Asset 归属校验。实现以变绿为准（CI 一次性 PG 真跑）；
2. headless 浏览器：登录 → 建档案（含照片）→ 列表可见 → 编辑生效 → 删除消失；
3. `docker compose` 重启后档案与照片仍可访问（OSS 签名 URL）；
4. 锚点闭环行为验收（批次完成定义那四步）由用户亲手走一遍。

## WP-A4 邮箱验证码登录（A3-2，不阻塞锚点）

前置（外部依赖，需用户控制台动作，届时给最小动作清单）：开通阿里云邮件推送（DirectMail）、配置发信域名 DNS（可用 petscape3d.com，发信域名验证不依赖 ICP 备案——执行时核实）。

范围：Better Auth email-otp 插件接入；`infra/mail/` 适配器（DirectMail，经统一 config 消费凭证）；`/login` 邮箱入口启用；账户页支持已登录用户**绑定**邮箱（换绑不改 User.id，语义同 ADR-0004）；邮箱与手机号为两个独立注册入口。

验收：邮箱收码注册登录闭环（真实收件截图）；手机号老用户绑定邮箱后两种方式登录同一 User.id（集成测试断言）；未验证邮箱不可登录。

## R 线（后台并行，不占本批次开发容量）

模型处理与切片正式方案 ADR 调研（ARCHITECTURE §13 第 4 项），产出事实对比报告 + ADR 草案交用户终审。运行边界关键事实：ECS 实测仅 1.6GB 内存，切片/网格修复的执行位置（worker 容器内 / 独立执行环境 / 外部服务）是 ADR 核心问题之一。调研 brief 由主控另行下发（中性问题，不预设沿用 trimesh/PrusaSlicer）。

## 顺序与依赖

```
WP-A0（已含本 PR）
WP-A1 ★ → 用户认可视觉基准 → WP-A2 ★ → WP-A3 ★ → 锚点闭环用户验收
WP-A4 随外部依赖就绪插入（A2 后即可并行）
R 线全程后台
```

锚点闭环用户验收通过后，再定批次 2（B 线吸收 + C 骨架）范围。
