import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { emailFromName } from '@/lib/emailFromName'

// Self-service "Perbarui Akun Saya" — dipakai SEMUA role (owner/hr/finance/supervisor/employee)
// untuk pindah ke email standar nama@hammielion.com + set ulang password sendiri (diketik ulang
// sendiri, bukan dibuatkan admin, sesuai permintaan Owner supaya karyawan tidak gampang lupa).
// Cuma bisa mengubah akun MILIK SENDIRI (diambil dari sesi login, bukan dari body request) —
// tidak ada parameter userId sama sekali, supaya tidak bisa dipakai mengubah akun orang lain.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, password } = body
    if (!name || !password) {
      return NextResponse.json({ error: 'Nama dan password wajib diisi.' }, { status: 400 })
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter.' }, { status: 400 })
    }

    const newEmail = emailFromName(name)
    if (!newEmail) {
      return NextResponse.json({ error: 'Nama tidak valid untuk dijadikan email.' }, { status: 400 })
    }

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email: newEmail,
      password,
      email_confirm: true,
    })
    if (authError) {
      const msg = authError.message.includes('already been registered')
        ? `Email ${newEmail} sudah dipakai akun lain. Coba variasi nama lain (misal tambah nama tengah).`
        : authError.message
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const { error: dbError } = await supabaseAdmin
      .from('users')
      .update({ email: newEmail })
      .eq('id', user.id)
    if (dbError) return NextResponse.json({ error: 'Gagal menyimpan email baru: ' + dbError.message }, { status: 500 })

    return NextResponse.json({ success: true, email: newEmail })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Terjadi kesalahan.' }, { status: 500 })
  }
}
