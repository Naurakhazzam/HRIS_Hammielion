import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HRIS Hammielion',
  description: 'Human Resource Information System — Hammielion Petshop',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
