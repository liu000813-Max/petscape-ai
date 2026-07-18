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
- **migration 串行**：同一时间只允许一个在途工作包动 `schema.prisma`，由编排方排序（已发生：WP-A3-2 节流表；待发生：WP-A4-1 宠物表）。
- **landing 零回归**：所有触及 `web/` 构建面的包，验收含 production build 后首页真实浏览器截图对照。新页面新增路由实现，不改 `app/page.jsx` 之外的 landing 文件；page.jsx 只做计划内最小改动（登录入口）。
- **样式边界**：新 UI 不得引入影响全局的样式重置（Tailwind preflight 污染 landing 是已知事故）；新页面样式作用域自包含。
- 原型退役划账：涉及台账部件的包，完成时更新 `docs/governance/prototype-retirement-ledger.md`。

## WP-A0 挂牌小包 ✅（PR #22，2026-07-18 合并）

原型退役台账建账（`docs/governance/prototype-retirement-ledger.md`）、根 README 重写为当前仓库身份、`wp-2-5-report.md` 陈旧状态补记。验收：文档互引无断链；PR merge。

## WP-A1 正式 App 壳 + 登录/注册页首版 ★（designer 档）✅（PR #23，2026-07-18 用户认可视觉基准后合并；该版即正式站视觉基准）

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

## WP-A2 手机号 OTP 登录流接线 ★ ✅（PR #24，2026-07-18 合并；TDD 红→绿 + 独立 QA 录屏；PNVS 真机冒烟已随 WP-A3-2 S4 闭环）

范围：`/login` 接 Better Auth phone-number 插件真实流（`createAuth` 已有，`app/api/auth/[...all]` 已挂载；客户端用 better-auth 客户端 SDK 或直调 REST）：发送验证码（含倒计时/重发）、校验登录、会话持久（DB Session）、退出；`/account` 显示真实用户（手机号脱敏）；受保护布局读真实 session。开发/验收环境 `smsChannel` 用现有 `log` 通道取码，真发 PNVS 仅冒烟一次。

验收：
1. headless 浏览器脚本走通：输入手机号 → 从结构化日志取码 → 登录成功 → `/account` 显示该用户 → 退出后 302；
2. `docker compose` 重启 web 容器后原会话仍有效（Session 在 RDS）；
3. 权限清单（conventions §1）：未登录调 `/api/me` 401；伪造 session cookie 被拒；
4. PNVS 真发冒烟：真实手机收码登录一次（截图/日志为证）。

## WP-A4-1 宠物档案（A4 模块主体）★（测试先行：权限类）✅（PR #30）

> 命名更正：原编号"WP-A3"与模块编号 A3（注册登录）撞名，按 WP-A3-2 节确立的"模块号-序号"规则更正为 WP-A4-1。**前置**：Pet 字段设计讨论（独立讨论会话，产物 `docs/plans/wp-a3-pet-schema-agreed.md`——文件名沿用历史命名）收敛并经用户拍板后，方可闭合 spec 派工。

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

**WP-A2 运维事实（2026-07-18）**：Better Auth 的 CSRF Origin 校验要求 `BETTER_AUTH_URL` 与实际访问 origin 一致（缺省回落 `localhost:3000`，部署实例上已登录写操作会 403）。ECS `/opt/petscape-compose/web.env` 需含 `BETTER_AUTH_URL=http://localhost:3010`（隧道验证时本地转发端口须同为 3010）；**正式域名切换（A1 收口）时改为正式 origin**。该文件是"provision 脚本生成 + 手工追加"模式，重跑 `deploy/provision-env.sh` 会丢手工键，重跑后需复核。

## WP-A3-2 邮箱验证码登录与双向凭证绑定（模块 A3）

状态：✅ 完成（PR #26，2026-07-18 合并）。S1-S5 全过：TDD 17 用例红→绿；codex 计划审查 6 critical 全落地；独立 QA 首轮抓出"绑定占用邮箱假发送死路"阻塞项、修复后复验翻案通过（录屏与关键帧在 PR）；S4 真发双通道（DirectMail→Gmail 收件箱自动取码登录、PNVS→真机短信经 Messages 数据库自动抓码登录）证据以评论落 PR #26。

**运维事实（S4 沉淀）**：⓪**部署链不执行 migration**——`deploy.yml` 只做镜像替换，带 schema 变更的 PR 合并后现网即 P2021（本包节流表实测踩中：ECS 发码 500，已按 ADR-0002 经 SSH 隧道 `pnpm db:migrate:deploy` 补齐并复验通过）。**在部署链补上 migration 步骤之前，每个带 migration 的 PR 合并后由编排方立即手动 migrate deploy**；"migrate deploy 执行者进部署链"是目录结构方案的遗留拍板项，挂批次 2 处理。①PNVS 真发需 `PNVS_SIGN_NAME`/`PNVS_TEMPLATE_CODE`（现用系统赠送签名「<SMS_SIGN_NAME>」+ 模板 100001，见 `docs/operations/phase-b-step-0-cloud-resources.md`；根 `.env` 与 ECS `web.env` 均未配置——**真实通道上线前需补，品牌签名申请是既定用户确认项**）；②ECS 部署实例当前 SMS/MAIL 均为默认 `log` 通道，切真实通道只需补 env；③本地无 SSL 的 PG 需在 `DATABASE_URL` 显式 `sslmode=disable`（P1017 教训）。

本节原为开工 spec。取代原"WP-A4"节（工作包命名自此改为**模块号-序号**式，消除 WP 编号与模块编号撞名）。外部前置已全部就绪：DirectMail 已开通（华东1）、发信域名 `mail.petscape3d.com` 已验证、发信地址 `no-reply@mail.petscape3d.com`（触发类）已建、DNS（DKIM/SPF/DMARC/MX）已配。

**已拍板**：注册+登录+绑定都做；无密码（仅验证码）；双账户接受为独立账户+登录页文案引导（不做账户合并）；最小节流本包做；**凭证双向对称**——手机号用户可绑邮箱、邮箱用户可绑手机号，绑定后任一凭证登录为同一 User.id（ADR-0004"换绑不改 id"语义扩展到双向）。

真发验收资源：手机号 <REAL_TEST_PHONE>（短信转发至编排机 Mac，经 Messages 数据库自动抓码）；GWS 邮箱 <REAL_TEST_ACCOUNT>（Mail skill 取码）。

### 账户语义（实现前共识）

- 登录查找：邮箱 → `User.email`；手机号 → `User.phoneNumber`。绑定 = 对目标凭证完成验证码校验后写入对应字段（邮箱绑定同时把合成占位 `@phone.petscape.local` 迁移为真实邮箱，`emailVerified` 置真；手机号绑定写 `phoneNumber` + `phoneNumberVerified`）。
- 冲突（**codex 审查增补，优先于本条原文**）：冲突判定**不靠"先查后写"**——数据库唯一约束兜底，应用层捕获唯一冲突（Prisma `P2002`）映射为**结构化冲突响应**，覆盖三类竞态：邮箱占用、手机号占用、以及"新注册 vs 已有账户绑定"的交叉竞态（两账户并发抢同一凭证仅一个成功，失败方收到结构化冲突而非 500）。内联提示由前端据结构化响应渲染。
- **邮箱规范化（codex 审查增补）**：一律 `trim` + `toLowerCase` 后再入库/查找，`Foo@X.com` 与 `foo@x.com` 命中同一账户（注册/登录/绑定三入口一致）。
- `@phone.petscape.local` 占位域在**服务端全部入口**拦截（发码 / 注册 / 绑定 / changeEmail），含大小写与空白变体（先规范化再匹配后缀 `@phone.petscape.local`）；不仅前端拦截。
- 同一人分别用两种凭证从零注册 = 两个独立账户（接受）；登录页文案引导"已有账户先登录再绑定"。

### S1 DirectMail 权限探针（先于一切）

现有 `ALIBABA_CLOUD_*` 凭证经 `tools/aliyun` 真发一封测试邮件到验收邮箱。通过 → 凭证可用直接开工；权限不足 → 输出 RAM 授权最小动作交用户，S2 用 log 通道先行不阻塞。

### S2 实现（builder，TDD 红灯先行）

范围：
a. `infra/mail/` 适配器：log + directmail 双通道（照抄 `infra/sms/` 模式），config（webSchema）加 mail 键；
b. Better Auth `emailOTP` 插件接入（仅 sign-in 用途，不开 forget-password；选项以 node_modules 1.6.23 类型定义为准）；占位域拦截；
c. 绑定用例（双向）：邮箱绑定（占位迁移）与手机号绑定（phoneNumber 插件的已登录验证更新路径），唯一冲突拒绝，换绑不改 User.id；
d. 最小节流：同一目标 60s 冷却 + 单目标每日 10 次上限，**同时覆盖短信与邮件两通道**（复用 Verification 表时间戳，不新增表）；
e. UI：`/login` 邮箱入口启用（复用两步交互与视觉基准）+ 双账户引导文案；`/account` 双向绑定入口（邮箱行、手机号行按登录方式显示已绑/未绑）与冲突提示。

#### S2 codex 审查增补（2026-07-18，优先于上文 a–e 原文冲突处）

- **增补 b（原子绑定，取代"绑定用例"含糊表述）**：emailOTP 的普通 `sign-in`/`verify` **无法迁移已登录手机号用户的占位邮箱**（sign-in 会新建或切到另一个 User）。已登录用户的邮箱绑定必须走**原子迁移**：在「启用 emailOTP `changeEmail.enabled` 内置流程」与「自有应用层原子绑定用例（事务内：校验已验证 OTP → 捕获唯一冲突 → 更新 `User.email`/`emailVerified`）」中，按 1.6.23 实际能力**择一**，PR 记录选择依据。手机号绑定用 `verifyPhoneNumber({ updatePhoneNumber: true })`（1.6.23 已核实存在：`POST /phone-number/verify` body 带 `updatePhoneNumber:true`，无 session → 401，目标手机号被占 → `PHONE_NUMBER_EXIST`，原地更新不改 `User.id`）；唯一冲突同样由项目层映射为结构化响应。
- **增补 d（节流改为独立 append-only 表，取代"复用 Verification 表"）**：新建 **append-only 发送记录表**（`target`、`channel`、`sentAt`；新 migration）。事务内原子判定 **60s 冷却 + 滚动 24 小时 10 次上限**；**发送成功后才记账**（通道抛错不记账）。**不复用 Verification 表**——其记录会被验证消费（`consumeVerificationValue`），计数不可靠。
- **增补 f（OTP 存储）**：emailOTP 1.6.23 支持 `storeOTP: "hashed"`，启用之（DB 只存哈希，不影响发给用户的明文）。

TDD 出题（权限/并发类，conventions §1 照单）：同邮箱并发注册只成一个；绑定他人已占用邮箱/手机号被拒；占位域被拦；60s 内第二次发码被拒；错码/过期码无效；双向绑定前后 User.id 不变。

**TDD 追加（codex 审查增补）**：滚动 24h 内第 11 次发码被拒；并发同目标发码仅一次通过节流；正确 OTP 并发消费仅一次成功、二次重放被拒；未登录调用绑定接口 401；两账户并发绑定同一凭证仅一个成功、失败方收到结构化冲突而非 500；邮箱大小写变体（`Foo@X.com` vs `foo@x.com`）注册/登录/绑定命中同一账户。

e2e（log 通道，playwright）：①邮箱注册→登录闭环；②手机号注册→绑定邮箱→退出→邮箱登录→断言同一 User.id；③邮箱注册→绑定手机号→退出→手机号登录→断言同一 User.id。

**e2e 追加断言（codex 审查增补）**：绑定响应返回后**不退出**，当前 session 的账户页立即显示新凭证。

机器验收：TDD 红→绿两段证据；lint:baseline；三包 tsc；web build；landing 零回归截图；`docs/plans` 本节即闭合 spec，PR 附全部证据（含绑定路径与 OTP 存储选择依据）。

### S3 独立 QA（非实现者）

log 通道录屏全流程（邮箱注册/登录/双向绑定/绑定后同账户/错误态与节流拒绝），视频进 qa-evidence release、判定评论进 PR（同 WP-A2 模式）。

### S4 真发端到端（编排方执行）

1. 短信真发（PNVS）：真发到 <REAL_TEST_PHONE> → Messages 数据库自动抓码 → 登录成功（顺带闭环 WP-A2 遗留的 PNVS 真机冒烟）；
2. 邮件真发（DirectMail）：发到验收邮箱 → Mail skill 取码 → 登录成功；如实记录是否进垃圾箱（新域名+1024 位 DKIM，进垃圾箱属预期，记录不阻塞）；
3. ECS 部署实例经隧道（本地端口 3010）复验登录一次。

### S5 合并

CI（`gh pr checks --json` 显式判定）+ QA 判定 + S4 真发双通道证据齐 → merge。

## R 线（后台并行，不占本批次开发容量）

模型处理与切片正式方案 ADR 调研（ARCHITECTURE §13 第 4 项），产出事实对比报告 + ADR 草案交用户终审。运行边界关键事实：ECS 实测仅 1.6GB 内存，切片/网格修复的执行位置（worker 容器内 / 独立执行环境 / 外部服务）是 ADR 核心问题之一。调研 brief 由主控另行下发（中性问题，不预设沿用 trimesh/PrusaSlicer）。

## 顺序与依赖

```
WP-A0 ✅ → WP-A1 ✅（视觉基准已立）→ WP-A2 ✅ → WP-A3-2 ✅（模块 A3 全部完成）
WP-A4-1（宠物档案）：等 Pet 字段讨论收敛拍板 → 闭合 spec 派工 → 锚点闭环用户验收
R 线调研 ✅（报告已入 docs/plans/，ADR 草案挂 B6/B7 前置）
```

**当前批次状态（2026-07-19）**：模块 A3（注册登录，含邮箱与双向绑定）与 WP-A4-1 已完成实现和本地 production 行为验收。A4 的字段/关系决策正本见 `docs/plans/wp-a3-pet-schema-agreed.md`，行为证据见 `docs/operations/wp-a4-1-qa/`。PR #30 仍须完成 CI、生产 migration 先行、合并后 ECS `/pets` 冒烟，才能宣告 A 线锚点闭环完成；随后再定批次 2（B 线吸收 + C 骨架）范围。
