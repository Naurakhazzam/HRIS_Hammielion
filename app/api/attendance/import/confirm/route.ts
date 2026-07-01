import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// ─── POST /api/attendance/import/confirm ────────────────────────────────────
// Menerima array records hasil parse, upsert ke tabel attendances.
// Skip duplikat (employee_id + date sudah ada).

export async function POST(req: NextRequest) {
  // Auth check via user session
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: currentUser } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (!currentUser || !['owner', 'hr'].includes(currentUser.role)) {
    return NextResponse.json({ error: 'Forbidden — hanya owner/HR yang bisa import absensi.' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const records: any[] = body.records ?? []
    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: 'Tidak ada records untuk diimpor.' }, { status: 400 })
    }

    // Gunakan service role agar bisa bypass RLS
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Upsert dengan ignoreDuplicates — baris yang sudah ada dibiarkan
    const { data, error } = await adminClient
      .from('attendances')
      .upsert(records, { onConflict: 'employee_id,date', ignoreDuplicates: true })
      .select('id')

    if (error) {
      console.error('[import/confirm]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const inserted = data?.length ?? 0
    const skipped  = records.length - inserted

    return NextResponse.json({ success: true, inserted, skipped, total: records.length })

  } catch (err: any) {
    console.error('[import/confirm]', err)
    return NextResponse.json({ error: err.message ?? 'Terjadi kesalahan.' }, { status: 500 })
  }
}
