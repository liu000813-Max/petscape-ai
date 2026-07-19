import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '../../../lib/auth/session';
import { getWebServerContext } from '../../../lib/server-context';
import { AdminReviewsClient } from './AdminReviewsClient';
import './admin-reviews.css';

export const metadata: Metadata = { title: '沙箱审核台 · PetScape' };

export default async function AdminReviewsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const user = await getWebServerContext().prisma.user.findUnique({ where: { id: sessionUser.id }, select: { role: true } });
  if (user?.role !== 'admin') notFound();
  return <AdminReviewsClient />;
}
