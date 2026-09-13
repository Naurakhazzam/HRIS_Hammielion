/**
 * lib/psychotestLevels.ts
 * Konfigurasi tes hitung cepat (psikotes) — satu sumber kebenaran dipakai
 * bareng oleh halaman publik (app/lamaran/status) dan API
 * (app/api/lamaran/psikotes) supaya server bisa validasi input klien
 * benar-benar cocok dengan level yang sah, bukan direkayasa.
 */

export const PSYCHOTEST_PRACTICE = { min: 0, max: 9, durationSeconds: 30 }

// `targetQuestions` = perkiraan awal jumlah soal yang wajar dikerjakan orang
// yang cukup cepat dalam 120 detik (dipakai untuk komponen kecepatan di
// skor, lihat scorePsikotesLevel di app/api/lamaran/psikotes/route.ts).
// Ini BUKAN standar baku — tidak ada standar internasional untuk ini, tes
// Kraepelin/Pauli asli pun pakai norma dari sampel populasi masing-masing
// lembaga. Angka di bawah sengaja dipasang cukup rendah (di bawah performa
// penguji internal yang sudah dicoba: 84/58/21) supaya pelamar dengan
// kecepatan wajar tetap dapat nilai penuh di komponen ini — sesuaikan lagi
// setelah cukup banyak pelamar asli mengerjakan tes ini.
export const PSYCHOTEST_LEVELS = [
  { level: 1, label: 'Level 1 — Mudah', min: 0, max: 10, durationSeconds: 120, targetQuestions: 40 },
  { level: 2, label: 'Level 2 — Menengah', min: 1, max: 20, durationSeconds: 120, targetQuestions: 25 },
  { level: 3, label: 'Level 3 — Sulit', min: 1, max: 100, durationSeconds: 120, targetQuestions: 12 },
] as const

export const PSYCHOTEST_PRAISE_THRESHOLD = 0.85

// Sanity cap per level (~0.6 detik/soal, generus) — dipakai server untuk
// menolak data yang jelas tidak masuk akal secara manusiawi.
export const PSYCHOTEST_MAX_PLAUSIBLE_QUESTIONS = 200
