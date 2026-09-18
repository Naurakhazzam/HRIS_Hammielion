'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AbsenSekarang from '@/components/AbsenSekarang'
import { isPreviewModeClient } from '@/lib/previewMode'

type ResolveResult = { branch_id: string; branch_name: string } | null

export default function AbsenQrPage() {
  const supabase = createClient()
  const router = useRouter()
  const params = useParams<{ token: string }>()

  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState('')
  const [employeeName, setEmployeeName] = useState('')

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: userData } = await supabase.from('users')
      .select('role, employee_id, employees(full_name, branch_id)')
      .eq('id', user.id).single()
    if (!userData) { setErrorMsg('Data akun tidak ditemukan.'); setLoading(false); return }

    if (!['employee', 'supervisor'].includes(userData.role) && !isPreviewModeClient()) {
      router.push('/dashboard'); return
    }

    const emp = (userData as any).employees as { full_name: string; branch_id: string } | null
    if (!emp) { setErrorMsg('Data karyawan untuk akun ini tidak ditemukan.'); setLoading(false); return }

    // Resolve token lewat RPC — bukan baca tabel branch_qr_tokens langsung, karena tabel itu
    // sengaja dibatasi cuma owner/hr yang boleh baca (lihat migrasi create_branch_qr_tokens).
    const { data: resolved, error: resolveErr } = await supabase
      .rpc('resolve_branch_by_qr_token', { p_token: params.token })
      .maybeSingle()

    if (resolveErr || !resolved) {
      setErrorMsg('Kode QR tidak valid atau sudah tidak berlaku. Hubungi HR untuk QR yang benar.')
      setLoading(false)
      return
    }

    const r = resolved as unknown as ResolveResult
    if (r!.branch_id !== emp.branch_id) {
      setErrorMsg(`QR ini untuk cabang "${r!.branch_name}", tapi Anda terdaftar di cabang lain. Absen di QR cabang tempat Anda bekerja, atau hubungi HR kalau ini keliru.`)
      setLoading(false)
      return
    }

    setEmployeeId(userData.employee_id)
    setEmployeeName(emp.full_name)
    setLoading(false)
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  return (
    <div className="max-w-md mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Absen QR</h1>
        <p className="text-sm text-slate-500">Ambil foto untuk mencatat kehadiran Anda.</p>
      </div>

      {errorMsg ? (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{errorMsg}</div>
      ) : (
        <AbsenSekarang employeeId={employeeId} employeeName={employeeName} mode="qr" />
      )}
    </div>
  )
}
