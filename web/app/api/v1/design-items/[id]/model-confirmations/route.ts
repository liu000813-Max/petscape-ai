import { NextResponse } from 'next/server';
import { createModelConfirmation, NotFoundError } from '@petscape/server/application';
import { CreateModelConfirmationRequestSchema, ModelConfirmationResponseSchema, SceneApiErrorSchema } from '@petscape/server/contracts/scenes';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json(SceneApiErrorSchema.parse({ error: 'unauthorized' }), { status: 401 });
    let json: unknown;
    try { json = await req.json(); } catch { return NextResponse.json(SceneApiErrorSchema.parse({ error: 'invalid_json' }), { status: 400 }); }
    const parsed = CreateModelConfirmationRequestSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json(SceneApiErrorSchema.parse({ error: 'invalid_request', issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message })) }), { status: 400 });
    try {
      const result = await createModelConfirmation({ prisma: getWebServerContext().prisma, ownerUserId: session.user.id, designItemId: (await params).id, input: parsed.data });
      return Object.assign(NextResponse.json(ModelConfirmationResponseSchema.parse(result), { status: 201 }), { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return Object.assign(NextResponse.json(SceneApiErrorSchema.parse({ error: 'not_found' }), { status: 404 }), { _loggedUserId: session.user.id });
      throw error;
    }
  });
}
