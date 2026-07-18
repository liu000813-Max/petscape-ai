# WP-4.1 RDS PITR 恢复演练报告

范围：`docs/plans/phase-b-execution-plan.md` WP-4.1。

状态：**INCOMPLETE**——日志备份未在演练窗口内覆盖 canary 写入时刻，未能进入实际 `CloneDBInstance` 恢复步骤。主实例全程未被修改（canary 写入已按计划清理还原）；未创建任何临时/克隆实例，无需释放。

## 卡点摘要

1. 经 SSH 隧道向主实例 `<RDS_INSTANCE_ID>` 的 `basecamp_probe` 表插入 canary 行（`label = pitr-canary-2026-07-18T10:05:30Z`，写入时刻 UTC `2026-07-18T10:05:30Z`）。
2. 随后以 60~90 秒不等间隔轮询 `DescribeLogBackupFiles`，持续约 45 分钟（`10:05` 至 `10:51` UTC，超过 spec 规定的 40 分钟等待阈值），日志备份文件列表**始终只有实例创建当时的初始段**（`LogBeginTime=2026-07-18T03:13:48Z`, `LogEndTime=2026-07-18T03:15:48Z`），没有产生任何覆盖 canary 时刻的新日志备份段。
3. 根因：`DescribeBackupPolicy` 显示 `PreferredNextBackupTime: 2026-07-18T19:40Z`——下一次计划内自动备份窗口在约 9 小时后（`PreferredBackupTime: 19:00Z-20:00Z`），而非持续流式日志上传；`BackupInterval: -1` 且 `LocalLogRetentionHours: 0` 说明日志备份依赖每日备份周期触发，不在演练可等待时间量级内自然产生新段。这是**可等待项，但等待时长超出本次 40 分钟阈值**，不属于配置错误或权限问题。

## 已试路径

- 直接反复调用 `DescribeLogBackupFiles`（时间窗口逐次扩大到当前时刻）：36 次尝试，间隔约 60-90 秒，全部返回同一个初始段，无新段。
- 交叉核实 `DescribeBackups`：仅一条 `FullBackup` 记录（`03:13:48Z`-`03:15:48Z`），无新增备份集。
- 核实 `DescribeBackupPolicy`：确认自动备份策略为"每天一次"（`PreferredBackupTime: 19:00Z-20:00Z`），`PreferredNextBackupTime` 明确指向当天 19:40 UTC，证实非几分钟级的可等待延迟，而是要等到下一个每日备份窗口。

## 可恢复时间范围证据（截至演练终止时刻 `2026-07-18T10:50:55Z`）

```
$ tools/aliyun rds DescribeLogBackupFiles --DBInstanceId <RDS_INSTANCE_ID> \
    --region cn-hangzhou --StartTime "2026-07-18T00:00Z" --EndTime "2026-07-18T10:50Z"

{
	"Items": {
		"BinLogFile": [
			{
				"FileSize": 21474836480,
				"LogBeginTime": "2026-07-18T03:13:48Z",
				"LogEndTime": "2026-07-18T03:15:48Z"
			}
		]
	},
	"TotalRecordCount": 1
}
```

即当前可用的 PITR 恢复时间点上限约为 `2026-07-18T03:15:48Z`（首个全备完成时刻），canary 写入时刻 `10:05:30Z` 不在可恢复范围内。

```
$ tools/aliyun rds DescribeBackupPolicy --DBInstanceId <RDS_INSTANCE_ID> --region cn-hangzhou
{
  ...
  "BackupInterval": "-1",
  "LocalLogRetentionHours": "0",
  "PreferredBackupTime": "19:00Z-20:00Z",
  "PreferredNextBackupTime": "2026-07-18T19:40Z",
  ...
}
```

## 验收标准逐条现状

| # | 验收标准 | 状态 | 说明 |
|---|---|---|---|
| 1 | 临时实例上查到恢复点前已存在的具名数据行（psql 证据） | **未达成** | 未创建临时实例（日志备份未覆盖 canary 时刻，无法发起有意义的 `CloneDBInstance RestoreTime`） |
| 2 | 恢复耗时记录 | **不适用** | 未进入恢复阶段 |
| 3 | 临时实例已释放（`tools/aliyun` 查询证据） | **PASS（平凡满足）** | 从未创建临时实例，`DescribeDBInstances` 确认仅主实例 `<RDS_INSTANCE_ID>` 存在，无需释放 |
| 4 | 报告落盘 | **PASS** | 本文件 |
| 5 | 报告含基础版→高可用版升级的操作前提、预计中断与回退限制成节 | **PASS** | 见下节，基于官方文档一手证据 |

临时实例存在性核对：

```
$ tools/aliyun rds DescribeDBInstances --RegionId cn-hangzhou --region cn-hangzhou
"DBInstanceId": "<RDS_INSTANCE_ID>"
"DBInstanceDescription": "petscape-prod-pg"
```

仅一个实例（主实例本身），无临时/克隆实例残留。

## 已完成的准备与前置验证（供后续重跑复用）

虽未能完成恢复动作，以下前置工作已验证并可直接复用：

- **CloneDBInstance 参数已确认**：`RestoreTime` 格式 `yyyy-MM-ddTHH:mm:ssZ`（带秒，与 `DescribeLogBackupFiles` 的 `yyyy-MM-ddTHH:mmZ` 不同，注意区分）；恢复到同 VPC（`vpc-bp1yf1zxokpove9oiyi3u`）/vSwitch（`vsw-bp1voxnkjd8f1ygyu5yce`）需显式传参；`PayType=Postpaid`。
- **最小按量规格与报价已核实**：`pg.n2.1c.1m`（1 vCPU/1 GiB）在 `cn-hangzhou-h` 可用区、`cloud_essd` 存储类型下可选（`DescribeAvailableClasses --Category Basic` 确认）；`DescribePrice` 实测报价 **¥0.172/小时**（20 GiB ESSD PL1，`bards` 商品码即按量付费主实例）。按当前基础版规格（`pg.n2e.2c.1m`，2 vCPU/4 GiB）计算的同口径报价会更高，但个位数/小时量级，与用户已授权的"个位-十几元"预算一致。
- **canary 探针机制已验证可用**：`basecamp_probe` 表（唯一约束 `label`）可直接承载 canary 行，写入/核对/清理路径顺畅（本次已完整走过一遍写入→核对存在→删除→核对不存在的循环，仅缺"覆盖窗口内发起克隆"这一环）。
- **主库当前基线快照**（供下次演练核对用，采集于 `2026-07-18T10:06 UTC` 左右，演练终止前主库无其他变更）：
  - `_prisma_migrations`：`20260718060543_init_basecamp_and_auth`、`20260718070004_wp32_projects_and_assets`、`20260718070027_wp_3_3_jobs`，均 `finished=true`；
  - `information_schema.tables`（`public` schema，10 张表）：`_prisma_migrations, account, asset, basecamp_probe, job, job_attempt, project, session, user, verification`。

## 主实例状态确认（演练前后零修改，canary 除外）

- 演练期间未执行任何 `Modify*`/`Delete*` 类 API 对主实例；仅执行 `Describe*`（只读查询）与一次性 `INSERT`/`DELETE`（针对 `basecamp_probe` 探针表）。
- 白名单、安全组、规格全程未变更。
- canary 行生命周期：`INSERT`（`10:05:30Z`，见上）→ 演练终止后 `DELETE`（已执行，`DELETE 1` 返回确认，二次查询 `count=0`）。主库已恢复到演练前状态。

## SSH 隧道清理

- 隧道命令：`ssh -fN -L 15432:<RDS_HOST>:5432 root@<ECS_PUBLIC_IP>`。
- 执行环境注记：本次执行环境在工具调用之间会清理长驻子进程（隧道曾两次意外断开，均已重建），每次核对前均重新确认 `lsof -iTCP:15432 -sTCP:LISTEN` 存活。
- 演练结束前已 `kill` 隧道监听进程，`lsof -iTCP:15432` 确认无残留监听（exit 1 / 空输出）。

## 升级路径：基础版 → 高可用版（操作前提 / 预计中断 / 回退限制）

Step 0 报告（`docs/operations/phase-b-step-0-cloud-resources.md` §3）已核验的操作前提：`ModifyDBInstanceSpec` 支持将 `Category` 改为 `HighAvailability`；当前地域（`cn-hangzhou`）、PostgreSQL 16、ESSD PL1 组合下可查询到高可用规格（如 `pg.x2m.medium.2c`、`pg.x4m.medium.2c` 等，本次用 `DescribeAvailableClasses --Category HighAvailability --DBInstanceStorageType cloud_essd --Engine PostgreSQL --EngineVersion 16.0 --RegionId cn-hangzhou --ZoneId cn-hangzhou-h --CommodityCode bards` 复核，返回完整规格清单，含 `pg.x2m.medium.2c` 等）；升级需补充从节点可用区和 vSwitch，按维护窗口执行。本节补齐中断与回退限制。

### 操作前提（Step 0 已核验部分 + 本包补充）

- 实例计费方式须为包年包月或按量付费（当前为月付，满足）；账号无未支付续费订单；实例状态须为"运行中"。
- 升级 RDS 版本（`Category: Basic → HighAvailability`）需额外指定从节点可用区（`ZoneIdSlave1`）和对应 vSwitch；若与主可用区不同则为多可用区部署。
- 来源：阿里云官方文档《变更配置》（PostgreSQL 版，`help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/change-the-specifications-of-an-apsaradb-rds-for-postgresql-instance`，2026-07-18 抓取核实）。

### 预计中断

- 官方文档"变更项"表格明确：**RDS 版本变更（Basic → HighAvailability）业务影响 = "会出现短暂业务闪断"**（原文："系列：当前支持 PostgreSQL 基础系列升级高可用系列……会出现短暂业务闪断"）。
- 同一文档"注意事项"节补充关键背景：**"由于基础系列只有一个数据库节点，没有备节点作为热备份，因此当该节点意外宕机或者执行变更配置、版本升级等任务时，会出现较长时间的不可用"**——这是基础版本身固有风险，也是选择在支付/订单模块上线前完成 HA 升级评估的理由。
- 英文版文档（`change-the-specifications-of-an-apsaradb-rds-for-postgresql-instance`）给出更具体的口径："Depending on the change type, a transient connection or instance restart may occur—typically lasting a few minutes."；FAQ 段进一步确认："If I upgrade CPU, memory, and storage at the same time, how long does the transient connection last? ... typically a few minutes."
- **尚未验证**：官方文档未给出该"几分钟"闪断的精确上限秒数或 SLA 承诺数字；也未给出针对本实例当前数据量（约 1.4 GB）和当前地域资源状况的实测切换时长。若需要精确数字用于容量规划，应在实际执行前的维护窗口做一次真实变配并实测记录（不在本次演练范围内）。
- 变配任务应安排在维护窗口执行（`EffectiveTime=MaintainTime` 或 `ScheduleTime`），文档警告"根据变更项不同，切换过程中可能会出现业务闪断或实例重启，而且与数据库、账号、网络等相关的大部分操作都无法执行"。

### 回退限制

- **变配订单提交后无法取消**：中英文官方文档均明确此点（中文："变配订单提交后无法取消，请在执行变配前详细评估业务需求"）。这意味着一旦发起 Basic→HA 升级，不能中途撤销订单，只能等待其完成或失败。
- **官方"变更项"清单只列出单向路径**：文档"系列"变更项仅描述"PostgreSQL 基础系列升级高可用系列"、"基础系列或高可用系列升级集群系列"，**没有列出"高可用系列降级回基础系列"作为受支持的变更方向**。这是产品能力边界的直接证据——回退到 Basic 版不是 `ModifyDBInstanceSpec` 的 `Category` 参数一个反向调用能完成的受支持路径。
- **尚未验证**：是否存在其他受支持的"降级"手段（例如新建 Basic 版实例 + 数据迁移 + 切换连接串的迂回路径）；官方文档与 API 帮助文本均未直接回应"如何从 HA 降回 Basic"，本报告不编造具体步骤或复杂度估计。若确需回退能力，应在升级前单独向阿里云工单确认降级支持范围，或规划"新建低配实例+逻辑迁移"作为唯一确定可行的回退手段。
- 存储类型有类似单向限制（供交叉参考，非本次问题核心）：ESSD 可升级到 Premium ESSD，但"不支持 Premium ESSD 降级为 ESSD"；标准 SSD 可升级到 ESSD，但"不支持 ESSD 降级为标准 SSD"。这印证了阿里云 RDS 变配 API 在多个维度上都遵循"仅支持升级方向"的产品设计模式，与"版本降级不受支持"的结论一致。

### 证据来源

- `docs/operations/phase-b-step-0-cloud-resources.md` §3（Step 0 已核验的操作前提）。
- 阿里云官方文档《变更配置》中文版：`https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/change-the-specifications-of-an-apsaradb-rds-for-postgresql-instance`（抓取时间 2026-07-18）。
- 阿里云官方文档《Change RDS edition, instance type, and storage capacity for PostgreSQL》英文版：`https://www.alibabacloud.com/help/en/rds/apsaradb-rds-for-postgresql/change-the-specifications-of-an-apsaradb-rds-for-postgresql-instance`（抓取时间 2026-07-18）。
- `tools/aliyun rds DescribeAvailableClasses`（本次实测，Category=HighAvailability 规格清单）。

## 费用

本次演练**未产生任何新增计费资源**（未创建临时实例）。已核实的按量付费单价供后续重跑参考：`pg.n2.1c.1m` + 20 GiB ESSD PL1 ≈ **¥0.172/小时**（`DescribePrice` 实测报价，`Postpaid` + `bards` 商品码）。

## 建议：下一步重跑窗口

根据 `PreferredNextBackupTime: 2026-07-18T19:40Z`，下一次计划内自动备份（含日志备份段推进）将在当天 19:00-20:00Z 窗口发生。建议重跑演练安排在该窗口之后（例如 `2026-07-18T20:00Z` 之后），此时日志备份应已覆盖新写入的 canary 时刻，可直接进入 `CloneDBInstance RestoreTime` 步骤。若需要更快验证，也可考虑在下次演练前先手动触发一次全量备份（`CreateBackup`，未在本次范围内执行，需主控评估是否额外产生非预期的备份存储成本）。

## 改动文件清单

- `docs/operations/phase-b-step-4-pitr-drill.md`（新增，本文件）
