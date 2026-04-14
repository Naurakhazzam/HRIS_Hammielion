'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/useAuthStore';
import Sidebar from '@/components/organisms/Sidebar';
import TopBar from '@/components/organisms/TopBar';
import styles from './dashboard.module.css';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) router.push('/login');
  }, [isAuthenticated, router]);

  if (!isAuthenticated) return null;

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <TopBar />
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
