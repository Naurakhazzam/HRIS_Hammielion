import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { emailFromName } from '@/lib/emailFromName'

// Jalur "Kode Karyawan Saja" — verifikasi utama pakai Nama Lengkap + Tanggal Lahir (dicocokkan
// ke data HR). Kode Karyawan biasanya OPSIONAL (cuma untuk membedakan kalau kebetulan ada 2
// karyawan dengan nama & tanggal lahir sama persis) — KECUALI untuk karyawan yang di data HR-nya
// memang tidak punya No HP maupun Tanggal Lahir sama sekali (tidak ada cara lain untuk verifikasi
// mereka): untuk kasus itu, Kode Karyawan SENDIRIAN sudah cukup, Tanggal Lahir boleh dikosongkan.
// Nama tetap wajib diisi (dipakai bentuk email login), tapi di jalur ini tidak perlu cocok
// dengan data HR karena verifikasinya sudah lewat Kode Karyawan.
// Nested di bawah /api/signup supaya otomatis ikut PUBLIC_ROUTES di proxy.ts (prefix match) —
// lihat CHANGELOG #80: '/api/signup' dulu sempat lupa ditambahkan ke situ.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const genericError = 'Data tidak cocok dengan data HR, tidak aktif, atau sudah pernah dipakai daftar. Hubungi HR.'
const ambiguousError = 'Ada lebih dari satu karyawan dengan nama & tanggal lahir yang sama — isi juga Kode Karyawan untuk memastikan.'
const needCodeError = 'Tanggal Lahir wajib diisi, KECUALI kalau Anda memang belum punya Tanggal Lahir tercatat di HR — untuk itu, isi Kode Karyawan sebagai gantinya.'
const hasOtherDataError = 'Data Anda di HR sudah punya No HP/Tanggal Lahir tercatat — isi Tanggal Lahir untuk verifikasi (Kode Karyawan opsional), bukan dikosongkan.'

type EmpRow = { id: string; full_name: string; employee_code: string; phone: string | null; birth_date: string | null; is_active: boolean; positions: { name: string } | null }

async function resolveByNameAndBirthdate(fullName: string, birthDate: string, employeeCode?: string):
  Promise<{ error: string } | { emp: EmpRow }> {
  let query = supabaseAdmin
    .from('employees')
    .select('id, full_name, employee_code, phone, birth_date, is_active, positions(name)')
    .ilike('full_name', fullName.trim())
    .eq('birth_date', birthDate)
    .eq('is_active', true)
  if (employeeCode && employeeCode.trim()) {
    query = query.eq('employee_code', employeeCode.trim().toUpperCase())
  }
  const { data } = await query
  const candidates = (data as unknown as EmpRow[]) || []

  if (candidates.length === 0) return { error: genericError }
  if (candidates.length > 1) return { error: ambiguousError }
  return { emp: candidates[0] }
}

// Jalur cadangan: Tanggal Lahir dikosongkan, verifikasi cuma pakai Kode Karyawan — HANYA
// diperbolehkan untuk karyawan yang di data HR-nya memang tidak punya No HP maupun Tanggal
// Lahir sama sekali (kalau ada salah satunya, tetap wajib pakai jalur nama+tanggal lahir).
async function resolveByCodeOnly(employeeCode: string): Promise<{ error: string } | { emp: EmpRow }> {
  const { data: emp } = await supabaseAdmin
    .from('employees')
    .select('id, full_name, employee_code, phone, birth_date, is_active, positions(name)')
    .eq('employee_code', employeeCode.trim().toUpperCase())
    .maybeSingle()

  const row = emp as unknown as EmpRow | null
  if (!row || !row.is_active) return { error: genericError }
  if (row.phone || row.birth_date) return { error: hasOtherDataError }
  return { emp: row }
}

async function resolveEligible(fullName: string, birthDate: string, employeeCode?: string):
  Promise<{ error: string } | { emp: EmpRow }> {
  const result = birthDate
    ? await resolveByNameAndBirthdate(fullName, birthDate, employeeCode)
    : employeeCode?.trim()
      ? await resolveByCodeOnly(employeeCode)
      : { error: needCodeError }

  if ('error' in result) return result

  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('employee_id', result.emp.id)
    .maybeSingle()
  if (existing) return { error: genericError }

  return result
}

// GET /api/signup/quick?name=...&birth_date=YYYY-MM-DD(opsional)&employee_code=...(opsional)
// Lookup untuk konfirmasi live di form, sebelum submit.
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')
  const birthDate = req.nextUrl.searchParams.get('birth_date') || ''
  const employeeCode = req.nextUrl.searchParams.get('employee_code') || undefined
  if (!name) return NextResponse.json({ error: 'Nama lengkap wajib diisi.' }, { status: 400 })
  if (!birthDate && !employeeCode) return NextResponse.json({ error: needCodeError }, { status: 400 })

  const result = await resolveEligible(name, birthDate, employeeCode)
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

    if (!full_name || !password) {
      return NextResponse.json({ error: 'Nama lengkap dan password wajib diisi.' }, { status: 400 })
    }
    if (!birth_date && !employee_code) {
      return NextResponse.json({ error: needCodeError }, { status: 400 })
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter.' }, { status: 400 })
    }

    const email = emailFromName(full_name)
    if (!email) {
      return NextResponse.json({ error: 'Nama tidak valid untuk dijadikan email.' }, { status: 400 })
    }

    const result = await resolveEligible(full_name, birth_date || '', employee_code)
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
