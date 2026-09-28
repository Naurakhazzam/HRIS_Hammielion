// Skema potongan "per kejadian" untuk kelompok Izin (Izin Duka/Periksa/Sakit-tanpa-surat) dan
// Alpha (mangkir + hari kosong tanpa keterangan di luar kuota). Beda dari Sakit-dengan-surat yang
// tetap per-hari-berturut (lihat SICK_DOC_TIER_MULTIPLIERS terpisah).
//
// "1 kejadian" = 1 kelompok tanggal yang BERSAMBUNG (consecutive dates) berstatus sama — bukan per
// leave_request, karena attendance tidak menyimpan referensi balik ke leave_requests.id. Kalau ada
// 2 pengajuan terpisah yang kebetulan tanggalnya bersambung, disederhanakan jadi 1 kejadian. Reset
// tiap periode (26-25) karena hitungannya memang cuma dari tanggal-tanggal dalam 1 periode yang
// dikirim ke fungsi ini.
export const IZIN_GROUP_MULTIPLIERS = [1, 1.25, 1.5, 1.75, 2]
export const ALPHA_GROUP_MULTIPLIERS = [1.5, 2, 2.25, 2.5, 2.75, 3]

// Karyawan TRAINING tidak kena eskalasi -- Izin/Sakit-tanpa-surat maupun Alpha dipotong FLAT
// 1x gaji harian per hari, kejadian ke berapa pun, karena mereka belum permanent. Dipakai lewat
// calcEscalatingDeduction() yang sama persis (cuma multiplier-nya selalu 1x, tidak pernah naik).
export const TRAINING_FLAT_MULTIPLIER = [1]

// Aturan-aturan potongan/denda BARU (eskalasi Izin/Alpha, denda Lupa Absen Masuk/Pulang, dst)
// cuma berlaku mulai periode yang DIMULAI tanggal ini -- periode SEBELUMNYA (termasuk 26 Agustus
// - 25 September 2026 yang penuh masalah data transisi fingerprint->QR) tetap dihitung FLAT 1x
// gaji harian per hari untuk semua jenis tidak-hadir (Izin/Sakit-tanpa-surat/Sakit-dengan-surat/
// Alpha), tanpa eskalasi dan tanpa denda administratif apa pun -- dikonfirmasi user, supaya
// periode transisi yang penuh bug tidak dihukum dengan aturan yang baru selesai diperbaiki
// belakangan. Bandingkan terhadap TANGGAL AKHIR periode (lastDay/period_end): periode yang
// berakhir SEBELUM tanggal ini dianggap "periode lama".
export const NEW_RULES_CUTOFF_DATE = '2026-09-26'

export type EscalatingBlock = { dates: string[]; occurrence: number; multiplier: number; subtotal: number }
export type EscalatingResult = { total: number; blocks: EscalatingBlock[] }

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Kelompokkan tanggal (YYYY-MM-DD) jadi blok-blok tanggal yang bersambung, urut kronologis. */
export function groupContiguousDates(dates: string[]): string[][] {
  const sorted = [...new Set(dates)].sort()
  const blocks: string[][] = []
  for (const d of sorted) {
    const last = blocks[blocks.length - 1]
    if (last && addDaysStr(last[last.length - 1], 1) === d) last.push(d)
    else blocks.push([d])
  }
  return blocks
}

/** Hitung potongan eskalasi per-kejadian (blok tanggal bersambung) dengan tabel pengali yang mentok di nilai terakhir. */
export function calcEscalatingDeduction(dates: string[], dailyRate: number, multipliers: number[]): EscalatingResult {
  const blocks = groupContiguousDates(dates)
  const result: EscalatingBlock[] = blocks.map((block, i) => {
    const multiplier = multipliers[Math.min(i, multipliers.length - 1)]
    return { dates: block, occurrence: i + 1, multiplier, subtotal: Math.round(block.length * dailyRate * multiplier) }
  })
  return { total: result.reduce((s, b) => s + b.subtotal, 0), blocks: result }
}
