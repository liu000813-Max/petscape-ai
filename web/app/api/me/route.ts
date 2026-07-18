// web/app/api/me/route.ts —— 受保护路由演示（WP-3.1 验收 1 的行为落点）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.1。
// 有有效 Session 返回 userId；无 Session 返回 401。
import { getWebAuth } from '../../lib/auth';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const session = await getWebAuth().api.getSession({ headers: req.headers });

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    userId: session.user.id,
  });
}
