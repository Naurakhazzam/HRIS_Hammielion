'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchOvertimeClaimAlerts as fetchOvertimeClaimAlertsShared, type OvertimeClaimAlertItem } from '@/lib/overtimeClaim'

// Panel klaim lembur -- dipakai di DUA tempat: kartu ringkas di Dashboard Portal Saya
// (portal/page.tsx) dan halaman khusus Klaim Lembur (portal/lembur/page.tsx) yang selalu bisa
// diakses lewat menu, supaya karyawan yang skip/scroll lewat pengingat di dashboard tetap punya
// tempat pasti untuk upload foto kertas lembur. Satu komponen, satu sumber logika.
export default function OvertimeKlaimPanel({ employeeId, hideWhenEmpty, compact }: { employeeId: string; hideWhenEmpty?: boolean; compact?: boolean }) {
  const supabase = createClient()
  const [overtimeAlerts, setOvertimeAlerts] = useState<OvertimeClaimAlertItem[]>([])
  const [overtimeModal, setOvertimeModal] = useState<OvertimeClaimAlertItem | null>(null)
  const [overtimeFile, setOvertimeFile] = useState<File | null>(null)
  const [overtimeError, setOvertimeError] = useState('')
  const [overtimeSubmitting, setOvertimeSubmitting] = useState(false)

  useEffect(() => { if (employeeId) fetchOvertimeAlerts() }, [employeeId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchOvertimeAlerts() {
    setOvertimeAlerts(await fetchOvertimeClaimAlertsShared(supabase, employeeId))
  }

  function openOvertimeModal(item: OvertimeClaimAlertItem) {
    setOvertimeModal(item)
    setOvertimeFile(null)
    setOvertimeError('')
  }

  async function submitOvertimeClaim() {
    if (!overtimeModal) return
    if (!overtimeFile) { setOvertimeError('Foto kertas lembur wajib diunggah.'); return }
    setOvertimeSubmitting(true)
    setOvertimeError('')

    const fileExt = overtimeFile.name.split('.').pop()
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
    const filePath = `lembur_klaim/${fileName}`
    const { error: upErr } = await supabase.storage.from('documents').upload(filePath, overtimeFile)
    if (upErr) { setOvertimeError('Gagal unggah foto: ' + upErr.message); setOvertimeSubmitting(false); return }
    const photoUrl = supabase.storage.from('documents').getPublicUrl(filePath).data.publicUrl

    const { error } = await supabase.rpc('submit_overtime_claim', {
      p_attendance_id: overtimeModal.attendanceId,
      p_photo_url: photoUrl,
    })
    if (error) {
      setOvertimeError(error.message)
    } else {
      setOvertimeModal(null)
      await fetchOvertimeAlerts()
    }
    setOvertimeSubmitting(false)
  }

  const relevant = overtimeAlerts.filter(a => a.actionable || a.expired)

  if (relevant.length === 0) {
    if (hideWhenEmpty) return null
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 text-center">
        <p className="text-sm text-slate-400">🎉 Tidak ada lembur yang perlu diklaim saat ini.</p>
      </div>
    )
  }

  // Mode ringkas -- dipakai di Dashboard (portal/page.tsx) supaya tidak menumpuk satu kartu per
  // hari lembur langsung di sana. Form upload lengkapnya tetap di halaman /portal/lembur, yang
  // memakai komponen ini juga tapi tanpa prop compact.
  if (compact) {
    return (
      <Link href="/portal/lembur" className="flex items-center justify-between gap-3 bg-purple-50 border-2 border-purple-400 rounded-xl p-4 hover:bg-purple-100 transition">
        <div>
          <p className="text-sm font-bold text-purple-800">🕗 Ada {relevant.length} lembur yang perlu diklaim</p>
          <p className="text-xs text-purple-700 mt-0.5">Upload foto kertas lembur sebelum batas waktu, atau hangus.</p>
        </div>
        <span className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded-lg font-semibold whitespace-nowrap shrink-0">Klaim →</span>
      </Link>
    )
  }

  return (
    <>
      <div className="bg-purple-50 border-2 border-purple-400 rounded-xl p-4">
        <p className="text-base font-bold text-purple-800">🕗 Lembur terdeteksi — wajib klaim + foto kertas lembur dalam 3 hari</p>
        <p className="text-sm text-purple-700 mt-1">Lembur TIDAK otomatis dibayar. Upload foto kertas lembur untuk disetujui Owner, atau hangus kalau lewat batas waktu.</p>
        <div className="mt-3 space-y-2">
          {relevant.map(a => {
            const deadlineLabel = new Date(a.deadline + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long' })
            const isPending = a.claim?.status === 'pending'
            return (
              <div key={a.attendanceId} className="bg-white border border-purple-200 rounded-lg p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">
                    {new Date(a.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                    <span className="text-slate-400 font-normal"> — {a.hoursDetected} jam terdeteksi</span>
                  </p>
                  {isPending ? (
                    <span className="text-xs px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg font-medium">⏳ Menunggu review Owner</span>
                  ) : a.actionable ? (
                    <button onClick={() => openOvertimeModal(a)} className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold">
                      {a.claim ? 'Ajukan Lagi' : 'Upload Foto Lembur'}
                    </button>
                  ) : (
                    <span className="text-xs px-3 py-1.5 bg-slate-200 text-slate-600 rounded-lg font-medium">🔒 Hangus, lewat batas</span>
                  )}
                </div>
                {!isPending && a.claim?.status === 'rejected' && (
                  <p className="text-xs text-slate-500 mt-1.5">Klaim sebelumnya ditolak{a.claim.rejection_note ? `: ${a.claim.rejection_note}` : ''}.</p>
                )}
                {a.actionable && !isPending && a.noDeadline && (
                  <p className="text-xs text-amber-600 font-medium mt-1.5">⏳ Periode ini boleh diklaim kapan saja, tanpa batas waktu.</p>
                )}
                {a.actionable && !isPending && !a.noDeadline && (
                  <p className="text-xs text-purple-600 font-medium mt-1.5">⏰ Batas klaim: paling lambat {deadlineLabel} (3 hari setelah tanggal lembur)</p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {overtimeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-5">
            <h3 className="text-lg font-bold text-slate-800 mb-1">Klaim Lembur</h3>
            <p className="text-sm text-slate-500 mb-4">
              {new Date(overtimeModal.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
              {' — '}{overtimeModal.hoursDetected} jam terdeteksi
            </p>
            <p className="text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 mb-3">Wajib lampirkan foto kertas lembur yang sudah ditandatangani. Owner akan meninjau sebelum lembur ini dibayarkan.</p>
            {overtimeError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{overtimeError}</p>}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Foto Kertas Lembur *</label>
              <input type="file" accept="image/*,.pdf" onChange={e => setOvertimeFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setOvertimeModal(null)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
              <button onClick={submitOvertimeClaim} disabled={overtimeSubmitting}
                className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {overtimeSubmitting ? 'Mengirim...' : 'Kirim Klaim'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
