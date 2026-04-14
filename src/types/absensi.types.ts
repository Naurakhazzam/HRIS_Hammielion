export type StatusKehadiran = 'Hadir' | 'Terlambat' | 'Alpha' | 'Izin' | 'Sakit' | 'Libur';

export interface AbsensiRecord {
  id: string;
  karyawanId: string;
  tanggal: string; // YYYY-MM-DD
  jamMasuk: string | null; // HH:mm:ss
  jamKeluar: string | null; // HH:mm:ss
  lat: number | null;
  lng: number | null;
  jarakMeter: number | null;
  status: StatusKehadiran;
  menitTerlambat: number;
  cabang: string;
  isPindahTugas?: boolean;
  catatan?: string;
}

export interface RekapAbsensi {
  karyawanId: string;
  totalHadir: number;
  totalTerlambat: number;
  totalAlpha: number;
  totalIzin: number;
  totalSakit: number;
  totalMenitTerlambat: number;
  bonusKedisiplinan: number;
  potonganTerlambat: number;
  potonganAlpha: number;
}

export interface JadwalShiftRecord {
  karyawanId: string;
  tanggal: string; // YYYY-MM-DD
  shiftId: string; // refer to useSettingsStore shifts
}
