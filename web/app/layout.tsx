import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TinyHabitat AI',
  description: '为爱宠定制，把想象打印成家。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
