import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { emailFromName } from '@/lib/emailFromName'

// Onboarding karyawan benar-benar baru lewat link sekali pakai. HR generate undangan di
// /karyawan/undang (isi cabang/posisi/tipe saja); karyawan yang terima link buka
// /daftar-baru/[token], GET di sini menampilkan penempatannya (read-only) + validasi link
// masih berlaku, POST di sini yang benar-benar membuat baris employees + akun login.
//
// Nested di bawah /api supaya gampang ditambahkan ke PUBLIC_ROUTES di proxy.ts (prefix match)
// -- ingat kasus '/api/signup' yang dulu sempat lupa ditambahkan (lihat CHANGELOG #80).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

type InviteRow = {
  id: string; status: string; expires_at: string
  branch_id: string; position_id: string; employee_type: string; join_date: string
  branches: { name: string } | null
  positions: { name: string; department_id: string } | null
}

async function resolveInvite(token: string) {
  const { data } = await supabaseAdmin
    .from('employee_invites')
    .select('id, status, expires_at, branch_id, position_id, employee_type, join_date, branches(name), positions(name, department_id)')
    .eq('token', token)
    .maybeSingle()
  return data as unknown as InviteRow | null
}

function inviteError(invite: InviteRow | null): string | null {
  if (!invite) return 'Link undangan tidak ditemukan. Pastikan link yang dibuka benar, atau hubungi HR.'
  if (invite.status === 'used') return 'Link ini sudah pernah dipakai untuk mendaftar. Kalau ini bukan Anda, hubungi HR.'
  if (invite.status === 'revoked') return 'Link ini sudah dibatalkan HR. Hubungi HR untuk link baru.'
  if (new Date(invite.expires_at) < new Date()) return 'Link ini sudah kadaluarsa. Hubungi HR untuk link baru.'
  return null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await resolveInvite(token)
  const err = inviteError(invite)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  return NextResponse.json({
    branch_name: invite!.branches?.name ?? '-',
    position_name: invite!.positions?.name ?? '-',
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const invite = await resolveInvite(token)
    const err = inviteError(invite)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
    const inv = invite!

    const body = await req.json()
    const {
      full_name, nik, phone, birth_date, birth_place, gender, address, religion,
      marital_status, dependants, education,
      bank_name, bank_account_number, bank_account_name,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
      password,
    } = body

    if (!full_name?.trim() || !phone?.trim() || !birth_date || !password) {
      return NextResponse.json({ error: 'Nama Lengkap, No HP, Tanggal Lahir, dan password wajib diisi.' }, { status: 400 })
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter.' }, { status: 400 })
    }

    const email = emailFromName(full_name)
    if (!email) return NextResponse.json({ error: 'Nama Lengkap tidak valid untuk dijadikan email.' }, { status: 400 })

    // Employee code otomatis EMP-XXX berikutnya -- pola yang sama dengan form Tambah Karyawan manual.
    const { data: lastEmp } = await supabaseAdmin
      .from('employees').select('employee_code').like('employee_code', 'EMP-%')
      .order('employee_code', { ascending: false }).limit(1)
    let nextNum = 1
    if (lastEmp?.[0]) {
      const n = parseInt(lastEmp[0].employee_code.replace('EMP-', ''), 10)
      if (!isNaN(n)) nextNum = n + 1
    }
    const employeeCode = `EMP-${String(nextNum).padStart(3, '0')}`

    const { data: newEmp, error: empError } = await supabaseAdmin.from('employees').insert({
      employee_code: employeeCode,
      full_name: full_name.trim(),
      nik: nik || null,
      phone: phone.trim(),
      branch_id: inv.branch_id,
      position_id: inv.position_id,
      department_id: inv.positions?.department_id ?? null,
      employee_type: inv.employee_type,
      join_date: inv.join_date,
      birth_date, birth_place: birth_place || null, gender: gender || null, address: address || null,
      religion: religion || null, marital_status: marital_status || null,
      dependants: dependants ? Number(dependants) : 0, education: education || null,
      bank_name: bank_name || null, bank_account_number: bank_account_number || null, bank_account_name: bank_account_name || null,
      emergency_contact_name: emergency_contact_name || null, emergency_contact_phone: emergency_contact_phone || null,
      emergency_contact_relation: emergency_contact_relation || null,
      is_active: true,
    }).select('id').single()

    if (empError || !newEmp) {
      const msg = empError?.message?.includes('duplicate') ? 'Kode karyawan bentrok, coba lagi.' : (empError?.message || 'Gagal menyimpan data karyawan.')
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (authError) {
      await supabaseAdmin.from('employees').delete().eq('id', newEmp.id)
      const msg = authError.message.includes('already been registered')
        ? `Email ${email} sudah terdaftar (kemungkinan ada nama yang sama persis). Hubungi HR.`
        : authError.message
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const { error: userError } = await supabaseAdmin.from('users')
      .insert({ id: authData.user.id, employee_id: newEmp.id, email, role: 'employee', is_active: true })
    if (userError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      await supabaseAdmin.from('employees').delete().eq('id', newEmp.id)
      return NextResponse.json({ error: 'Gagal menyimpan akun: ' + userError.message }, { status: 500 })
    }

    await supabaseAdmin.from('employee_invites')
      .update({ status: 'used', used_at: new Date().toISOString(), employee_id: newEmp.id })
      .eq('id', inv.id)

    return NextResponse.json({ success: true, email, employee_code: employeeCode })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Terjadi kesalahan.' }, { status: 500 })
  }
}
