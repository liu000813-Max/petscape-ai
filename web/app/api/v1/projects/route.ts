// web/app/api/v1/projects/route.ts —— 项目创建/列表（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2。薄层：鉴权 + 参数解析 + 调用
// application 用例，不含业务逻辑。挂 WP-3.1 的 session 鉴权（getWebAuth）。
//
// 不动现有 `/api/project` 原型路由——本文件是独立的正式 v1 路由。
import { NextResponse } from 'next/server';
import { getMiniappAwareSession } from '../../../lib/miniapp-auth';
import { getWebServerContext, withApiLogging } from '../../../lib/server-context';
import { createProject, listProjects } from '@petscape/server/application';

export async function POST(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    let body: { title?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      // 空 body 也允许（title 可空）。
    }
    const title = typeof body.title === 'string' ? body.title : undefined;

    const { prisma } = getWebServerContext();
    const project = await createProject({ prisma, ownerUserId: session.user.id, title });
    const res = NextResponse.json(project, { status: 201 });
    return Object.assign(res, { _loggedUserId: session.user.id });
  });
}

export async function GET(req: Request) {
  return withApiLogging(req, async () => {
    const session = await getMiniappAwareSession(req);
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { prisma } = getWebServerContext();
    const projects = await listProjects({ prisma, ownerUserId: session.user.id });
    const res = NextResponse.json({ projects });
    return Object.assign(res, { _loggedUserId: session.user.id });
  });
}
