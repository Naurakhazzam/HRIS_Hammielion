// Dipakai bareng oleh halaman /signup (tab "Kode Karyawan Saja") dan
// app/api/signup/quick/route.ts, supaya preview email di form dan email yang
// beneran dibuat di server selalu identik — tidak ada jalur yang diam-diam beda rumus.
export function emailFromName(name: string): string {
  const local = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '.')
  return local ? `${local}@hammielion.com` : ''
}
