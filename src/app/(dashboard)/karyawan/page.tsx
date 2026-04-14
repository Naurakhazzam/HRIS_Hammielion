'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Users, Eye, Pencil, UserX } from 'lucide-react';
import { useKaryawanStore } from '@/stores/useKaryawanStore';
import { CABANG_LIST, JABATAN_LIST } from '@/lib/constants/roles';
import { formatTanggal, getInisial } from '@/lib/utils/formatters';
import Button from '@/components/atoms/Button';
import Badge from '@/components/atoms/Badge';
import SearchBar from '@/components/molecules/SearchBar';
import SelectFilter from '@/components/molecules/SelectFilter';
import styles from './karyawan.module.css';

const STATUS_OPTIONS = [
  { label: 'Aktif', value: 'Aktif' },
  { label: 'Kontrak', value: 'Kontrak' },
  { label: 'Nonaktif', value: 'Nonaktif' },
];

const CABANG_OPTIONS = CABANG_LIST.map((c) => ({ label: c, value: c }));
const JABATAN_OPTIONS = JABATAN_LIST.map((j) => ({ label: j, value: j }));

function statusVariant(status: string) {
  if (status === 'Aktif') return 'success';
  if (status === 'Kontrak') return 'warning';
  return 'default';
}

export default function KaryawanPage() {
  const router = useRouter();
  const { karyawan, nonaktifkanKaryawan } = useKaryawanStore();

  const [search, setSearch]         = useState('');
  const [filterCabang, setCabang]   = useState('');
  const [filterJabatan, setJabatan] = useState('');
  const [filterStatus, setStatus]   = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return karyawan.filter((k) => {
      const matchSearch =
        !q ||
        k.nama.toLowerCase().includes(q) ||
        k.nomorKaryawan.toLowerCase().includes(q) ||
        k.noHp.includes(q);
      const matchCabang  = !filterCabang  || k.cabang  === filterCabang;
      const matchJabatan = !filterJabatan || k.jabatan === filterJabatan;
      const matchStatus  = !filterStatus  || k.statusKaryawan === filterStatus;
      return matchSearch && matchCabang && matchJabatan && matchStatus;
    });
  }, [karyawan, search, filterCabang, filterJabatan, filterStatus]);

  const totalAktif   = karyawan.filter((k) => k.statusKaryawan === 'Aktif').length;
  const totalKontrak = karyawan.filter((k) => k.statusKaryawan === 'Kontrak').length;
  const totalNonaktif = karyawan.filter((k) => k.statusKaryawan === 'Nonaktif').length;

  function handleNonaktifkan(id: string, nama: string) {
    if (confirm(`Nonaktifkan karyawan "${nama}"? Tindakan ini akan mencatat tanggal keluar hari ini.`)) {
      nonaktifkanKaryawan(id, new Date().toISOString().split('T')[0]);
    }
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Daftar Karyawan</h1>
          <p className={styles.subtitle}>Kelola data seluruh karyawan Hammielion Petshop</p>
        </div>
        <Button onClick={() => router.push('/karyawan/tambah')}>
          <UserPlus size={16} />
          &nbsp;Tambah Karyawan
        </Button>
      </div>

      {/* Stats Row */}
      <div className={styles.statsRow}>
        <div className={styles.statChip}>
          <Users size={14} />
          <span>Total: <strong>{karyawan.length}</strong></span>
        </div>
        <div className={styles.statChip}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block' }} />
          <span>Aktif: <strong>{totalAktif}</strong></span>
        </div>
        <div className={styles.statChip}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-warning)', display: 'inline-block' }} />
          <span>Kontrak: <strong>{totalKontrak}</strong></span>
        </div>
        <div className={styles.statChip}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-text-muted)', display: 'inline-block' }} />
          <span>Nonaktif: <strong>{totalNonaktif}</strong></span>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Cari nama, no. karyawan, HP..."
        />
        <SelectFilter
          value={filterStatus}
          onChange={setStatus}
          options={STATUS_OPTIONS}
          placeholder="Semua Status"
        />
        <SelectFilter
          value={filterCabang}
          onChange={setCabang}
          options={CABANG_OPTIONS}
          placeholder="Semua Cabang"
        />
        <SelectFilter
          value={filterJabatan}
          onChange={setJabatan}
          options={JABATAN_OPTIONS}
          placeholder="Semua Jabatan"
        />
      </div>

      {/* Table */}
      <div className={styles.card}>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Karyawan</th>
                <th>Jabatan</th>
                <th>Cabang</th>
                <th>No. HP</th>
                <th>Tgl Masuk</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className={styles.empty}>
                      <div className={styles.emptyIcon}><Users size={40} /></div>
                      <p className={styles.emptyText}>Tidak ada karyawan ditemukan</p>
                      <p className={styles.emptyDesc}>Coba ubah kata kunci pencarian atau filter</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <div className={styles.karyawanCell}>
                        <div className={styles.avatar}>{getInisial(k.nama)}</div>
                        <div>
                          <div className={styles.nama}>{k.nama}</div>
                          <div className={styles.noKaryawan}>{k.nomorKaryawan}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div>{k.jabatan}</div>
                      <div className={styles.subText}>{k.divisi}</div>
                    </td>
                    <td>{k.cabang}</td>
                    <td>{k.noHp}</td>
                    <td>{formatTanggal(k.tanggalMasuk)}</td>
                    <td>
                      <Badge variant={statusVariant(k.statusKaryawan) as 'success' | 'warning' | 'default'}>
                        {k.statusKaryawan}
                      </Badge>
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          className={styles.actionBtn}
                          title="Lihat detail"
                          onClick={() => router.push(`/karyawan/${k.id}`)}
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          className={styles.actionBtn}
                          title="Edit"
                          onClick={() => router.push(`/karyawan/${k.id}/edit`)}
                        >
                          <Pencil size={15} />
                        </button>
                        {k.statusKaryawan !== 'Nonaktif' && (
                          <button
                            className={`${styles.actionBtn} ${styles.danger}`}
                            title="Nonaktifkan"
                            onClick={() => handleNonaktifkan(k.id, k.nama)}
                          >
                            <UserX size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className={styles.footer}>
          Menampilkan {filtered.length} dari {karyawan.length} karyawan
        </div>
      </div>
    </div>
  );
}
