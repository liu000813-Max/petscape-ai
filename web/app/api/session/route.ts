import { NextResponse } from 'next/server';
import { createSession } from '../../lib/store/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = createSession();
  return NextResponse.json(session, { status: 201 });
}
