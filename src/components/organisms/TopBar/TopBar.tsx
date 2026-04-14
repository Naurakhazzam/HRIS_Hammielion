'use client';

import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { NAV } from '@/lib/constants/navigation';
import { useAuthStore } from '@/stores/useAuthStore';
import styles from './TopBar.module.css';

function getPageTitle(pathname: string): string {
  for (const item of NAV) {
    if (pathname === item.basePath && item.subs.length === 0) return item.label;
    for (const sub of item.subs) {
      if (pathname === sub.path) return sub.label;
    }
    if (pathname.startsWith(item.basePath) && item.subs.length === 0) return item.label;
  }
  if (pathname === '/dashboard') return 'Dashboard';
  return 'HRIS Hammielion';
}

export default function TopBar() {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const title = getPageTitle(pathname);

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <h1 className={styles.title}>{title}</h1>
      </div>
      <div className={styles.right}>
        <button className={styles.notifBtn}>
          <Bell size={18} />
        </button>
        <div className={styles.greeting}>
          Halo, <strong>{user?.nama?.split(' ')[0]}</strong>
        </div>
      </div>
    </header>
  );
}
