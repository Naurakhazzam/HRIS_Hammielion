'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isPreviewModeClient, PREVIEW_EMPLOYEE_ID } from '@/lib/previewMode'
import AlphaKlarifikasiPanel from '@/components/AlphaKlarifikasiPanel'

// Halaman khusus yang selalu bisa diakses lewat menu -- supaya karyawan yang skip/scroll lewat
// pengingat di Dashboard Portal Saya tetap punya tempat pasti untuk klarifikasi Alpha, tidak
// cuma mengandalkan banner yang gampang terlewat.
export default function KlarifikasiAlphaPage() {
  const supabase = createClient()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [myEmployeeId, setMyEmployeeId] = useState('')

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: userData } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
    if (!userData) { setLoading(false); return }

    const previewing = ['owner', 'hr', 'finance'].includes(userData.role) && isPreviewModeClient()
    const effectiveId = previewing ? PREVIEW_EMPLOYEE_ID : userData.employee_id
    setMyEmployeeId(effectiveId || '')
    setLoading(false)
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">🔴 Klarifikasi Alpha</h1>
        <p className="text-sm text-slate-500">Daftar hari yang otomatis ditandai Alpha (tidak absen sama sekali) dan menunggu klarifikasi Anda.</p>
      </div>
      {myEmployeeId ? (
        <AlphaKlarifikasiPanel employeeId={myEmployeeId} />
      ) : (
        <p className="text-sm text-slate-400 italic">Data karyawan Anda belum tersedia — hubungi HR.</p>
      )}
    </div>
  )
}
