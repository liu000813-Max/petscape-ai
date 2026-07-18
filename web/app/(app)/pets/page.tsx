import type { Metadata } from 'next';
import { PetProfilesClient } from './PetProfilesClient';

export const metadata: Metadata = {
  title: '宠物档案 · PetScape',
  description: '管理 PetScape 的宠物设计输入档案。',
};

export default function PetsPage() {
  return <PetProfilesClient />;
}
