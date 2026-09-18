import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

const RETENTION_DAYS = 60

// ─── POST /api/attendance/cleanup-old-photos ────────────────────────────────
// Hapus foto absen (check-in/check-out) yang lebih tua dari RETENTION_DAYS —
// baik file di bucket 'attendance-photos' MAUPUN link-nya di kolom attendances,
// supaya tidak ada link mati yang nunjuk ke file yang sudah dihapus. Data jam
// masuk/pulang/telat/lembur di baris attendances TIDAK disentuh sama sekali,
// cuma kolom *_photo_url yang dikosongkan. Dipakai halaman Absensi > QR Absen
// (tombol manual) dan dipicu otomatis (dibatasi 1x/hari) dari Rekap Absensi.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: currentUser } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (!currentUser || !['owner', 'hr'].includes(currentUser.role)) {
    return NextResponse.json({ error: 'Forbidden — hanya owner/HR yang bisa membersihkan foto absen.' }, { status: 403 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  const { data: rows, error: fetchErr } = await admin
    .from('attendances')
    .select('id, check_in_photo_url, check_out_photo_url')
    .lt('date', cutoffStr)
    .or('check_in_photo_url.not.is.null,check_out_photo_url.not.is.null')

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!rows || rows.length === 0) return NextResponse.json({ deletedFiles: 0, clearedRows: 0 })

  // URL publik bentuknya .../storage/v1/object/public/attendance-photos/<path> — ambil path-nya saja.
  const extractPath = (url: string | null) => {
    if (!url) return null
    const marker = '/attendance-photos/'
    const idx = url.indexOf(marker)
    return idx === -1 ? null : url.substring(idx + marker.length)
  }

  const paths = rows.flatMap(r => [extractPath(r.check_in_photo_url), extractPath(r.check_out_photo_url)])
    .filter((p): p is string => !!p)

  if (paths.length > 0) {
    const { error: removeErr } = await admin.storage.from('attendance-photos').remove(paths)
    if (removeErr) return NextResponse.json({ error: removeErr.message }, { status: 500 })
  }

  const ids = rows.map(r => r.id)
  const { error: updateErr } = await admin
    .from('attendances')
    .update({ check_in_photo_url: null, check_out_photo_url: null })
    .in('id', ids)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ deletedFiles: paths.length, clearedRows: ids.length })
}
