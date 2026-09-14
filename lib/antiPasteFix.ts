/**
 * lib/antiPasteFix.ts
 * Waktu commit yang menutup celah bypass anti-paste (lib/noPaste.ts, cek
 * addedLength di luar InputEvent.inputType) sampai live di production.
 * Dipakai HR di /rekrutmen/pelamar untuk menandai jawaban screening yang
 * diisi SEBELUM perbaikan ini (masih mungkin lolos tempel dari WebView yang
 * tidak mengirim inputType, mis. browser dalam-aplikasi WhatsApp) vs SESUDAH
 * (sudah dua lapis proteksi). Dilebihkan beberapa menit dari waktu commit
 * (11:13 WIB) untuk jaga-jaga waktu deploy ke production.
 */
export const ANTI_PASTE_FIX_DEPLOYED_AT = '2026-09-14T04:20:00Z'

export function isBeforeAntiPasteFix(createdAt: string): boolean {
  return new Date(createdAt).getTime() < new Date(ANTI_PASTE_FIX_DEPLOYED_AT).getTime()
}
