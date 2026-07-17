# auth-tracer

ADR-0004 Phase B 前置验证：Better Auth + phone-number 插件 + Prisma adapter + Next.js 16 + 阿里云 PNVS 短信通道的兼容性 tracer。

**这是一次性验证探针，不是生产代码。** SQLite 只为验证框架闭环；PG 接入属 Phase B Step 2。

## 锁定的版本组合

| 包 | 版本 | 说明 |
|----|------|------|
| next | 16.2.10 | 对齐 web/package.json |
| better-auth | 1.6.23 | peerDeps 显式声明 `next: ^14 \|\| ^15 \|\| ^16`，Next 16 官方支持（issue #6439 已修） |
| @prisma/client / prisma | 6.19.3 | **不用 7.x**：Prisma 7 移除 schema 内 `url`，强制 `prisma.config.ts` + driver adapter，SQLite 需额外 adapter，摩擦大。BA peerDeps 支持 5/6/7，选 6 走经典路径 |
| @alicloud/dypnsapi20170525 | 2.0.0 | PNVS Node SDK（`SendSmsVerifyCode`） |
| @alicloud/openapi-client | 0.4.15 | 提供 `Config` |
| node | 24.7.0 | 与主仓一致 |

## 结论速览

- **Layer 1（不发真短信）：通过。** 完整登录闭环 send-otp → verify → 受保护路由读到当前 user；`next build` 生产构建 exit 0；`pnpm install` 无 peer 警告、**无需 `--legacy-peer-deps`**。
- **Layer 2（真通道）：凭证 + 通道可达已验证；卡在 PNVS 产品未开通。** API 明确返回 `isv.PRODUCT_UN_SUBSCRIPT`「未开通云通信产品」，说明鉴权已通过、只差开通短信产品 + 配置签名/模板（并行 agent 处理中）。

## 目录

```
app/
  api/auth/[...all]/route.ts   # Better Auth catch-all handler
  api/protected/route.ts       # 受保护路由：无 session 返回 401
  lib/auth.ts                  # betterAuth() 配置：prismaAdapter + phoneNumber 插件
  lib/prisma.ts                # PrismaClient 单例
  lib/sms.ts                   # sendOTP 通道分发：log（Layer1）/ pnvs（Layer2）
  lib/pnvs.ts                  # 阿里云 PNVS SendSmsVerifyCode 适配器
prisma/schema.prisma           # BA 核心 4 表 + phoneNumber/phoneNumberVerified 字段
scripts/
  login-loop.mjs               # Layer1 端到端登录闭环（带 Origin 头绕 CSRF）
  pnvs-send.mjs                # Layer2 单次真发探针（从主仓 .env 读凭证，不打印值）
  pnvs-retry.sh                # 未开通时每 5 分钟重试 × 6
logs/                          # 所有运行日志（gitignore）
```

## 重跑命令

```bash
cd tracer/auth-tracer

# 一次性准备
pnpm install
npx prisma generate
npx prisma db push --skip-generate      # 建 SQLite 表

# Layer 1：登录闭环 + 生产构建
pnpm build                              # 期望 exit 0
SMS_CHANNEL=log pnpm start > logs/server.log 2>&1 &   # 起生产服务(:3100)
node scripts/login-loop.mjs http://localhost:3100 "+8613800138000" logs/server.log
# 期望末行 LOGIN-LOOP-OK

# Layer 2：真发一条到 <REAL_TEST_PHONE>（PNVS 开通后）
# 先从 PNVS 控制台拿到签名名与验证码模板 code，再：
PNVS_SIGN_NAME='<真实签名>' PNVS_TEMPLATE_CODE='<真实模板code>' \
  node scripts/pnvs-send.mjs <REAL_TEST_PHONE> "$PNVS_SIGN_NAME" "$PNVS_TEMPLATE_CODE"
# 期望 PNVS-OK；收码闭环由用户手动确认

# PNVS 若仍未开通：轮询重试（每5分钟×6）
bash scripts/pnvs-retry.sh <REAL_TEST_PHONE>
```

凭证：`scripts/pnvs-send.mjs` 运行时从主仓 `../../.env`（PetScape-final/.env）读
`ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET`，不复制、不打印值。

## 踩坑与解法

1. **Prisma 7 破坏性变更**：schema 内 `url` 被移除 → 报 P1012。降到 Prisma 6.19.3（BA 支持范围内）走经典路径。
2. **本地相对 import 带 `.js` 后缀** → Next 打包 `Module not found`。改为无后缀 import。
3. **PNVS SDK ESM interop**：`.mjs` 里 default import 拿到的是 namespace 对象，client 类在 `.default` 层。防御式取 `typeof X==='function' ? X : X.default`。（webpack 侧 esModuleInterop 直接给类，app/lib/pnvs.ts 无需改，build 已过。）
4. **Better Auth CSRF**：curl 无 Origin 头 → send-otp 返回 403 `MISSING_OR_NULL_ORIGIN`。脚本 POST 补 `origin: baseURL`。
5. **@better-auth/cli 落后**（latest 1.4.21 vs better-auth 1.6.23）→ 不用 CLI 生成 schema，按 BA 文档手写 Prisma models，避免版本偏移。
