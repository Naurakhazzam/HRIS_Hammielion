import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { emailFromName } from '@/lib/emailFromName'

// Jalur "Kode Karyawan Saja" — sengaja cuma satu syarat (Kode Karyawan), tanpa verifikasi
// No HP/Tanggal Lahir seperti /api/signup. Ini keputusan Owner: Kode Karyawan dianggap sudah
// cukup rahasia (cuma diketahui HR & karyawan bersangkutan) demi pendaftaran yang lebih cepat.
// Nested di bawah /api/signup supaya otomatis ikut PUBLIC_ROUTES di proxy.ts (prefix match) —
// lihat CHANGELOG #80: '/api/signup' dulu sempat lupa ditambahkan ke situ.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const genericError = 'Kode Karyawan tidak ditemukan, tidak aktif, atau sudah pernah dipakai daftar. Hubungi HR.'

async function findEligibleEmployee(employeeCode: string) {
  const { data: emp } = await supabaseAdmin
    .from('employees')
    .select('id, full_name, is_active')
    .eq('employee_code', String(employeeCode).trim().toUpperCase())
    .maybeSingle()
  if (!emp || !emp.is_active) return null

  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('employee_id', emp.id)
    .maybeSingle()
  if (existing) return null

  return emp
}

// GET /api/signup/quick?code=EMP-012 — lookup nama untuk konfirmasi live di form, sebelum submit.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'Kode Karyawan wajib diisi.' }, { status: 400 })

  const emp = await findEligibleEmployee(code)
  if (!emp) return NextResponse.json({ error: genericError }, { status: 400 })

  return NextResponse.json({ full_name: emp.full_name })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { employee_code, username, password } = body

    if (!employee_code || !username || !password) {
      return NextResponse.json({ error: 'Kode Karyawan, nama, dan password wajib diisi.' }, { status: 400 })
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter.' }, { status: 400 })
    }

    const email = emailFromName(username)
    if (!email) {
      return NextResponse.json({ error: 'Nama tidak valid untuk dijadikan email.' }, { status: 400 })
    }

    const emp = await findEligibleEmployee(employee_code)
    if (!emp) return NextResponse.json({ error: genericError }, { status: 400 })

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authError) {
      const msg = authError.message.includes('already been registered')
        ? `Email ${email} sudah terdaftar. Coba variasi nama lain, atau login kalau ini akun Anda.`
        : authError.message
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const { error: dbError } = await supabaseAdmin
      .from('users')
      .insert({ id: authData.user.id, employee_id: emp.id, email, role: 'employee', is_active: true })

    if (dbError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: 'Gagal menyimpan akun: ' + dbError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, email })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Terjadi kesalahan.' }, { status: 500 })
  }
}
