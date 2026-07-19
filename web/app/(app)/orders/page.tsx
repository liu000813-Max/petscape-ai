import type { Metadata } from 'next';
import { OrdersClient } from './OrdersClient';
import './orders.css';

export const metadata: Metadata = {
  title: '沙箱订单 · PetScape',
  description: '查看沙箱支付生成的不可变测试订单与地址快照。',
};

export default function OrdersPage() { return <OrdersClient />; }
