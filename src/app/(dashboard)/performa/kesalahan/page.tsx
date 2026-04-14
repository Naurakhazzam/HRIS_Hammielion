'use client';

import { AlertTriangle } from 'lucide-react';
import styles from '@/app/(dashboard)/coming-soon.module.css';

export default function Page() {
  return (
    <div className={styles.page}>
      <div className={styles.icon}><AlertTriangle size={40} /></div>
      <h2 className={styles.title}>Laporan Kesalahan</h2>
      <p className={styles.desc}>Halaman ini sedang dalam pengembangan.</p>
    </div>
  );
}
