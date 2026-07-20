import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '../../../lib/auth/session';
import { getWebServerContext } from '../../../lib/server-context';
import { AdminPaymentAttentionClient } from './AdminPaymentAttentionClient';
import './admin-payments.css';

export const metadata: Metadata = { title: '支付异常 · PetScape' };

export default async function AdminPaymentsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const user = await getWebServerContext().prisma.user.findUnique({
    where: { id: sessionUser.id }, select: { role: true },
  });
  if (user?.role !== 'admin') notFound();
  return <AdminPaymentAttentionClient />;
}
