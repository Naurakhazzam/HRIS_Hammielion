export type JenisCuti =
  | 'Tahunan'
  | 'Sakit'
  | 'Melahirkan'
  | 'Duka'
  | 'Menikah'
  | 'Izin Khusus';

export type StatusCuti = 'Menunggu' | 'Disetujui' | 'Ditolak' | 'Dibatalkan';

export interface PengajuanCuti {
  id: string;
  karyawanId: string;
  jenisCuti: JenisCuti;
  tanggalMulai: string;   // ISO date
  tanggalSelesai: string; // ISO date
  jumlahHari: number;     // dihitung otomatis (tidak termasuk hari libur)
  alasan: string;
  status: StatusCuti;
  catatanManager?: string;
  disetujuiOleh?: string; // userId manager/admin
  createdAt: string;
  updatedAt: string;
}

export interface SaldoCuti {
  karyawanId: string;
  tahun: number;
  kuotaAwal: number;      // default: 12 hari/tahun
  terpakai: number;
  sisa: number;
  carryForward: number;   // dari tahun sebelumnya
}

export interface HariLibur {
  id: string;
  tanggal: string;        // ISO date
  nama: string;           // "Idul Fitri", "Tahun Baru"
  tipe: 'Nasional' | 'Perusahaan';
}
