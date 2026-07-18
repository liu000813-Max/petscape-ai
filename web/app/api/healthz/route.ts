import { NextResponse } from 'next/server';

// WP-2.5：最小活跃度探针，只证明 web 进程在跑，不查依赖（DB 连通性检查
// 是 WP-3.5 的范围，见 docs/plans/phase-b-execution-plan.md）。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true });
}
