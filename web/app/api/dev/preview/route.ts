// web/app/api/dev/preview/route.ts —— dev-only 预览入口（WP-A1 验收辅助）。
//
// TODO(WP-A2 接线时移除)：OTP 真实接线后删除本路由与 session.ts 里的预览分支。
// 行为：非 production 下 GET 一次，种下 psx-preview cookie 并跳转 /account，
// (app) 受保护布局即以桩用户渲染；production 下恒 404，不构成鉴权绕过。
import { NextResponse } from 'next/server';
import { loadWebConfig } from '@petscape/server/infra/config';

export async function GET(req: Request) {
  let nodeEnv = 'production';
  try {
    nodeEnv = loadWebConfig().NODE_ENV;
  } catch {
    // 配置缺失时按 production 处理（禁用预览），与 session.ts 的策略一致。
  }
  if (nodeEnv === 'production') {
    return new NextResponse(null, { status: 404 });
  }
  // 相对 Location：dev server 可能绑 0.0.0.0，绝对 URL 会造成 cookie 域与跳转域不一致。
  const res = new NextResponse(null, { status: 307, headers: { Location: '/account' } });
  res.cookies.set('psx-preview', '1', { path: '/', httpOnly: true, sameSite: 'lax' });
  return res;
}
