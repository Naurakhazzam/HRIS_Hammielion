import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HRIS Hammielion',
  description: 'Human Resource Information System — Hammielion Petshop',
};

import { Toaster } from 'react-hot-toast';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
