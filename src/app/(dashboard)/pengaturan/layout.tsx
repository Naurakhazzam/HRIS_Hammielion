'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings, Clock, CreditCard, Map, Shield } from 'lucide-react';
import styles from './settings.module.css';

const NAV_ITEMS = [
  { label: 'Aturan Kerja', path: '/pengaturan/aturan-kerja', icon: Map },
  { label: 'Jadwal Shift', path: '/pengaturan/jadwal-shift', icon: Clock },
  { label: 'Komponen Gaji', path: '/pengaturan/komponen-gaji', icon: CreditCard },
  { label: 'Master Ritase', path: '/pengaturan/master-ritase', icon: Settings },
  { label: 'User & Akses', path: '/pengaturan/user-akses', icon: Shield },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Pengaturan Sistem</h1>
        <p className={styles.subtitle}>Konfigurasi aturan bisnis, shift, dan parameter operasional.</p>
      </header>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`${styles.navItem} ${isActive ? styles.active : ''}`}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <main className={styles.content}>
        {children}
      </main>
    </div>
  );
}
