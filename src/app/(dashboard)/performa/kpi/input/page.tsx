'use client';

import { CheckSquare } from 'lucide-react';
import styles from '@/app/(dashboard)/coming-soon.module.css';

export default function Page() {
  return (
    <div className={styles.page}>
      <div className={styles.icon}><CheckSquare size={40} /></div>
      <h2 className={styles.title}>Input Nilai KPI</h2>
      <p className={styles.desc}>Halaman ini sedang dalam pengembangan.</p>
    </div>
  );
}
