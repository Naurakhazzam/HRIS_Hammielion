'use client';

import { Clock } from 'lucide-react';
import styles from '@/app/(dashboard)/coming-soon.module.css';

export default function Page() {
  return (
    <div className={styles.page}>
      <div className={styles.icon}><Clock size={40} /></div>
      <h2 className={styles.title}>Jadwal & Shift</h2>
      <p className={styles.desc}>Halaman ini sedang dalam pengembangan.</p>
    </div>
  );
}
