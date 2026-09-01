import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

import DashboardShell from '@/components/DashboardShell'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Verifikasi session di sisi server sebagai lapisan keamanan tambahan
  // (middleware sudah menjaga, ini adalah double-check)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Tolak akses jika akun sudah dinonaktifkan (mis. karyawan resign),
  // meskipun sesi login sebelumnya masih tersimpan di browser.
  const { data: profile } = await supabase
    .from('users').select('is_active').eq('id', user.id).single()

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut()
    redirect('/login')
  }

  return <DashboardShell userEmail={user.email ?? ''}>{children}</DashboardShell>
}
