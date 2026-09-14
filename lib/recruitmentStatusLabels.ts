/**
 * lib/recruitmentStatusLabels.ts
 * Label status lamaran yang ramah untuk pelamar (nada beda dari label internal
 * HR di /rekrutmen) — dipakai di halaman cek status dan pesan error API publik.
 */
export const APPLICANT_STATUS_LABELS: Record<string, string> = {
  baru: 'Baru Masuk',
  screening: 'Sedang Diproses (Screening)',
  psikotes: 'Tahap Psikotes',
  interview: 'Menunggu Dipanggil Interview',
  training: 'Masa Training/Percobaan',
  diterima: 'Diterima',
  ditolak: 'Belum Berhasil Kali Ini',
}
