import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { emailFromName } from '@/lib/emailFromName'

// Jalur "Kode Karyawan Saja" — verifikasi identitas pakai Nama Lengkap + Tanggal Lahir
// (dicocokkan ke data HR), Kode Karyawan OPSIONAL (cuma dipakai untuk membedakan kalau
// kebetulan ada 2 karyawan dengan nama & tanggal lahir yang sama persis). Nama yang sama ini
// juga dipakai untuk bentuk email login (nama@hammielion.com) — jadi harus persis sama dengan
// yang tercatat di HR, tidak bisa diketik bebas seperti sebelumnya.
// Nested di bawah /api/signup supaya otomatis ikut PUBLIC_ROUTES di proxy.ts (prefix match) —
// lihat CHANGELOG #80: '/api/signup' dulu sempat lupa ditambahkan ke situ.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const genericError = 'Nama lengkap & tanggal lahir tidak cocok dengan data HR, tidak aktif, atau sudah pernah dipakai daftar. Hubungi HR.'
const ambiguousError = 'Ada lebih dari satu karyawan dengan nama & tanggal lahir yang sama — isi juga Kode Karyawan untuk memastikan.'

type Candidate = { id: string; full_name: string; employee_code: string; positions: { name: string } | null }

async function findCandidates(fullName: string, birthDate: string, employeeCode?: string) {
  let query = supabaseAdmin
    .from('employees')
    .select('id, full_name, employee_code, is_active, positions(name)')
    .ilike('full_name', fullName.trim())
    .eq('birth_date', birthDate)
    .eq('is_active', true)

  if (employeeCode && employeeCode.trim()) {
    query = query.eq('employee_code', employeeCode.trim().toUpperCase())
  }

  const { data } = await query
  return (data as unknown as Candidate[]) || []
}

async function resolveSingleEligible(fullName: string, birthDate: string, employeeCode?: string):
  Promise<{ error: string } | { emp: Candidate }> {
  const candidates = await findCandidates(fullName, birthDate, employeeCode)
  if (candidates.length === 0) return { error: genericError }
  if (candidates.length > 1) return { error: ambiguousError }

  const emp = candidates[0]
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('employee_id', emp.id)
    .maybeSingle()
  if (existing) return { error: genericError }

  return { emp }
}

// GET /api/signup/quick?name=...&birth_date=YYYY-MM-DD&employee_code=... (opsional)
// Lookup untuk konfirmasi live di form, sebelum submit.
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')
  const birthDate = req.nextUrl.searchParams.get('birth_date')
  const employeeCode = req.nextUrl.searchParams.get('employee_code') || undefined
  if (!name || !birthDate) {
    return NextResponse.json({ error: 'Nama lengkap dan tanggal lahir wajib diisi.' }, { status: 400 })
  }

  const result = await resolveSingleEligible(name, birthDate, employeeCode)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({
    employee_code: result.emp.employee_code,
    position_name: result.emp.positions?.name ?? null,
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { full_name, birth_date, employee_code, password } = body

    if (!full_name || !birth_date || !password) {
      return NextResponse.json({ error: 'Nama lengkap, tanggal lahir, dan password wajib diisi.' }, { status: 400 })
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter.' }, { status: 400 })
    }

    const email = emailFromName(full_name)
    if (!email) {
      return NextResponse.json({ error: 'Nama tidak valid untuk dijadikan email.' }, { status: 400 })
    }

    const result = await resolveSingleEligible(full_name, birth_date, employee_code)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    const emp = result.emp

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authError) {
      const msg = authError.message.includes('already been registered')
        ? `Email ${email} sudah terdaftar (kemungkinan ada karyawan lain dengan nama sama persis). Hubungi HR.`
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
