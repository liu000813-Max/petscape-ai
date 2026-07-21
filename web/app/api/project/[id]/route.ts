import { NextResponse } from 'next/server';
import { getOrCreateProject } from '../../../lib/store/projects';
import { recoverProjectFromDisk } from '../../../lib/store/recoverProject';
import { missingRequiredFields } from '../../../lib/types/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/project/[id] → 全量状态（含 canvasItems、生成进度、缺哪些必填）
//
// WP-G1：项目身份（创建/恢复/越权隔离）已切到 v1（/api/v1/projects），本端点不再
// 承担这个角色——landing boot() 不再用它做项目发现。它仍是 vibe/avatar/avatar-slice
// 未迁段任务状态的唯一轮询源（EnvironmentPreviewSection/PetCreatorSection/
// ManufacturingSection/OrderFlowSection/RenderSection 消费），迁走前不能删除。
// id 惰性建镜像（v1 project 已存在但本地内存态还没有时不再 404，避免刚建的
// v1 项目首次轮询时被误判为「项目不存在」）；仍尝试 recoverProjectFromDisk 兜底
// 磁盘上已完成的 avatar 产物（历史行为，未改）。
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const recovered = await recoverProjectFromDisk(id);
  const project = recovered ?? getOrCreateProject(id);
  return NextResponse.json({ ...project, missing: missingRequiredFields(project.brief) });
}
