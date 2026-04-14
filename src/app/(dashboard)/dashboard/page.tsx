'use client';

import { useKaryawanStore } from '@/stores/useKaryawanStore';
import { formatRupiah, formatPeriode, getPeriodeAktif } from '@/lib/utils/formatters';
import { Users, CalendarCheck, Wallet, TrendingUp, Clock, AlertCircle } from 'lucide-react';
import styles from './dashboard.module.css';

export default function DashboardPage() {
  const { getKaryawanAktif, karyawan } = useKaryawanStore();
  const aktif = getKaryawanAktif();
  const periode = getPeriodeAktif();

  const stats = [
    {
      label: 'Total Karyawan Aktif',
      value: aktif.length,
      icon: Users,
      color: 'var(--color-primary)',
      bg: 'var(--color-primary-light)',
    },
    {
      label: 'Hadir Hari Ini',
      value: '—',
      icon: CalendarCheck,
      color: 'var(--color-success)',
      bg: 'var(--color-success-light)',
    },
    {
      label: 'Total Gaji Bulan Ini',
      value: formatRupiah(aktif.reduce((s, k) => s + k.gajiPokok, 0)),
      icon: Wallet,
      color: 'var(--color-info)',
      bg: 'var(--color-info-light)',
    },
    {
      label: 'Rata-rata KPI',
      value: '—',
      icon: TrendingUp,
      color: 'var(--color-warning)',
      bg: 'var(--color-warning-light)',
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.periodeBadge}>
        Periode Aktif: <strong>{formatPeriode(periode)}</strong>
        &nbsp;(Cut-off: 26 {formatPeriode(
          `${periode.split('-')[0]}-${String(parseInt(periode.split('-')[1]) - 1).padStart(2, '0')}`
        )} — 25 {formatPeriode(periode)})
      </div>

      {/* Stat Cards */}
      <div className={styles.statsGrid}>
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className={styles.statCard}>
              <div className={styles.statIcon} style={{ background: s.bg }}>
                <Icon size={20} style={{ color: s.color }} />
              </div>
              <div>
                <div className={styles.statValue}>{s.value}</div>
                <div className={styles.statLabel}>{s.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info Grid */}
      <div className={styles.infoGrid}>
        {/* Karyawan terbaru */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <Users size={16} style={{ color: 'var(--color-primary)' }} />
            <span className={styles.cardTitle}>Karyawan Terbaru</span>
          </div>
          <div className={styles.list}>
            {karyawan.slice(-4).reverse().map((k) => (
              <div key={k.id} className={styles.listItem}>
                <div className={styles.listDot} />
                <div>
                  <div className={styles.listName}>{k.nama}</div>
                  <div className={styles.listSub}>{k.jabatan} · {k.cabang}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pengingat */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <AlertCircle size={16} style={{ color: 'var(--color-warning)' }} />
            <span className={styles.cardTitle}>Pengingat</span>
          </div>
          <div className={styles.reminderList}>
            <div className={styles.reminder}>
              <Clock size={14} style={{ color: 'var(--color-warning)' }} />
              <span>Proses gaji periode {formatPeriode(periode)} belum dilakukan</span>
            </div>
            <div className={styles.reminder}>
              <Clock size={14} style={{ color: 'var(--color-info)' }} />
              <span>Input nilai KPI bulan ini belum lengkap</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
