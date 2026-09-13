/**
 * lib/psychotestLevels.ts
 * Konfigurasi tes hitung cepat (psikotes) — satu sumber kebenaran dipakai
 * bareng oleh halaman publik (app/lamaran/status) dan API
 * (app/api/lamaran/psikotes) supaya server bisa validasi input klien
 * benar-benar cocok dengan level yang sah, bukan direkayasa.
 */

export const PSYCHOTEST_PRACTICE = { min: 0, max: 9, durationSeconds: 30 }

export const PSYCHOTEST_LEVELS = [
  { level: 1, label: 'Level 1 — Mudah', min: 0, max: 10, durationSeconds: 120 },
  { level: 2, label: 'Level 2 — Menengah', min: 1, max: 20, durationSeconds: 120 },
  { level: 3, label: 'Level 3 — Sulit', min: 1, max: 100, durationSeconds: 120 },
] as const

export const PSYCHOTEST_PRAISE_THRESHOLD = 0.85

// Sanity cap per level (~0.6 detik/soal, generus) — dipakai server untuk
// menolak data yang jelas tidak masuk akal secara manusiawi.
export const PSYCHOTEST_MAX_PLAUSIBLE_QUESTIONS = 200
