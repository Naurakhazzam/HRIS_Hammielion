'use client';

import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Pencil, User, Briefcase, Landmark,
  Phone, Mail, MapPin, Calendar, CreditCard,
} from 'lucide-react';
import { useKaryawanStore } from '@/stores/useKaryawanStore';
import { formatTanggal, formatRupiah, getInisial } from '@/lib/utils/formatters';
import Button from '@/components/atoms/Button';
import Badge from '@/components/atoms/Badge';
import styles from './detail.module.css';

function statusVariant(status: string) {
  if (status === 'Aktif') return 'success';
  if (status === 'Kontrak') return 'warning';
  if (status === 'Nonaktif' || status === 'Resign' || status === 'PHK') return 'danger';
  return 'default';
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className={styles.infoRow}>
      <span className={styles.infoLabel}>{label}</span>
      <span className={styles.infoValue}>{value || <span className={styles.empty}>—</span>}</span>
    </div>
  );
}

export default function DetailKaryawanPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const { getKaryawanById } = useKaryawanStore();

  const k = getKaryawanById(id);

  if (!k) {
    return (
      <div className={styles.notFound}>
        <User size={48} style={{ opacity: 0.3 }} />
        <p>Karyawan tidak ditemukan.</p>
        <Button variant="secondary" onClick={() => router.push('/karyawan')}>
          Kembali ke Daftar
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          <ArrowLeft size={16} />
        </button>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Detail Karyawan</h1>
          <p className={styles.subtitle}>{k.nomorKaryawan}</p>
        </div>
        <Button onClick={() => router.push(`/karyawan/${k.id}/edit`)}>
          <Pencil size={14} />
          &nbsp;Edit Data
        </Button>
      </div>

      {/* Profile Hero */}
      <div className={styles.profileCard}>
        <div className={styles.avatar}>{getInisial(k.nama)}</div>
        <div className={styles.profileInfo}>
          <h2 className={styles.profileName}>{k.nama}</h2>
          <p className={styles.profileSub}>{k.jabatan} · {k.divisi} · {k.cabang}</p>
          <div className={styles.profileMeta}>
            <Badge variant={statusVariant(k.statusKaryawan) as 'success' | 'warning' | 'danger' | 'default'}>
              {k.statusKaryawan}
            </Badge>
            <span className={styles.metaSep} />
            <Calendar size={13} style={{ color: 'var(--color-text-muted)' }} />
            <span className={styles.metaText}>Masuk: {formatTanggal(k.tanggalMasuk)}</span>
            {k.tanggalKeluar && (
              <>
                <span className={styles.metaSep} />
                <span className={styles.metaText}>Keluar: {formatTanggal(k.tanggalKeluar)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        {/* ── Data Pribadi ── */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <User size={15} style={{ color: 'var(--color-primary)' }} />
            <span className={styles.cardTitle}>Data Pribadi</span>
          </div>
          <div className={styles.infoList}>
            <InfoRow label="NIK" value={k.nik} />
            <InfoRow label="Tempat Lahir" value={k.tempatLahir} />
            <InfoRow label="Tanggal Lahir" value={formatTanggal(k.tanggalLahir)} />
            <InfoRow label="Jenis Kelamin" value={k.jenisKelamin} />
            <InfoRow label="Agama" value={k.agama} />
          </div>
        </div>

        {/* ── Kontak ── */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <Phone size={15} style={{ color: 'var(--color-primary)' }} />
            <span className={styles.cardTitle}>Kontak & Alamat</span>
          </div>
          <div className={styles.infoList}>
            <InfoRow label="No. HP" value={k.noHp} />
            <InfoRow label="Email" value={k.email} />
            <div className={styles.infoRow} style={{ alignItems: 'flex-start' }}>
              <span className={styles.infoLabel}>Alamat</span>
              <span className={styles.infoValue}>{k.alamat}</span>
            </div>
          </div>
        </div>

        {/* ── Data Pekerjaan ── */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <Briefcase size={15} style={{ color: 'var(--color-primary)' }} />
            <span className={styles.cardTitle}>Data Pekerjaan</span>
          </div>
          <div className={styles.infoList}>
            <InfoRow label="Jabatan" value={k.jabatan} />
            <InfoRow label="Divisi" value={k.divisi} />
            <InfoRow label="Cabang" value={k.cabang} />
            <InfoRow label="Status" value={k.statusKaryawan} />
            <InfoRow label="Tgl Masuk" value={formatTanggal(k.tanggalMasuk)} />
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Gaji Pokok</span>
              <span className={`${styles.infoValue} ${styles.highlight}`}>
                {formatRupiah(k.gajiPokok)}
              </span>
            </div>
          </div>
        </div>

        {/* ── Legalitas & Bank ── */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <Landmark size={15} style={{ color: 'var(--color-primary)' }} />
            <span className={styles.cardTitle}>Legalitas &amp; Bank</span>
          </div>
          <div className={styles.infoList}>
            <InfoRow label="NPWP" value={k.npwp} />
            <InfoRow label="BPJS TK" value={k.noBpjsKetenagakerjaan} />
            <InfoRow label="BPJS Kes" value={k.noBpjsKesehatan} />
            <InfoRow label="Bank" value={k.namaBank} />
            <InfoRow label="No. Rekening" value={k.noRekeningBank} />
          </div>
        </div>

        {/* ── Catatan ── */}
        {k.catatan && (
          <div className={styles.card} style={{ gridColumn: '1 / -1' }}>
            <div className={styles.cardHeader}>
              <MapPin size={15} style={{ color: 'var(--color-warning)' }} />
              <span className={styles.cardTitle}>Catatan</span>
            </div>
            <p className={styles.catatanText}>{k.catatan}</p>
          </div>
        )}
      </div>
    </div>
  );
}
