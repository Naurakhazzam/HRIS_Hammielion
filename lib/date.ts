/**
 * Ambil tanggal kalender LOKAL sebagai string "YYYY-MM-DD".
 *
 * Jangan pakai `date.toISOString().split('T')[0]` untuk ini — toISOString
 * mengonversi ke UTC dulu, yang menggeser tanggal mundur 1 hari untuk zona
 * waktu di depan UTC (WIB/WITA/WIT semuanya UTC+7/+8/+9), terutama untuk
 * waktu dini hari. Fungsi ini murni baca field tanggal lokal (getFullYear/
 * getMonth/getDate), jadi selalu cocok dengan tanggal yang dilihat user.
 */
export function localDateStr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Tanggal hari ini (kalender lokal), format "YYYY-MM-DD". */
export function todayLocalStr(): string {
  return localDateStr(new Date())
}
