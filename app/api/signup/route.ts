import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Endpoint publik (tanpa login) — karyawan bikin akun sendiri, jadi HR tidak perlu buat satu-satu
// lewat Manajemen User. Tetap pakai service_role di server, sama seperti app/api/users/route.ts,
// supaya bisa buat Auth user + baris public.users dalam satu alur.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { employee_code, phone, birth_date, email, password } = body

    if (!employee_code || !email || !password) {
      return NextResponse.json({ error: 'Kode Karyawan, email, dan password wajib diisi.' }, { status: 400 })
    }
    if (!phone && !birth_date) {
      return NextResponse.json({ error: 'Isi Nomor HP atau Tanggal Lahir sesuai data di HR, untuk verifikasi.' }, { status: 400 })
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter.' }, { status: 400 })
    }

    // Cari karyawan berdasarkan Kode Karyawan — pesan error digeneralisir (tidak bilang "kode
    // ditemukan tapi verifikasi salah" vs "kode tidak ada") supaya tidak memudahkan orang
    // menebak-nebak kode karyawan aktif satu-satu.
    const genericError = 'Kode Karyawan atau data verifikasi tidak cocok. Cek lagi, atau hubungi HR.'
    const { data: emp } = await supabaseAdmin
      .from('employees')
      .select('id, phone, birth_date, is_active')
      .eq('employee_code', String(employee_code).trim())
      .maybeSingle()

    if (!emp || !emp.is_active) {
      return NextResponse.json({ error: genericError }, { status: 400 })
    }

    const phoneMatches = phone && emp.phone && String(phone).replace(/\D/g, '') === String(emp.phone).replace(/\D/g, '')
    const birthMatches = birth_date && emp.birth_date && birth_date === emp.birth_date
    if (!phoneMatches && !birthMatches) {
      return NextResponse.json({ error: genericError }, { status: 400 })
    }

    // Cek apakah karyawan ini sudah punya akun
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('employee_id', emp.id)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'Karyawan ini sudah terdaftar. Silakan login, atau hubungi HR kalau lupa password.' }, { status: 400 })
    }

    // Buat akun di Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authError) {
      const msg = authError.message.includes('already been registered')
        ? 'Email ini sudah terdaftar. Pakai email lain, atau login kalau ini akun Anda.'
        : authError.message
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    // Insert ke public.users — role SELALU 'employee', tidak pernah diambil dari input klien.
    const { error: dbError } = await supabaseAdmin
      .from('users')
      .insert({ id: authData.user.id, employee_id: emp.id, email, role: 'employee', is_active: true })

    if (dbError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: 'Gagal menyimpan akun: ' + dbError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Terjadi kesalahan.' }, { status: 500 })
  }
}
