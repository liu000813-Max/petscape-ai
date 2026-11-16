# PETSCAPE 登录恢复与发布核验

本轮仅处理用户指定的三个任务。状态随实质证据更新；二维码重生成与时间变化不代表账号资格或真机验收完成。

| 任务 ID | 内容版本 | 任务本体 | 新增事实 | 对任务的影响 |
| --- | --- | --- | --- | --- |
| 1 | v1 | 改善档案读取错误提示 | 首页与档案页按微信登录、建立会话、读取接口标记阶段，区分域名许可、超时、TLS、DNS、普通网络、登录配置及身份校验失败 | 可据固定诊断编号继续排查；不再仅凭“暂未加载”判断域名问题 |
| 2 | v1 | 恢复过期会话的当前请求 | 仅对鉴权层明确返回的 401 unauthorized 合并登录，并重发当前请求一次；旧 token 的延迟 401 不清除新会话 | 过期读取可在同次操作恢复；写入仅在明确鉴权拒绝后重发，网络不明结果不自动重复提交 |
| 3 | v5 | 核实正式账号及体验版 | 用户刷新项目域名信息后，运行时白名单已包含 PETSCAPE，健康请求返回 200。随后发现微信拒绝旧密钥；同步后台当前密钥后，开发工具内真实 wx.login、线上会话交换与宠物读取均成功，档案页恢复正常空状态 | 已解除开发工具内的域名与密钥阻塞；当前微信身份无宠物档案。手机复验仍待用户扫码，当前账号仍为测试号，不能标记体验版或正式发布完成 |

## 行为与数据边界

- 新错误模块只展示固定文案、类别和经 UUID 格式校验的请求编号；不展示任意 errMsg、URL、微信 code、token 或服务端 detail。
- HTTP 请求超时 15 秒，wx.login 使用 10 秒超时；诊断保留失败阶段。网络错误上报继续遵守既有 analytics code 枚举，不新增公开 API 或改动合同。
- 当前受保护路由在业务操作前返回 unauthorized。只有这个明确响应触发一次恢复；403、任意其他 401、5xx、网络断线与超时均不重放写入。恢复后的请求再返回 401 时直接结束。
- 会话刷新沿用共享 loginPromise。清缓存前比较当前缓存与该请求实际携带的 token；公开接口的 401 不改变登录状态。

## 验证

- 测试先行：新增请求恢复和诊断测试时，旧实现出现 8 项失败；修复后通过。
- 最终页面、请求层、配置及预览脚本回归 57 项通过、0 失败、0 跳过。
- 官方编译器通过 13 个 WXML 与 14 个 WXSS。
- 使用仓库外无云凭据快照及独立本机 PostgreSQL 16 新库，应用全部 16 项迁移；真实 HTTP 验收 9 项通过、0 跳过，包含过期读取恢复和保存恰好一条记录。
- HTTP 的 wx.login/code2Session 使用会话夹具，仅业务请求与数据库为真实执行；不把它记为真实微信认证。
- HTTP 快照构建及 TypeScript 检查成功。依赖通过既有 node_modules junction 复用，验收快照的 Turbopack root 扩至共同父目录以允许链接；仓库 next.config.ts 未修改。初次快照构建因链接越出 root 失败，修正验收环境后通过。
- HTTP receipt 位于仓库外 petscape-dev-runtime/postgres16/runs/20261116022652526_cb3dd3/http-receipt.json；本机测试结束后恢复 PostgreSQL 原停止状态，数据保留。

## 交付状态

- 修复代码提交 a0f9bc65c4823b01cd5cbc61966a19bd5ed4eb96 已推送到 liu000813-Max/petscape-ai main，并用 GitHub API 核对。
- 首个代码 SHA 的 CI 43791797962：服务端集成与 worker 镜像成功，Web lint 因新测试局部变量名 module 被 Next 规则拒绝而失败。已将变量改名为 nativeModule；Windows 验证以 POSIX 路径归一化比对既有 baseline 后为 11/17 个存量错误、0 回归，未修改或提高 baseline。
- 修正代码 f0e2e9a94234a5045cfb727eb6d905ddba206d6e 已推送并在 CI 43793809333 完整通过。
- 微信 request 域名保存后的截图保存在仓库外 wechat-account-review/request-domain-configured-20261116.png；截图仅截取域名表，不含密钥。
- 首次新预览失败：官方接口返回 code 10“需要重新登录”，尽管 islogin 返回 true。用户完成官方 CLI 登录后，旧项目窗口仍报 code 10；通过官方 close/open 重开本项目后成功生成预览。未复制登录存储或关闭安全校验。
- 初次修复预览回执：2026-11-16 10:44 CST，wechat-previews/20261116-104332-c9d8ceb5，JPEG SHA-256 d699ebf957a25f6e01861cc407c842446c7e0bca5ee9584364a748016edb49b3；后续手机已打开并报告域名错误，不能作为登录通过证据。
- 官方 upload 回执：2026-11-16 10:48 CST，版本 0.1.2，CLI exit 0 且 upload 成功；私有证据 wechat-uploads/20261116-104822-7d062fe8。该结果仅证明开发代码上传，未验证后台体验版。
- 公众平台网页登录、开发者工具登录、后台设为体验版、成员扫码、审核和正式发布分别验收。完整二维码、官方 info、原始日志及密钥均保留仓库外；源码与文档不包含这些数据。

## 后续真机反馈与复现

- 用户提供 10:57 首页、10:58 我的宠物截图，两页均显示 DOMAIN_NOT_ALLOWED，阶段为建立会话。错误分类已在真机可见；登录与档案读取仍未通过。
- 重新加载公众平台页面后，request 合法域名表仍显示 https://petscape3d.com；不重复提交或消耗修改次数。
- 严格 HTTPS 检查：健康接口返回 200，登录接口空 JSON 请求返回 400，均无 Location 重定向。
- 官方 miniprogram-automator 0.13.0 安装在仓库外，连接官方 agent start 启动的本机 9420 端口。读取的 AppID 为 wx86e80d01d33113a9，apiBaseUrl 为 https://petscape3d.com/miniapp-api，mockMode=false。
- 实际运行时 request 域名数组只有 https://tcb-api.tencentcloudapi.com；发起无凭据健康请求同样返回 request:fail url not in domain list。未读取 Session、openid 或登录存储，未改写运行时白名单。
- 官方 network cache 清理、项目重开及工具完整重启后，当时仍复现白名单差异。原生窗口控制随后出现跨屏命中错误与截图窗口不符，停止代点；由用户在项目详情完成域名刷新。
- 脱敏 receipt 与模拟器截图位于仓库外 wechat-diagnostics/domain-review-20261116；最初的 receipt.json 保留刷新前结果，后续分别留存，不覆盖原始失败证据。

## 域名刷新与线上密钥修复

- 项目详情的 request 域名已显示 https://petscape3d.com；重启小程序运行环境后，实际 request 数组包含该域名与腾讯云默认域名，无凭据健康请求返回 200。项目 urlCheck 保持开启，mockMode 保持 false，未注入白名单。
- 继续登录返回 401 wechat_login_failed。诊断仅输出固定类别 invalid_secret，不输出微信原始 detail、code、openid 或 token；后台当前显示的密钥与此前配置不同，AppID 仍与客户端一致。
- 当前密钥同步至被 Git 忽略的项目根 .env，并通过既有专用 SSH 的标准输入传入服务器。服务器仅修改 /opt/petscape-miniapp/api.env 的 WECHAT_MINIPROGRAM_APP_SECRET，以原镜像重建独立 API 容器；保留旧容器与私有配置备份供回滚。
- 配置修复后，API 镜像仍为 9c07d9f2b8cfe9b015fd80a13cfb96879d345d84，健康检查 200 且 db=true。官网容器 ID、健康响应与 Nginx 文件校验和均与修复前一致；没有执行数据库迁移。
- 官方 SDK 调用实际 wx.login，使用本次微信 code 请求线上 /api/miniapp/auth/login：HTTP 200 且返回有效会话；携带该会话读取 /api/v1/pets：HTTP 200、pets 数量 0。随后调用页面原有 loadPets，loading=false、错误标题与诊断均为空，页面显示“还没有宠物档案”。未伪造账号、会话或业务响应。
- 这证明开发工具内真实微信服务与线上业务链路可用；不能替代手机扫码、手机创建档案或后台体验版验证。相应私有证据为 server-config-receipt.json、wechat-login-receipt.json、after-config-receipt.json 和 simulator-pets-after-config.png。
