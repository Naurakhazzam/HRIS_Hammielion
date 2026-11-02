// Skema potongan "per kejadian" untuk kelompok Izin (Izin Duka/Periksa/Sakit-tanpa-surat) dan
// Alpha (mangkir + hari kosong tanpa keterangan di luar kuota). Beda dari Sakit-dengan-surat yang
// tetap per-hari-berturut (lihat SICK_DOC_TIER_MULTIPLIERS terpisah).
//
// "1 kejadian" = 1 kelompok tanggal yang BERSAMBUNG (consecutive dates) berstatus sama — bukan per
// leave_request, karena attendance tidak menyimpan referensi balik ke leave_requests.id. Kalau ada
// 2 pengajuan terpisah yang kebetulan tanggalnya bersambung, disederhanakan jadi 1 kejadian. Reset
// tiap periode (26-25) karena hitungannya memang cuma dari tanggal-tanggal dalam 1 periode yang
// dikirim ke fungsi ini.
//
// Tingkatan pengali NAIK PER HARI (bukan cuma per kejadian/blok) dan BERLANJUT antar kejadian dalam
// periode yang sama -- tidak reset ke tingkat 1 tiap kejadian baru. Jadi 1 kejadian 2 hari
// berturut sudah memakai tingkat 1 & 2, lalu kejadian berikutnya lanjut dari tingkat 3, dst.
// (dikonfirmasi user lewat AskUserQuestion, Oktober 2026). Diimplementasikan dengan 1 "kursor hari"
// yang jalan terus menerus lintas semua kejadian/blok dalam tanggal yang dikirim ke fungsi ini.
//
// Mulai periode Oktober 2026 (26 Sep - 25 Okt) Izin/Sakit-tanpa-surat dan Alpha memakai tabel
// pengali yang SAMA: 1.5x, naik 0.2x per hari, mentok 2x (keputusan Owner, November 2026).
// Penghitungnya tetap terpisah: Izin+Sakit-tanpa-surat 1 hitungan, Alpha 1 hitungan sendiri.
// Periode sebelumnya tidak terpengaruh -- semuanya berakhir sebelum NEW_RULES_CUTOFF_DATE (flat 1x).
// CATATAN (migrasi 118): angka yang benar-benar dipakai sekarang diatur Owner/HR di menu Potongan &
// Lembur (tabel payroll_rules, lib/payrollRules.ts). Konstanta di bawah tinggal nilai bawaan/referensi.
export const ABSENCE_MULTIPLIERS = [1.5, 1.7, 1.9, 2]
export const IZIN_GROUP_MULTIPLIERS = ABSENCE_MULTIPLIERS
export const ALPHA_GROUP_MULTIPLIERS = ABSENCE_MULTIPLIERS

// Izin Mendadak -- izin TANPA pemberitahuan H-2 (dadakan, atau diajukan mundur setelah hari itu
// lewat). Sengaja dipisah dari IZIN_GROUP_MULTIPLIERS (yang untuk Izin/Sakit-tanpa-surat/Duka
// yang terencana) dan dari ALPHA_GROUP_MULTIPLIERS (Alpha tanpa keterangan sama sekali) -- lebih
// berat dari Izin biasa (karena dadakan = kurang disiplin), tapi lebih ringan dari Alpha penuh
// (karena tetap ada keterangan/pengajuan, bukan diam saja). Reset tiap periode, per kejadian
// (blok tanggal bersambung).
// Mulai periode Oktober 2026 disamakan dengan Izin biasa (ABSENCE_MULTIPLIERS) atas keputusan
// Owner, supaya izin dadakan tidak lebih murah dari izin biasa. Hitungan harinya tetap sendiri.
export const SUDDEN_PERMISSION_MULTIPLIERS = ABSENCE_MULTIPLIERS

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

export type EscalatingDay = { date: string; tier: number; multiplier: number; amount: number }
// `multiplier` tetap pengali hari PERTAMA di blok ini (dipertahankan demi kompatibilitas tampilan
// lama) -- lihat `days` untuk pengali per-hari yang sesungguhnya dipakai menghitung `subtotal`.
export type EscalatingBlock = { dates: string[]; occurrence: number; multiplier: number; subtotal: number; days: EscalatingDay[] }
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

/**
 * Hitung potongan eskalasi per-hari (tabel pengali yang mentok di nilai terakhir), dikelompokkan
 * jadi blok-blok kejadian (tanggal bersambung) untuk tampilan -- tingkatannya jalan terus lintas
 * blok, tidak reset tiap kejadian baru.
 */
export function calcEscalatingDeduction(dates: string[], dailyRate: number, multipliers: number[]): EscalatingResult {
  const blocks = groupContiguousDates(dates)
  let dayCursor = 0
  const result: EscalatingBlock[] = blocks.map((block, i) => {
    const days: EscalatingDay[] = block.map(date => {
      const tier = dayCursor
      const multiplier = multipliers[Math.min(tier, multipliers.length - 1)]
      dayCursor += 1
      return { date, tier: tier + 1, multiplier, amount: Math.round(dailyRate * multiplier) }
    })
    const subtotal = days.reduce((s, d) => s + d.amount, 0)
    return { dates: block, occurrence: i + 1, multiplier: days[0].multiplier, subtotal, days }
  })
  return { total: result.reduce((s, b) => s + b.subtotal, 0), blocks: result }
}
