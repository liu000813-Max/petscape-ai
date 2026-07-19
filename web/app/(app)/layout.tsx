// web/app/(app)/layout.tsx —— 登录后区域的受保护 server-side 布局（WP-A2）。
// /account 及未来应用页共享：读真实 session（getWebAuth），未登录 302 → /login。
import { redirect } from 'next/navigation';
import { getSessionUser, maskPhone } from '../lib/auth/session';
import { AppShell } from '../components/appshell/AppShell';
import { getWebServerContext } from '../lib/server-context';

export default async function AppAreaLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const role = await getWebServerContext().prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });

  return <AppShell user={{ phoneMasked: maskPhone(user.phoneNumber), isAdmin: role?.role === 'admin' }}>{children}</AppShell>;
}
