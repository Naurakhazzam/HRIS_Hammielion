import type { Jabatan } from '@/lib/constants/roles';

// Indikator KPI per jabatan
export interface IndikatorKPI {
  id: string;
  jabatan: Jabatan;
  namaIndikator: string;
  deskripsi?: string;
  bobot: number;        // persentase bobot, total semua indikator = 100
  isAktif: boolean;
}

// Hasil checklist KPI per karyawan per bulan
export interface NilaiKPI {
  id: string;
  karyawanId: string;
  indikatorId: string;
  periode: string;      // "2026-04" (YYYY-MM)
  isChecked: boolean;   // apakah karyawan menyelesaikan indikator ini
  catatanAdmin?: string;
  diinputOleh: string;  // userId admin
  updatedAt: string;
}

// Hasil KPI bulanan per karyawan (dihitung otomatis)
export interface HasilKPI {
  karyawanId: string;
  periode: string;
  skorKPI: number;      // 0-100 (persentase)
  bonusNominal: number; // nominal bonus yang dicairkan
  detail: {
    indikatorId: string;
    namaIndikator: string;
    bobot: number;
    isChecked: boolean;
    kontribusi: number; // bobot jika checked, 0 jika tidak
  }[];
}

// Konfigurasi bonus KPI
export interface KonfigurasiBonus {
  id: string;
  jabatan: Jabatan;
  nominalBonus: number;   // nominal bonus jika KPI 100%
  // bonus = (skorKPI / 100) * nominalBonus
}

// Laporan kesalahan karyawan
export type KategoriKesalahan =
  | 'Administrasi'
  | 'Pelayanan Pelanggan'
  | 'Bongkar Muat'
  | 'Kerusakan Kendaraan'
  | 'Pelanggaran SOP'
  | 'Lainnya';

export type TingkatKesalahan = 'Ringan' | 'Sedang' | 'Berat';

export interface LaporanKesalahan {
  id: string;
  karyawanId: string;
  tanggal: string;
  kategori: KategoriKesalahan;
  tingkat: TingkatKesalahan;
  deskripsi: string;
  tindakan?: string;      // tindakan yang diambil
  diinputOleh: string;    // userId admin/manager
  createdAt: string;
}
