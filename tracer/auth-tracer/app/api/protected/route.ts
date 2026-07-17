import { auth } from "@/app/lib/auth";
import { NextResponse } from "next/server";

// Protected route: only returns the current user when a valid session exists.
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.user.id,
      phoneNumber: (session.user as { phoneNumber?: string }).phoneNumber ?? null,
      phoneNumberVerified:
        (session.user as { phoneNumberVerified?: boolean }).phoneNumberVerified ?? null,
    },
    sessionExpiresAt: session.session.expiresAt,
  });
}
