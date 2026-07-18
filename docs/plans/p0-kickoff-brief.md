# P0 模块推进启动 brief（交接文档）

状态：2026-07-18。供接手 P0 规划讨论的 agent 与用户对齐使用；讨论产出=首批模块选择与粒度拆分建议，执行文档另行编写。

## Intent

Phase B 基座已完成（PR #1-#19 全合并）。演进顺序已拍板改为按 `PRODUCT-MODULES.md` 的 P0 主链逐模块推进（ARCHITECTURE.md §11，2026-07-18 修订，DoD 三条含原型吸收豁免条款）。7 月验收目标=一笔真实线上订单全链路。本 brief 的任务：与用户讨论**先做哪几个模块**、每个模块怎么拆，讨论时结合现有代码实况，不重新考古。

## Phase B 差额分析（P0 主链各模块的真实起点）

- **A1 服务器部署**：大头已有——CI/CD（GHA→ACR→ECS Compose）、healthz、回滚脚本、结构化日志全部实证；**缺公网入口**（备案闸门，见开放问题①）与正式域名接入。
- **A2 数据库**：大头已有——RDS PG16 + Prisma 7 + migration 流程（本地生成、RDS 只 deploy）+ 连接预算；缺各业务模块的表（逐模块建）。
- **A3 注册登录**：API 层闭环已有（Better Auth + phone-number + PNVS 真发实测、`/api/auth/[...all]`、`/api/me`、换绑不改 User.id）；**缺全部 UI**（登录页/注册流/账户管理）与密码找回等边缘流。
- **A4 宠物档案**：全新（原型有 PetProfile 表单语义可参考，`web/app` 原型链）。
- **B1 设计项目**：Project/Asset 表与 `/api/v1/projects*` 已有（WP-3.2）；缺历史记录/归档等产品语义与 UI。
- **B2-B4（空间设计/物品提取/3D 生成）**：需吸收原型大头——`web/app/lib/jobs/{vibeJob,avatarJob}.ts`、`tripo/client.ts`（多 key 级联）、`images/`、`prompts/`；任务系统（SKIP LOCKED Worker）已就绪可直接承载，原型的进程内 job 模式按 DoD(b) 退役。
- **B5 尺寸确认**：原型有 three.js Viewer/调参基础。
- **B6/B7（审核/成本预估）**：**模块前置=模型处理与切片正式方案 ADR**（ARCHITECTURE §13 待决策队列第 4 项；已拍板在 B2-B4 推进期间并行调研，不默认沿用 trimesh/PrusaSlicer）。
- **C 组（C1-C9）**：全部全新，无原型对应（DoD(b) 豁免）；订单/报价/支付按 ARCHITECTURE §5.7 高风险模块全额分层纪律。

工程约束正本：`docs/governance/engineering-conventions.md`（测试分级、zod、支付前 checklist）；包级注意事项：`packages/server/CLAUDE.md`。

## 已拍板（不要重新讨论）

1. 演进顺序=模块化推进，DoD 三条（ARCHITECTURE §11）；
2. 支付（C3）拆两段：**支付抽象层+订单状态机现在就做**，真实渠道接入等个体户执照（外部闸门）；
3. 切片 ADR 挂 B6/B7 模块前置，B2-B4 期间并行调研；
4. 模块≠工作包：大模块（B2/B4 等）拆多个可独立验收竖切；
5. 产品模块 SSOT=`PRODUCT-MODULES.md`（飞书为讨论源，快照防漂移机制见其文件头）；
6. PITR 演练挂支付/订单上线前（`docs/operations/phase-b-step-4-pitr-drill.md` 有重跑指引）。

## 开放问题（讨论时需处理或显式搁置）

① **备案与公网入口**（A1 收口 + 7 月"线上"定义）：事实——大陆 ECS 上未备案域名的 80/443 会被阿里云接入层拦截，"换域名"绕不开；现实绕行都是境外前置节点（合规灰色）。**线索：ECS 上有 cloudflared 进程常驻（WP-2.5 侦察记录），现网黑客松站点（petscape3d.com，nginx 反代）可能已走 Cloudflare Tunnel——先查清这条现状再讨论**。备案 2026-07-17 提交（Max 名义），约 8 工作日，≈7 月底压线。7 月验收的"线上"是否接受"IP/临时入口完成全链、正式域名随备案切换"待用户定。
② **第一单履约方式**（C6/C7 输入）：谁打印（自有打印机 vs 供应商——D5 是 P1 未建）、怎么发货（人工录运单号的最小路径？）。用户暂无答案，进入 C6/C7 前必须收敛。
③ **支付真实渠道时间线**：当面付同样需要营业执照；执照进度在用户与 Max 处。若 7 月执照未下，第一笔"真实付款"的合规口径需用户拍板。
④ 快照"待团队确认"三项（支付渠道负责人/生产状态同步方式/物流平台）尚无答案。

## Entry points

`PRODUCT-MODULES.md` → `ARCHITECTURE.md`（§5 分层/§7 对象关系/§11 演进）→ `docs/plans/phase-b-execution-plan.md`（工作包格式与验收风格基准）→ `docs/governance/engineering-conventions.md` → `packages/server/CLAUDE.md` → memory `project-3d-pet-printing`（当前态快照）。

## Closing

与用户对齐首批模块（建议给出：候选组合、并行机会、每模块的竖切草案、开放问题的处理方式），确认后由编排方写执行文档（沿用 phase-b 格式：闭合 spec + 机器可判验收 + DoD 三条）。
