import type { Metadata } from 'next';
import { CheckoutClient } from './CheckoutClient';
import './checkout.css';

export const metadata: Metadata = {
  title: '配送确认 · PetScape',
  description: '为已接受的沙箱测试报价填写并确认本次配送地址。',
};

export default function CheckoutPage() {
  return <CheckoutClient />;
}
