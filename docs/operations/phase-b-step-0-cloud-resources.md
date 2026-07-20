# Phase B Step 0：阿里云资源开通执行报告

状态：完成
执行日期：2026-07-18
地域：华东 1（杭州），`cn-hangzhou`

本报告只记录 `docs/decisions/0001-0005` 的资源执行结果和验收证据，不重复技术决策理由。身份根因修正后，本报告采信的阿里云 API/CLI 证据均显式使用项目根 `.env` 中 `<CLOUD_RAM_USER>` 的 AccessKey；未修改 `~/.aliyun/config.json`，也不采信此前误用全局默认身份产生的结果。

## 1. 身份边界

- STS 实测账号：`<PROJECT_CLOUD_ACCOUNT_ID>`
- STS 实测身份：`acs:ram::<PROJECT_CLOUD_ACCOUNT_ID>:user/<CLOUD_RAM_USER>`
- 项目 `.env`：权限 `600`，被 `.gitignore` 忽略
- 密钥和数据库密码不写入本报告

## 2. ECS 与网络

- 复用现有 ECS，没有升配或新购：
  - 实例：`<ECS_INSTANCE_ID>`（`petscape`）
  - 规格：`ecs.e-c1m1.large`，2 vCPU / 2 GiB
  - 系统：Ubuntu 22.04 LTS
  - 可用区：`cn-hangzhou-h`
  - VPC：`vpc-bp1yf1zxokpove9oiyi3u`
  - vSwitch：`vsw-bp1voxnkjd8f1ygyu5yce`
  - 私网 IP：`<ECS_PRIVATE_IP>`
  - 公网 IP：`<ECS_PUBLIC_IP>`
- Docker：`29.1.3`；Docker Compose：`2.40.3`
- Docker 服务：`enabled` 且 `active`
- 安全组 `sg-bp15kx7ga3s54xzv4mm3` 入方向只保留：
  - TCP 22 / `0.0.0.0/0`
  - TCP 80 / `0.0.0.0/0`
  - TCP 443 / `0.0.0.0/0`
- 行为层复核：现有站点返回 HTTP 200；443 仅预留安全组入口，当前尚无进程监听。
- 本步新增固定成本：￥0（复用已有实例）。

## 3. RDS PostgreSQL

最终采用一个月包月方案：

- 原年度订单 `<CLOUD_ORDER_ID>` 已取消，未扣款
- 月付订单：`<CLOUD_ORDER_ID>`
- 订单 API 状态：`Paid`
- 实付：￥88.00 / 1 个月
- 实例 ID：`<RDS_INSTANCE_ID>`
- 实例状态：`Running`
- 当前 API 到期时间：`2026-08-18T16:00:00Z`
- PostgreSQL 16，基础系列，单节点
- 规格代码：`pg.n2e.2c.1m`
- 规格：2 vCPU / 4 GiB，最大连接数 400
- 存储：20 GiB ESSD PL1（`cloud_essd`）
- 可用区：`cn-hangzhou-h`
- VPC：`vpc-bp1yf1zxokpove9oiyi3u`
- vSwitch：`vsw-bp1voxnkjd8f1ygyu5yce`
- 白名单：`<PRIVATE_NETWORK_CIDR>`
- 内网地址：`<RDS_HOST>:5432`
- 私网 IP：`<RDS_PRIVATE_IP>`
- 续费状态：`ManualRenewal`，未开启自动续费

初始化结果：

- 数据库：`petscape`，状态 `Running`，字符集 `UTF8`
- 应用账号：`petscape_app`，类型 `Normal`，状态 `Available`
- 权限：仅拥有 `petscape` 数据库的 `DBOwner`；这是 PostgreSQL 云盘实例支持的数据库级授权
- 随机数据库密码只写入项目根 `.env`

备份与恢复配置：

- 自动备份周期：周一至周日，每天执行
- 数据备份保留：7 天
- 日志备份：已启用（`EnableBackupLog=1`）
- 日志备份保留：7 天，可用于时间点恢复（PITR）
- 高空间占用保护：已启用
- 按 `ARCHITECTURE.md` 第 10 节分级要求，完整备份恢复演练不阻塞本次基座成立，但必须在支付与订单模块上线前完成

真实连通性验收：

- ECS 到 RDS 5432 TCP：成功
- ECS 安装 `postgresql-client` 后使用真实应用账号登录：成功
- SQL 行为证据：`petscape|petscape_app|PostgreSQL 16.13`
- Cloud Assistant 执行状态：`Success`，退出码 0

升级路径核验：`ModifyDBInstanceSpec` 支持将 `Category` 改为 `HighAvailability`；当前地域、PostgreSQL 16 和 ESSD PL1 组合可查询到高可用规格（例如 `pg.x2m.medium.2c`、`pg.x4m.medium.2c`）。升级时需补充从节点可用区和 vSwitch，并按维护窗口执行，不在本步骤实施。

## 4. OSS

- 服务开通订单：
  - `<CLOUD_ORDER_ID>`：OSS，`Paid`，￥0
  - `<CLOUD_ORDER_ID>`：深度冷归档能力，`Paid`，￥0
- Bucket：`petscape-prod`
- 地域：`oss-cn-hangzhou`
- ACL：`private`
- 存储类型：Standard
- 公网 Endpoint：`oss-cn-hangzhou.aliyuncs.com`
- CORS（2026-07-19 为浏览器私有直传补齐）：
  - Origins：`http://127.0.0.1:3421`、`http://localhost:3000`、`http://localhost:3010`、`https://petscape3d.com`、`https://www.petscape3d.com`
  - Methods：`GET`、`PUT`、`HEAD`；Allowed headers：`*`；Expose headers：`ETag`、`x-oss-request-id`；Max age：600 秒
  - CORS 只允许浏览器发起跨域请求，不改变 private ACL；对象读写仍必须通过服务端签发的短期 URL。
- 内网 Endpoint：`oss-cn-hangzhou-internal.aliyuncs.com`
- 匿名访问实测：HTTP 403 / `AccessDenied`
- 已建立 4 个零字节前缀占位对象：
  - `uploads/raw/`
  - `uploads/generated/`
  - `assets/3d/`
  - `orders/evidence/`
- 未配置生命周期规则（保留期尚未确定）。
- 固定成本：￥0；后续按实际存储、请求和流量计费。

## 5. PNVS 短信认证

- 控制台“免费开通服务”已完成，激活成本 ￥0。
- 控制台实际依赖：选择“短信认证产品”时会同时强制选择“号码认证产品”；图形认证和融合认证未开通。本阶段不配置、不调用一键登录或本机号码校验。
- 当前系统赠送且审核通过的签名：
  - `<SMS_SIGN_NAME>`
  - `<SMS_SIGN_NAME>科技`
  - `北京<SMS_SIGN_NAME>`
  - `恒锐创岳`
  - `恒锐创岳科技`
  - `北京恒锐创岳`
- 登录/注册模板：`100001`，内容包含 `${code}` 和 `${min}` 参数。
- 非发送 API 验收：用虚构号码和虚构验证码调用 `CheckSmsVerifyCode`，返回 HTTP 400、`isv.ValidateFail`、`验证失败`。这证明鉴权、产品开通和 API 路由生效，且没有发送短信。
- 当前签名均为系统赠送的非 PetScape 品牌签名；正式上线前必须把短信展示体验作为业务模块实现前的用户确认项。
- 固定成本：￥0；真实短信调用按量计费。

## 6. 配置落盘与预算

项目根 `.env` 已写入：地域、VPC、vSwitch、ECS 实例与 IP、OSS Bucket 及公网/内网 Endpoint、RDS 实例 ID、内网主机、端口、库名、账号和随机密码。密码只存在于 `.env`。

当前新增固定成本：￥88.00 / 月，低于批准的 ￥400 / 月上限。该数字不含复用 ECS 的既有历史成本，也不含 OSS、短信等按量费用。

本次购买后账户可用现金余额：￥211.94。

## 7. 完成验收

1. RDS 月付订单 API 状态为 `Paid`，实例状态为 `Running`；
2. 数据库、最小权限账号和 `.env` 连接字段已就绪；
3. 自动备份、日志备份/PITR 和基础版到高可用版的升级路径已核验；
4. ECS 到 RDS 内网端口及实际 PostgreSQL 登录均成功；
5. ECS 安全组只保留 22、80、443，现有站点仍返回 HTTP 200；
6. OSS 保持 private，匿名访问返回 HTTP 403 / `AccessDenied`，四个前缀均存在；
7. PNVS 已开通并通过非发送 API 验证；
8. `.env` 权限仍为 `600` 且被 Git 忽略，报告未包含 AccessKey Secret 或数据库密码。
