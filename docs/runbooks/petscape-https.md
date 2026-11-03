# PETSCAPE HTTPS 证书维护

官网和小程序 API 共用 petscape3d.com 证书。手机请求失败时先用严格 TLS 检查证书有效期、完整证书链和公开健康接口；不可用 curl -k 或关闭小程序域名校验代替验收。

## 已部署的续期方式

使用既有 /usr/local/bin/certbot、证书名 petscape3d.com 和 webroot /var/www/letsencrypt。现有 Nginx HTTP challenge 路由必须继续可达。账号私钥和证书私钥仅保留服务器。

Certbot renewal 配置须包含成功续期钩子：

~~~ini
renew_hook = nginx -t && systemctl reload nginx
~~~

[petscape-cert-renew.service](../../deploy/systemd/petscape-cert-renew.service) 和 [timer](../../deploy/systemd/petscape-cert-renew.timer) 安装到 /etc/systemd/system；先确认没有功能重叠的现有续期任务。使用 systemd-analyze verify 校验，再执行 daemon-reload 和 enable --now petscape-cert-renew.timer。

首次安装后手动 start petscape-cert-renew.service，检查 Result 和 ExecMainStatus；即使证书尚未进入续期窗口，服务也应成功退出。使用 list-timers 或 show 查看下一次执行时间，用 journalctl -u petscape-cert-renew.service 查看故障。续期失败时先恢复 challenge 可达性和网络，不替换应用容器。

## 验收与停用

实际续期后检查公开 443 端口的新证书日期，以及官网 /api/healthz 和小程序 /miniapp-api/api/healthz；两者均需严格 HTTPS 返回正常。

迁移续期职责时先确认替代任务有效，再 disable --now petscape-cert-renew.timer；不要删除现有证书、ACME 账号或 Nginx challenge 路由。

最近一次实际续期与证据见 [2026-11-03 联调记录](../operations/miniapp-device-2026-11-03.md)。
