import { NextResponse } from 'next/server';
import { listServiceProviders } from '@petscape/server/application';
import { ServiceProviderListResponseSchema } from '@petscape/server/contracts/community-content';
import { getWebServerContext } from '../../../lib/server-context';
import { withContentApi as withApiLogging } from '../../../lib/content-api';

export async function GET(req: Request) {
  return withApiLogging(req, async () => {
    const url = new URL(req.url);
    const providers = await listServiceProviders({ prisma: getWebServerContext().prisma, query: Object.fromEntries(url.searchParams.entries()) });
    return NextResponse.json(ServiceProviderListResponseSchema.parse({ providers }));
  });
}
