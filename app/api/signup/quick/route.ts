import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { emailFromName } from '@/lib/emailFromName'

// Jalur "Sudah Jadi Karyawan (Belum Punya Akun)" — verifikasi TANPA Kode Karyawan sama sekali.
// Aturan (permintaan Owner): Tanggal Lahir WAJIB cocok dengan data HR, dan minimal SALAH SATU
// dari Nama Lengkap atau No HP juga harus cocok. Error yang dikembalikan sengaja spesifik per
// bagian (mis. "Tanggal Lahir tidak cocok") supaya karyawan tahu persis mana yang perlu
// diperbaiki — bukan pesan generik yang membuat mereka bingung harus mengecek yang mana.
//
// Konsekuensi: karyawan yang di data HR-nya TIDAK punya Tanggal Lahir tercatat sama sekali
// tidak akan pernah bisa lolos jalur ini (Tanggal Lahir wajib cocok, tidak bisa cocok dengan
// NULL) — HR perlu lengkapi dulu Tanggal Lahir mereka lewat menu Karyawan.
//
// Email login dibentuk dari NAMA ASLI YANG TERCATAT DI HR (bukan dari yang diketik user) —
// supaya tetap konsisten walau yang bikin lolos verifikasi ternyata kecocokan No HP, bukan nama.
//
// Nested di bawah /api/signup supaya otomatis ikut PUBLIC_ROUTES di proxy.ts (prefix match) —
// lihat CHANGELOG #80: '/api/signup' dulu sempat lupa ditambahkan ke situ.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const birthDateMismatchError = 'Tanggal Lahir tidak cocok dengan data HR. Periksa kembali.'
const nameAndPhoneMismatchError = 'Nama Lengkap dan Nomor HP dua-duanya tidak cocok dengan data HR untuk Tanggal Lahir ini — pastikan salah satunya benar.'
const ambiguousError = 'Ada lebih dari satu data yang cocok. Hubungi HR untuk verifikasi manual.'
const alreadyOrInactiveError = 'Karyawan ini sudah terdaftar, atau datanya tidak aktif. Silakan login, atau hubungi HR.'

type EmpRow = { id: string; full_name: string; employee_code: string; phone: string | null; positions: { name: string } | null }

const normalizePhone = (p: string) => p.replace(/\D/g, '')

async function resolveEligible(fullName: string, phone: string, birthDate: string):
  Promise<{ error: string } | { emp: EmpRow }> {
  const { data } = await supabaseAdmin
    .from('employees')
    .select('id, full_name, employee_code, phone, is_active, positions(name)')
    .eq('birth_date', birthDate)
    .eq('is_active', true)

  const sameBirthdate = (data as unknown as EmpRow[]) || []
  if (sameBirthdate.length === 0) return { error: birthDateMismatchError }

  const nameNorm = fullName.trim().toLowerCase()
  const phoneNorm = normalizePhone(phone || '')
  const candidates = sameBirthdate.filter(e => {
    const nameMatches = e.full_name.trim().toLowerCase() === nameNorm
    const phoneMatches = !!phoneNorm && !!e.phone && normalizePhone(e.phone) === phoneNorm
    return nameMatches || phoneMatches
  })

  if (candidates.length === 0) return { error: nameAndPhoneMismatchError }
  if (candidates.length > 1) return { error: ambiguousError }

  const emp = candidates[0]
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('employee_id', emp.id)
    .maybeSingle()
  if (existing) return { error: alreadyOrInactiveError }

  return { emp }
}

// GET /api/signup/quick?name=...&phone=...&birth_date=YYYY-MM-DD — lookup untuk konfirmasi
// live di form, sebelum submit.
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name') || ''
  const phone = req.nextUrl.searchParams.get('phone') || ''
  const birthDate = req.nextUrl.searchParams.get('birth_date') || ''
  if (!birthDate) return NextResponse.json({ error: 'Tanggal Lahir wajib diisi.' }, { status: 400 })
  if (!name.trim()) return NextResponse.json({ error: 'Nama Lengkap wajib diisi.' }, { status: 400 })

  const result = await resolveEligible(name, phone, birthDate)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({
    employee_code: result.emp.employee_code,
    position_name: result.emp.positions?.name ?? null,
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { full_name, phone, birth_date, password } = body

    if (!full_name || !birth_date || !password) {
      return NextResponse.json({ error: 'Nama Lengkap, Tanggal Lahir, dan password wajib diisi.' }, { status: 400 })
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter.' }, { status: 400 })
    }

    const result = await resolveEligible(full_name, phone || '', birth_date)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    const emp = result.emp

    // Email dibentuk dari nama ASLI di data HR, bukan dari yang diketik user.
    const email = emailFromName(emp.full_name)
    if (!email) {
      return NextResponse.json({ error: 'Nama di data HR tidak valid untuk dijadikan email. Hubungi HR.' }, { status: 400 })
    }

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
