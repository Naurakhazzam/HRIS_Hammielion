// "Preview Tampilan Karyawan" — bukan impersonasi sungguhan (RLS tetap mengikuti role akun
// yang benar-benar login, tidak bisa dipalsukan dari client), cuma memaksa Sidebar & halaman
// Portal untuk tampil sebagai versi karyawan, supaya admin bisa cek menu/layout tanpa perlu
// login-logout. Disimpan sebagai cookie (bukan sessionStorage) supaya Server Component
// (Dashboard) juga bisa membacanya, bukan cuma client component.
//
// Data yang ditampilkan selama preview memakai employee sungguhan (PREVIEW_EMPLOYEE_ID), BUKAN
// employee_id akun admin yang sedang login — permintaan Owner supaya preview lebih representatif
// (data admin sendiri biasanya kosong/tidak lengkap). Karena RPC tulis (mis. update_own_employee_profile,
// submit_roster_picks) tetap menyasar employee_id akun login sungguhan (bukan employee ini), semua
// halaman Portal WAJIB menonaktifkan tombol submit/aksi saat mode ini aktif — lihat pemakaian
// isPreviewModeClient() di tiap halaman portal/*.
const COOKIE_NAME = 'previewAsEmployee'

// Rahmat Saleh (EMP-013) — dipilih Owner sebagai contoh nyata karena datanya paling lengkap.
export const PREVIEW_EMPLOYEE_ID = 'cf535bc0-a476-4f1c-a881-22986c1360d4'

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
