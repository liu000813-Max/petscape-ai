import type { Metadata } from 'next';
import { QuotesClient } from './QuotesClient';
import './quotes.css';

export const metadata: Metadata = {
  title: '沙箱测试报价 · PetScape',
  description: '生成并追踪 PetScape 沙箱测试报价。',
};

export default function QuotesPage() {
  return <QuotesClient />;
}
