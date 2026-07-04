import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { enqueueStageJob } from '../../../../lib/jobs/executor';
import { getSession, makeMessage } from '../../../../lib/store/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

async function parseBody(request: Request, sessionId: string) {
  const contentType = request.headers.get('content-type') || '';
  let text = '';
  let publicPath: string | undefined;
  let absPath: string | undefined;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    text = String(form.get('message') || form.get('text') || '').trim();
    const file = form.get('image');
    if (file instanceof File && file.size > 0) {
      if (!allowedImageTypes.has(file.type)) throw new Error('只支持 png/jpeg/webp/gif 图片');
      const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
      const dir = path.join(process.cwd(), 'public', 'generated', sessionId);
      await mkdir(dir, { recursive: true });
      const filename = `${Date.now()}-${randomUUID()}.${ext}`;
      absPath = path.join(dir, filename);
      await writeFile(absPath, Buffer.from(await file.arrayBuffer()));
      publicPath = `/generated/${sessionId}/${filename}`;
    }
  } else {
    const body = await request.json().catch(() => ({}));
    text = typeof body.message === 'string' ? body.message.trim() : typeof body.text === 'string' ? body.text.trim() : '';
  }
  return { text, publicPath, absPath };
}

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (session.pendingJob?.status === 'failed') delete session.pendingJob;
  if (session.pendingJob) return NextResponse.json({ error: '上一步进行中，请稍后再试', pendingJob: session.pendingJob }, { status: 409 });

  // 先占用 per-session 锁，再执行可能较慢的 multipart 解析/落盘，消除并发请求窗口。
  session.pendingJob = { type: 'agentReply', status: 'queued' };
  try {
    const { text, publicPath, absPath } = await parseBody(request, id);
    if (!text && !publicPath) {
      delete session.pendingJob;
      return NextResponse.json({ error: 'message 或 image 至少提供一个' }, { status: 400 });
    }
    if (publicPath) session.brief.photoPath = publicPath;
    session.messages.push(makeMessage('user', text || (publicPath ? '（上传了一张宠物照片）' : ''), publicPath));
    enqueueStageJob(id, text, absPath);
    return NextResponse.json({ ok: true, sessionId: id, pendingJob: session.pendingJob }, { status: 202 });
  } catch (error) {
    delete session.pendingJob;
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
