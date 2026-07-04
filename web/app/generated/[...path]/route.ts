import { serveRuntimePublicFile } from '../../lib/runtimePublicFile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return serveRuntimePublicFile('generated', path, request.method);
}

export async function HEAD(request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return serveRuntimePublicFile('generated', path, request.method);
}
