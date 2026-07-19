import type { Metadata } from 'next';
import { ModelInspectionClient } from './ModelInspectionClient';

export const metadata: Metadata = {
  title: '3D 工作台 · PetScape',
  description: '检视并确认 PetScape 的测试 3D 模型。',
};

export default async function ViewerPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;
  return <ModelInspectionClient initialProjectId={projectId} />;
}
