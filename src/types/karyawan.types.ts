import type { Jabatan, Divisi, StatusKaryawan, Cabang } from '@/lib/constants/roles';

export interface Karyawan {
  id: string;
  nomorKaryawan: string;  // format: HML-YYYY-NNN
  nama: string;
  nik: string;            // nomor KTP
  npwp?: string;
  noBpjsKetenagakerjaan?: string;
  noBpjsKesehatan?: string;
  tempatLahir: string;
  tanggalLahir: string;   // ISO date string
  jenisKelamin: 'Pria' | 'Wanita';
  agama?: string;
  alamat: string;
  noHp: string;
  email?: string;
  jabatan: Jabatan;
  divisi: Divisi;
  cabang: Cabang;
  statusKaryawan: StatusKaryawan;
  tanggalMasuk: string;   // ISO date string
  tanggalKeluar?: string;
  gajiPokok: number;
  noRekeningBank?: string;
  namaBank?: string;
  avatar?: string;
  catatan?: string;
  createdAt: string;
  updatedAt: string;
}

export type KaryawanFormInput = Omit<Karyawan, 'id' | 'nomorKaryawan' | 'createdAt' | 'updatedAt'>;
