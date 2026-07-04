import { NextResponse } from 'next/server';
import { createProject } from '../../lib/store/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/project → 新建项目，返回 {id} + 全量状态
export async function POST() {
  const project = createProject();
  return NextResponse.json(project, { status: 201 });
}
