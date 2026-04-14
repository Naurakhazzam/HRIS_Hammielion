// ============================================================
// HRIS HAMMIELION — Formatter Utilities
// ============================================================

/**
 * Format angka menjadi format Rupiah
 * Contoh: 5000000 → "Rp 5.000.000"
 */
export function formatRupiah(nominal: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(nominal);
}

/**
 * Format tanggal ISO menjadi format Indonesia
 * Contoh: "2026-04-14" → "14 April 2026"
 */
export function formatTanggal(isoDate: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(isoDate));
}

/**
 * Format tanggal singkat
 * Contoh: "2026-04-14" → "14 Apr 2026"
 */
export function formatTanggalSingkat(isoDate: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(isoDate));
}

/**
 * Format periode YYYY-MM menjadi teks
 * Contoh: "2026-04" → "April 2026"
 */
export function formatPeriode(periode: string): string {
  const [year, month] = periode.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/**
 * Format menit ke jam dan menit
 * Contoh: 95 → "1 jam 35 menit"
 */
export function formatMenit(menit: number): string {
  if (menit === 0) return '0 menit';
  const jam = Math.floor(menit / 60);
  const sisaMenit = menit % 60;
  if (jam === 0) return `${sisaMenit} menit`;
  if (sisaMenit === 0) return `${jam} jam`;
  return `${jam} jam ${sisaMenit} menit`;
}

/**
 * Format persentase
 * Contoh: 85.5 → "85.5%"
 */
export function formatPersen(nilai: number, desimal = 1): string {
  return `${nilai.toFixed(desimal)}%`;
}

/**
 * Generate nomor karyawan
 * Format: HML-YYYY-NNN
 */
export function generateNomorKaryawan(tahun: number, urutan: number): string {
  const nomorUrut = String(urutan).padStart(3, '0');
  return `HML-${tahun}-${nomorUrut}`;
}

/**
 * Dapatkan periode aktif berdasarkan tanggal hari ini
 * Cut-off: tanggal 26 - 25 bulan berikutnya
 * Contoh: 14 April 2026 → periode "2026-04" (26 Mar - 25 Apr)
 */
export function getPeriodeAktif(): string {
  const today = new Date();
  const tanggal = today.getDate();
  const bulan = today.getMonth(); // 0-indexed
  const tahun = today.getFullYear();

  // Jika tanggal <= 25, periode adalah bulan ini
  // Jika tanggal >= 26, periode adalah bulan depan
  if (tanggal <= 25) {
    const m = String(bulan + 1).padStart(2, '0');
    return `${tahun}-${m}`;
  } else {
    const nextDate = new Date(tahun, bulan + 1, 1);
    const m = String(nextDate.getMonth() + 1).padStart(2, '0');
    return `${nextDate.getFullYear()}-${m}`;
  }
}

/**
 * Inisial nama (untuk avatar)
 * Contoh: "Budi Santoso" → "BS"
 */
export function getInisial(nama: string): string {
  return nama
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}
