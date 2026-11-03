# PETSCAPE 微信真机联调记录（2026-11-03）

## 当前结论

本轮发现并修复 HTTPS 证书过期。官网与独立小程序接口已恢复严格 TLS 访问；已添加自动续期。服务器历史数据证明真实微信账号已有 Session 和宠物档案；修复后的当前真机显示仍待用户扫码确认。

| 验证项 | 实际结果 |
| --- | --- |
| 旧证书 | 2026-10-30 12:53:30 UTC 到期；服务器 curl 报 certificate has expired |
| 本轮续期 | 使用既有 Certbot 账号、webroot 和证书名完成 renew；Nginx 配置验证通过并 reload |
| 新证书 | 2026-11-03 09:42:12 UTC 至 2027-02-01 09:42:11 UTC |
| 小程序健康检查 | HTTPS /miniapp-api/api/healthz 返回 200，ok=true、db=true；镜像版本 9c07d9f2b8cfe9b015fd80a13cfb96879d345d84 |
| 官网健康检查 | HTTPS /api/healthz 返回 200，ok=true、db=true；版本 a3e4eb171a36f9348dc8811483fc350758fd3323 |
| 公开只读接口 | articles、community/posts、service-providers 均返回 200 |
| 未登录宠物接口 | /miniapp-api/api/v1/pets 返回 401，保持鉴权 |
| 历史微信数据 | 独立 schema 中 wechat-miniprogram 账号 1 个；同一账号存在 Session 和宠物档案 |
| 登录时间 | 账号和 Session 均创建于 2026-11-01；未读取或输出 openid、Session token、用户或宠物内容 |
| 自动续期 | petscape-cert-renew.timer active；首次手动执行 service Result=success、ExecMainStatus=0；下次 2026-11-04 03:36:53 CST |

历史数据只证明此前真实登录和保存发生过，不证明当前手机 Session 未过期、当前访问者身份、当前真机页面正常或已经正式发布。10 月 29 日观察窗口没有 Session 的结论仅限当时；不能据此把后续空页面统一归因为服务器域名配置。

## 客户端修复与验证

- 首页和“我的宠物”区分读取失败与成功但无数据；读取失败清空旧档案，显示重试入口，401 单独提示微信登录未完成。
- mockMode 只由版本配置控制，移除旧本地存储覆盖，避免真实后端版本意外进入演示模式。
- 只读就绪诊断允许既有 /miniapp-api 前缀；继续拒绝凭据、查询、片段和其他路径，request 合法域名仍填 HTTPS 源地址。
- 先建立 4 个失败回归用例，再修复；最终原生页面、配置诊断和预览脚本合计 44 项通过，0 跳过。
- 官方编译器通过 13 个 WXML、14 个 WXSS；本轮未修改服务端业务 API、数据库结构或既有官网镜像。
- 本机就绪检查仍报告 account-registration 缺项；这来自 accountMode=test 的本机标记。当前微信后台实际发布资格和版本状态尚未重新读取。

## 本轮交付回执

| 项目 | 结果 |
| --- | --- |
| 小程序代码提交 | ef1fbe915579a97e587b203b4b11edd4610973f7；已推送到 liu000813-Max/petscape-ai main 并核对远端 SHA |
| 开发版本上传 | 0.1.1；2026-11-03 18:51 CST，官方 CLI upload 成功且退出码 0，包体 681015 bytes |
| 上传私有证据 | G:/Max麦麦/codex/petscape-dev-runtime/wechat-uploads/20261103-185132-57780dbf；官方 info、日志及脱敏 receipt 保存在仓库外 |
| 新预览码 | 2026-11-03 18:51 CST 生成；JPEG；SHA-256 75e7ac4379dccd32c3a29973a3325dfdecf1b16e5bb32df59f5370120c1254c2 |
| 预览私有证据 | G:/Max麦麦/codex/petscape-dev-runtime/wechat-previews/20261103-185043-d27fc762；二维码和扫码令牌不进入 Git |
| 本轮手机扫码 | 尚未确认，不能由 CLI 成功推断 |
| GitHub CI | 精确代码提交的 push CI 41622579303 的 ci-gate 成功；static-and-unit、server-integration、worker-image 均成功 |
| 微信后台 | 尚未确认“设为体验版”、成员配置、审核或正式发布 |

用户下一步使用已授权微信扫码，打开“我的宠物”，确认档案可读；若失败，保留页面提示，再按时间核对服务器登录链路。Windows 预览脚本本轮通过 PowerShell 7 运行；旧版 Windows PowerShell 按本机代码页读取无 BOM 中文脚本会报语法错误，不能据此要求重新扫码登录。

## 部署与交付边界

自动续期单元已保存在 [deploy/systemd](../../deploy/systemd/)，安装和检查方式见 [HTTPS 维护](../runbooks/petscape-https.md)。timer 每日两次检查、最多随机延迟 1 小时，仅在到期窗口续期；现有 renew_hook 验证 Nginx 后 reload。

官方 CLI 上传成功只证明开发版本上传，后台“设为体验版”及体验成员二维码需单独核实；正式审核与发布仍待实际账号资格和后台流程完成。
