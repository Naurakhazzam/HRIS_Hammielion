/**
 * lib/psychotestLevels.ts
 * Konfigurasi tes hitung cepat (psikotes) — satu sumber kebenaran dipakai
 * bareng oleh halaman publik (app/lamaran/status) dan API
 * (app/api/lamaran/psikotes) supaya server bisa validasi input klien
 * benar-benar cocok dengan level yang sah, bukan direkayasa.
 */

export const PSYCHOTEST_PRACTICE = { min: 0, max: 9, durationSeconds: 30 }

// `targetQuestions` = patokan jumlah soal dalam 120 detik untuk dapat nilai
// PENUH di komponen kecepatan skor (lihat scorePsikotesLevel di
// app/api/lamaran/psikotes/route.ts). Tidak ada standar internasional baku
// untuk ini — tes Kraepelin/Pauli asli pun pakai norma dari sampel populasi
// masing-masing lembaga. Angka di bawah dipasang setara performa HR sendiri
// saat mencoba tes ini (88/60/40, dites langsung) — standar sengaja dibuat
// tinggi supaya skor benar-benar membedakan pelamar cepat & akurat dari yang
// sekadar cukup, alih-alih hampir semua orang mentok di 90-an. Sesuaikan
// lagi kalau ternyata terlalu berat setelah cukup banyak pelamar mencoba.
export const PSYCHOTEST_LEVELS = [
  { level: 1, label: 'Level 1 — Mudah', min: 0, max: 10, durationSeconds: 120, targetQuestions: 88 },
  { level: 2, label: 'Level 2 — Menengah', min: 1, max: 20, durationSeconds: 120, targetQuestions: 60 },
  { level: 3, label: 'Level 3 — Sulit', min: 1, max: 100, durationSeconds: 120, targetQuestions: 40 },
] as const

export const PSYCHOTEST_PRAISE_THRESHOLD = 0.85

// Sanity cap per level (~0.6 detik/soal, generus) — dipakai server untuk
// menolak data yang jelas tidak masuk akal secara manusiawi.
export const PSYCHOTEST_MAX_PLAUSIBLE_QUESTIONS = 200
