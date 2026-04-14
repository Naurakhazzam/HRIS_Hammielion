// ============================================================
// Tipe data untuk modul Driver & Ritase
// 3 jenis mobil × 4 jenis rute = 12 kombinasi harga
// ============================================================

export type JenisMobil = 'Mobil A' | 'Mobil B' | 'Mobil C';
export type JenisRute  = 'Rute 1' | 'Rute 2' | 'Rute 3' | 'Rute 4';

// Tabel harga ritase (dikonfigurasi di Pengaturan > Master Ritase)
export interface TarifRitase {
  id: string;
  jenisMobil: JenisMobil;
  jenisRute: JenisRute;
  hargaDriver: number;   // bayaran driver per trip
  hargaKenek: number;    // bayaran kenek per trip (bonus)
}

// Setiap trip yang tercatat
export interface CatatanRitase {
  id: string;
  tanggal: string;          // ISO date
  driverId: string;         // karyawanId driver
  kenekId?: string;         // karyawanId kenek (opsional)
  jenisMobil: JenisMobil;
  jenisRute: JenisRute;
  hargaDriver: number;      // snapshot harga saat trip
  hargaKenek: number;       // snapshot harga saat trip
  keterangan?: string;
  diinputOleh: string;      // userId admin
  createdAt: string;
}

// Rekap ritase per karyawan per periode
export interface RekapRitase {
  karyawanId: string;
  periode: string;          // "2026-04"
  totalTrip: number;
  totalPendapatan: number;  // total bayaran ritase
  detailPerMobil: {
    jenisMobil: JenisMobil;
    jenisRute: JenisRute;
    jumlahTrip: number;
    subtotal: number;
  }[];
}

// Performa driver (input manual + otomatis)
export interface PerformaDriver {
  id: string;
  driverId: string;
  periode: string;
  nilaiAbsensi: number;           // 0-100, otomatis dari absensi
  nilaiKepedulianKendaraan: number; // 0-100, input manual
  jumlahKesalahan: number;          // otomatis dari laporan kesalahan
  totalTrip: number;                // otomatis dari catatan ritase
  skorAkhir: number;                // rata-rata tertimbang
  catatan?: string;
}
