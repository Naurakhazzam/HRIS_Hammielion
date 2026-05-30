import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Admin client pakai service_role — hanya jalan di server
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ─── GET: Daftar semua user ───────────────────────────────────────────────────
export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: currentUser } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!currentUser || !['owner', 'hr'].includes(currentUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select(`
        id, email, role, is_active, created_at,
        employees!users_employee_id_fkey(full_name, employee_code, branches(name), positions(name))
      `)
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ users })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ─── POST: Buat user baru ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: currentUser } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!currentUser || !['owner', 'hr'].includes(currentUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { employee_id, email, password, role } = body

    if (!employee_id || !email || !password || !role) {
      return NextResponse.json({ error: 'Semua field wajib diisi.' }, { status: 400 })
    }

    // Cek apakah karyawan sudah punya akun
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('employee_id', employee_id)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Karyawan ini sudah memiliki akun.' }, { status: 400 })
    }

    // Buat akun di Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    })

    if (authError) throw authError

    // Insert ke public.users
    const { error: dbError } = await supabaseAdmin
      .from('users')
      .insert({
        id: authData.user.id,
        employee_id,
        email,
        role,
        is_active: true
      })

    if (dbError) {
      // Rollback: hapus auth user jika insert public.users gagal
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      throw dbError
    }

    return NextResponse.json({ success: true, userId: authData.user.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ─── PATCH: Update role atau reset password ───────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: currentUser } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!currentUser || !['owner', 'hr'].includes(currentUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { userId, role, password, is_active } = body

    if (!userId) return NextResponse.json({ error: 'userId wajib diisi.' }, { status: 400 })

    // Update role / is_active di public.users
    if (role !== undefined || is_active !== undefined) {
      const updates: any = {}
      if (role !== undefined) updates.role = role
      if (is_active !== undefined) updates.is_active = is_active

      const { error } = await supabaseAdmin
        .from('users')
        .update(updates)
        .eq('id', userId)
      if (error) throw error
    }

    // Reset password jika ada
    if (password) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password })
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ─── DELETE: Hapus user ───────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: currentUser } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!currentUser || currentUser.role !== 'owner') {
      return NextResponse.json({ error: 'Hanya Owner yang bisa menghapus akun.' }, { status: 403 })
    }

    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId wajib diisi.' }, { status: 400 })

    // Jangan izinkan hapus diri sendiri
    if (userId === user.id) {
      return NextResponse.json({ error: 'Tidak bisa menghapus akun sendiri.' }, { status: 400 })
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
