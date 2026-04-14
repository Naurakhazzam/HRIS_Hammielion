// ============================================================
// Tipe data untuk modul Penggajian
// Cut-off: tanggal 26 bulan ini s/d 25 bulan depan
// ============================================================

export interface KomponenGaji {
  id: string;
  nama: string;             // "Tunjangan Transport"
  tipe: 'pendapatan' | 'potongan';
  isDefault: boolean;       // true = otomatis untuk semua karyawan
  kenaiBPJS: boolean;
  kenaPajak: boolean;
}

// Tunjangan per karyawan (dikonfigurasi di master karyawan)
export interface TunjanganKaryawan {
  karyawanId: string;
  komponenId: string;
  nominal: number;
}

// Slip gaji per karyawan per periode
export interface SlipGaji {
  id: string;
  karyawanId: string;
  periode: string;          // "2026-04" (cut-off April: 26 Mar - 25 Apr)
  tanggalProses: string;

  // Pendapatan
  gajiPokok: number;
  tunjangan: { nama: string; nominal: number }[];
  bonusKedisiplinan: number;  // 150rb jika lolos syarat
  bonusKPI: number;           // dari hasil KPI
  bonusRitase: number;        // khusus driver/kenek
  totalPendapatan: number;

  // Potongan
  potonganTerlambat: number;  // menit × 1500
  potonganTidakAbsen: number; // kejadian × 75000
  potonganMinusKasir: number;
  potonganKehilangan: number;
  potonganBpjsTk: number;     // BPJS Ketenagakerjaan karyawan
  potonganBpjsKes: number;    // BPJS Kesehatan karyawan
  potonganPph21: number;
  totalPotongan: number;

  // Take Home Pay
  thp: number;                // totalPendapatan - totalPotongan

  status: 'draft' | 'final';
  diproseOleh: string;
}

// Minus kasir (input per kejadian)
export interface MinusKasir {
  id: string;
  kasirId: string;
  tanggal: string;
  shift: 'Pagi' | 'Siang';
  nominal: number;
  keterangan?: string;
  periode: string;          // "2026-04"
  diinputOleh: string;
  createdAt: string;
}

// Kehilangan barang (input per kejadian)
export interface KehilanganBarang {
  id: string;
  cabang: string;
  tanggal: string;
  namaBarang: string;
  nilaiBarang: number;
  karyawanTerdampak: {
    karyawanId: string;
    persentaseTanggung: number; // misal: 50%
    nominal: number;
  }[];
  periode: string;
  diinputOleh: string;
  createdAt: string;
}
