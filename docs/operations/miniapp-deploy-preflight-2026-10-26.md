# 小程序后端发布前检查（2026-10-26）

本记录区分服务器检查、GitHub 发布准备与实际上线。目标是复用杭州现有 PETSCAPE ECS；本轮没有创建云资源、重启实例、修改生产配置或运行生产迁移。

## 已核实

- Workbench 已由用户登录，检查在 Shell 模式执行。系统内存 1673 MiB，检查时可用约 433 MiB，无 swap；根盘约 39.01 GiB，剩余约 26.08 GiB。
- Web、Worker 容器都 healthy，当前版本为 `a3e4eb171a36f9348dc8811483fc350758fd3323`；内存分别约 486.6 / 512 MiB、182.7 / 384 MiB，OOM 均为 false，重启计数均为 0。这些是采样值，不是新版本容量验收。
- 官网 Nginx `/` 当前转发到 `127.0.0.1:3010`；PM2 列表为空。既有 Compose 注释中的 PM2 基线不再代表线上拓扑，更新 Web 容器会同时影响官网与小程序 API。
- 本地同时保留当前与上一版本的 Web、Worker 镜像；`.previous-image-ids` 当前不存在，须在正式发布的 pre 阶段建立。本地旧镜像不能替代数据库备份和迁移回滚评估。
- 服务端 `web.env`、`worker.env` 均为 `0600`。仅检查键是否存在：数据库、Better Auth 配置已有，微信 AppID/AppSecret 尚未配置。没有输出配置值或用模板覆盖文件。
- ECS 已有三个登录公钥，均不匹配本机现有的另一项目密钥；没有复用该密钥。已在本机生成 PETSCAPE 专用密钥，但尚未加入 ECS 或 GitHub。
- GitHub Actions 页面原先仍提示 fork 工作流暂停；本轮点击启用后页面明确显示 `Actions Enabled`。是否产生自动 CI，仍须以新提交对应的 push 运行验收。

## 发布配置

当前 Deploy 工作流仍只接受 main 上的手动发布，并要求同一 SHA 的 main push CI 与完整回归成功。新增固定主机指纹检查不改变这些门禁、迁移顺序或业务 API。

工作流需以下 8 项 Actions Secrets：

| 名称 | 用途 |
| --- | --- |
| `ACR_REGISTRY` | CI 构建镜像的公网仓库地址 |
| `ACR_REGISTRY_VPC` | ECS 拉取镜像的内网仓库地址 |
| `ALIBABA_CLOUD_ACR_USERNAME` | ACR 镜像登录账号 |
| `ALIBABA_CLOUD_ACR_PASSWORD` | ACR 镜像登录凭据 |
| `DEPLOY_SSH_PRIVATE_KEY` | PETSCAPE 专用部署私钥 |
| `DEPLOY_SSH_HOST` | 已核对的目标 ECS 地址 |
| `DEPLOY_SSH_USER` | 现有工作流需要的服务器部署用户 |
| `DEPLOY_SSH_KNOWN_HOSTS` | 经 Workbench 核对的目标服务器公钥记录 |

`GITHUB_TOKEN` 由 Actions 提供，不需要复制本机 GitHub 凭据。微信 AppSecret 仅配置在服务端；不放入客户端、仓库或部署记录。

SSH 建立连接前校验固定 `known_hosts`，不得用部署时的网络扫描结果直接建立信任。配置缺失、目标不匹配或主机指纹变化时发布失败，不降低验证要求。

## 尚未完成

新增 GitHub 到 ECS 的访问权限与凭据传输等待用户明确选择。现有工作流使用 root/Docker；即使专用公钥使用 `restrict` 关闭转发和 PTY，仍能执行 root 命令，不是命令级最小权限隔离。

授权后还须逐项完成：Secrets 配置与 SSH 验证、当前配置私有备份、数据库备份核对、精确 main SHA 的 CI、完整回归、迁移与容器切换、官网和小程序 API 验收。个人小程序正式注册、真实微信登录、真机验收、体验上传与审核结果分别记录。

客户端继续使用测试号和 mock；本记录不是发布成功证明，没有新的微信体验二维码。
