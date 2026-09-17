// "Preview Tampilan Karyawan" — bukan impersonasi sungguhan (RLS tetap mengikuti role akun
// yang benar-benar login, tidak bisa dipalsukan dari client), cuma memaksa Sidebar & halaman
// Portal untuk tampil sebagai versi karyawan, supaya admin bisa cek menu/layout tanpa perlu
// login-logout. Disimpan sebagai cookie (bukan sessionStorage) supaya Server Component
// (Dashboard) juga bisa membacanya, bukan cuma client component.
const COOKIE_NAME = 'previewAsEmployee'

export function isPreviewModeClient(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.split('; ').includes(`${COOKIE_NAME}=true`)
}

export function setPreviewMode(on: boolean) {
  if (typeof document === 'undefined') return
  document.cookie = on
    ? `${COOKIE_NAME}=true; path=/; max-age=86400`
    : `${COOKIE_NAME}=; path=/; max-age=0`
}
