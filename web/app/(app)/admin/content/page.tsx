import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '../../../lib/auth/session';
import { getWebServerContext } from '../../../lib/server-context';
import { AdminContentClient } from './AdminContentClient';
import './content.css';

export const metadata: Metadata = { title: '内容运营 · PETSCAPE' };

export default async function ContentPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const actor = await getWebServerContext().prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (actor?.role !== 'admin') notFound();
  return <AdminContentClient />;
}
