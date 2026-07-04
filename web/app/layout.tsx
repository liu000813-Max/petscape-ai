import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PetScape',
  description: '自然语言到宠物造景 3D 打印 Demo',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
