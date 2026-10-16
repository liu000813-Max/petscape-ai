import { NextResponse } from 'next/server';
import { NotFoundError, AdminRequiredError } from '@petscape/server/application';
import { ContentValidationError } from '@petscape/server/contracts/community-content';
import { logError } from '@petscape/server/infra/logging';
import { withApiLogging, type ApiRequestContext } from './server-context';

/** Content errors return a stable code and request ID; details remain in the server log. */
export function withContentApi(req: Request, handler: (context: ApiRequestContext) => Promise<Response & { _loggedUserId?: string }>) {
  return withApiLogging(req, async (context) => {
    try { return await handler(context); }
    catch (error) {
      if (error instanceof ContentValidationError) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
      if (error instanceof SyntaxError) return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
      if (error instanceof NotFoundError) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      if (error instanceof AdminRequiredError) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') return NextResponse.json({ error: 'conflict' }, { status: 409 });
      logError('content.api.error', { requestId: context.requestId, err: error });
      return NextResponse.json({ error: 'internal_error', requestId: context.requestId }, { status: 500 });
    }
  });
}
