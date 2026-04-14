export type StatusAbsensi =
  | 'Hadir'
  | 'Terlambat'
  | 'Izin'
  | 'Sakit'
  | 'Alpha'
  | 'Cuti'
  | 'Libur'
  | 'Lembur';

export type JenisShift = 'Pagi' | 'Siang' | 'Libur';

export interface Absensi {
  id: string;
  karyawanId: string;
  tanggal: string;          // ISO date string
  shift: JenisShift;
  jamMasuk?: string;        // "08:05"
  jamKeluar?: string;       // "16:30"
  status: StatusAbsensi;
  menitTerlambat: number;   // 0 jika tepat waktu
  jamLembur: number;        // dalam jam, 0 jika tidak lembur
  isManualInput: boolean;   // true jika diinput manual oleh admin
  catatanAdmin?: string;
  lokasiLat?: number;       // geofencing
  lokasiLng?: number;
  createdAt: string;
}

export interface JadwalShift {
  id: string;
  karyawanId: string;
  tanggal: string;
  shift: JenisShift;
  jamMulai: string;   // "08:00"
  jamSelesai: string; // "16:00"
}

export interface RekapAbsensi {
  karyawanId: string;
  periode: string;        // "2026-04" (YYYY-MM)
  totalHadir: number;
  totalTerlambat: number;
  totalMenitTerlambat: number;
  totalIzin: number;
  totalSakit: number;
  totalAlpha: number;
  totalLembur: number;    // dalam jam
  bonusKedisiplinan: boolean; // true jika total menit < 30
}

// Aturan absensi (dikonfigurasi di Pengaturan)
export interface AturanAbsensi {
  potonganPerMenit: number;      // default: 1500
  batasTelatBonusDisiplin: number; // default: 30 menit
  nominalBonusDisiplin: number;  // default: 150000
  potonganTidakAbsen: number;    // default: 75000
  radiusGeofencing: number;      // default: 100 meter
  jamMulaiPagi: string;          // "08:00"
  jamMulaiSiang: string;         // "12:00"
}
