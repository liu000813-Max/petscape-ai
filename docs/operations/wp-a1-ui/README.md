# WP-A1 UI 验收截图（App 壳 + 登录/注册页 + 账户页首版）

环境说明：

- `login-step1-phone.png` / `login-step2-otp.png` / `landing-full-regression-check.png`：production 模式（`pnpm build && next start`）。
- `account-preview.png` 及其余：dev 模式。原因：预览桩按设计只在非 production 生效
  （`/api/dev/preview` 在 production 恒 404，不构成鉴权绕过），两种模式共享同一份 CSS，视觉一致。
- 预览桩入口：dev 下访问 `/api/dev/preview` 种 cookie 后跳 `/account`；WP-A2 接线时随
  `session.ts` 预览分支一并移除（各处已标 TODO）。

回归对照：`landing-full-regression-check.png` 对照 `../wp-2-1-landing-check/baseline-origin-main.png`，
全部 section 顺序与布局一致；唯一预期差异是右上角新增「登录」入口（见 `landing-top-login-entry.png`）。

行为断言（production，无 cookie）：

```
$ curl -sI localhost:3000/account | grep -i 'HTTP/\|location'
HTTP/1.1 307 Temporary Redirect
location: /login
```

（Next.js App Router 的 `redirect()` 语义固定为 307 临时重定向，等价满足「未登录跳转 /login」；
计划文字里写的 302 以此为准修正。）
