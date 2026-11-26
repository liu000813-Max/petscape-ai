import { readCommunityPhoto } from '@petscape/server/application';
import { getMiniappAwareSession } from '../../../../../../../lib/miniapp-auth';
import { getWebServerContext } from '../../../../../../../lib/server-context';
import { withContentApi } from '../../../../../../../lib/content-api';

export async function GET(req: Request, route: { params: Promise<{ id: string; assetId: string }> }) {
  const response = await withContentApi(req, async () => {
    const { id, assetId } = await route.params;
    const context = getWebServerContext();
    const session = await getMiniappAwareSession(req);
    const { bytes, mime } = await readCommunityPhoto({ prisma: context.prisma, get oss() { return context.oss; },
      postId: id, assetId, userId: session?.user.id });
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff' } });
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
