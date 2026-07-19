import type { Metadata } from 'next';
import { PaymentsClient } from './PaymentsClient';
import './payments.css';
export const metadata: Metadata = { title: '沙箱支付 · PetScape', description: '验证可替换支付抽象，不会发生真实扣款。' };
export default function PaymentsPage() { return <PaymentsClient/>; }
