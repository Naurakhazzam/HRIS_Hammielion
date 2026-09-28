'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAlphaAlerts as fetchAlphaAlertsShared, type AlphaAlertItem } from '@/lib/alphaDetection'
import { getCurrentPeriodRangeStr } from '@/lib/rosterPeriod'

type ClarifyType = 'sick' | 'sick_doc' | 'permission' | 'lupa_absen' | 'leave' | 'hadir'

const LEAVE_QUOTA_PER_PERIOD = 4

// Panel klarifikasi Alpha -- dipakai di DUA tempat: kartu ringkas di Dashboard Portal Saya
// (portal/page.tsx) dan halaman khusus Klarifikasi Alpha (portal/alpha/page.tsx) yang selalu
// bisa diakses lewat menu, supaya karyawan yang skip/scroll lewat pengingat di dashboard tetap
// punya tempat pasti untuk klarifikasi. Satu komponen, satu sumber logika -- tidak ada rumus
// dobel yang bisa diam-diam beda antara dashboard dan halaman khususnya.
export default function AlphaKlarifikasiPanel({ employeeId, hideWhenEmpty }: { employeeId: string; hideWhenEmpty?: boolean }) {
  const supabase = createClient()
  const [alphaAlerts, setAlphaAlerts] = useState<AlphaAlertItem[]>([])
  const [clarifyModal, setClarifyModal] = useState<AlphaAlertItem | null>(null)
  const [clarifyType, setClarifyType] = useState<ClarifyType>('sick')
  const [clarifyReason, setClarifyReason] = useState('')
  const [clarifyFile, setClarifyFile] = useState<File | null>(null)
  const [clarifyError, setClarifyError] = useState('')
  const [clarifySubmitting, setClarifySubmitting] = useState(false)
  // Jatah libur yang SUDAH terpakai periode ini (roster disetujui + attendance 'leave' +
  // klarifikasi 'leave' pending/approved) -- cuma info bantu di UI, penegaknya tetap RPC.
  const [leaveQuotaUsed, setLeaveQuotaUsed] = useState<number | null>(null)

  useEffect(() => { if (employeeId) fetchAlphaAlerts() }, [employeeId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchAlphaAlerts() {
    setAlphaAlerts(await fetchAlphaAlertsShared(supabase, employeeId))
  }

  async function fetchLeaveQuotaUsed(forDate: string) {
    const { start, end } = getCurrentPeriodRangeStr(new Date(forDate + 'T00:00:00'))
    const [{ count: rosterCount }, { count: leaveCount }, { count: pendingCount }] = await Promise.all([
      supabase.from('employee_roster').select('*', { count: 'exact', head: true })
        .eq('employee_id', employeeId).eq('is_day_off', true).gte('date', start).lte('date', end),
      supabase.from('attendances').select('*', { count: 'exact', head: true })
        .eq('employee_id', employeeId).eq('status', 'leave').gte('date', start).lte('date', end),
      supabase.from('alpha_clarifications').select('*', { count: 'exact', head: true })
        .eq('employee_id', employeeId).eq('requested_type', 'leave').in('status', ['pending', 'approved'])
        .gte('date', start).lte('date', end),
    ])
    setLeaveQuotaUsed((rosterCount ?? 0) + (leaveCount ?? 0) + (pendingCount ?? 0))
  }

  function openClarifyModal(alert: AlphaAlertItem) {
    setClarifyModal(alert)
    setClarifyType('sick')
    setClarifyReason('')
    setClarifyFile(null)
    setClarifyError('')
    setLeaveQuotaUsed(null)
    fetchLeaveQuotaUsed(alert.date)
  }

  async function submitClarification() {
    if (!clarifyModal) return
    if (!clarifyReason.trim()) { setClarifyError('Keterangan wajib diisi -- jelaskan alasannya.'); return }
    if (clarifyType === 'sick_doc' && !clarifyFile) { setClarifyError('Sakit dengan surat dokter wajib lampirkan foto/scan surat.'); return }
    setClarifySubmitting(true)
    setClarifyError('')

    let documentUrl: string | null = null
    if (clarifyFile) {
      const fileExt = clarifyFile.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
      const filePath = `alpha_klarifikasi/${fileName}`
      const { error: upErr } = await supabase.storage.from('documents').upload(filePath, clarifyFile)
      if (upErr) { setClarifyError('Gagal unggah bukti: ' + upErr.message); setClarifySubmitting(false); return }
      documentUrl = supabase.storage.from('documents').getPublicUrl(filePath).data.publicUrl
    }

    const { error } = await supabase.rpc('submit_alpha_clarification', {
      p_attendance_id: clarifyModal.attendanceId,
      p_requested_type: clarifyType,
      p_reason: clarifyReason.trim(),
      p_document_url: documentUrl,
    })
    if (error) {
      setClarifyError(error.message)
    } else {
      setClarifyModal(null)
      await fetchAlphaAlerts()
    }
    setClarifySubmitting(false)
  }

  if (alphaAlerts.length === 0) {
    if (hideWhenEmpty) return null
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 text-center">
        <p className="text-sm text-slate-400">🎉 Tidak ada catatan Alpha yang perlu diklarifikasi saat ini.</p>
      </div>
    )
  }

  return (
    <>
      <div className="bg-red-50 border-2 border-red-400 rounded-xl p-4">
        <p className="text-base font-bold text-red-800">🔴 Ada {alphaAlerts.length} hari tidak absen — tercatat ALPHA (potongan gaji BESAR)</p>
        <p className="text-sm text-red-700 mt-1">Kalau ini karena sakit, izin, atau memang jatah libur Anda, segera klarifikasi di bawah ini supaya tidak salah potong gaji Anda.</p>
        <div className="mt-3 space-y-2">
          {alphaAlerts.map(a => {
            const deadlineLabel = new Date(a.deadline + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long' })
            const isPending = a.clarification?.status === 'pending'
            return (
              <div key={a.attendanceId} className="bg-white border border-red-200 rounded-lg p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">
                    {new Date(a.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                  </p>
                  {isPending ? (
                    <span className="text-xs px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg font-medium">⏳ Menunggu review HR</span>
                  ) : a.actionable ? (
                    <button onClick={() => openClarifyModal(a)} className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold">
                      {a.clarification ? 'Klarifikasi Lagi' : 'Klarifikasi Sekarang'}
                    </button>
                  ) : (
                    <span className="text-xs px-3 py-1.5 bg-slate-200 text-slate-600 rounded-lg font-medium">🔒 Batas waktu lewat</span>
                  )}
                </div>
                {!isPending && a.clarification?.status === 'rejected' && (
                  <p className="text-xs text-slate-500 mt-1.5">Klarifikasi sebelumnya ditolak{a.clarification.rejection_note ? `: ${a.clarification.rejection_note}` : ''}.</p>
                )}
                {a.actionable && !isPending && a.noDeadline && (
                  <p className="text-xs text-amber-600 font-medium mt-1.5">⏳ Periode ini boleh diklarifikasi kapan saja, tanpa batas waktu.</p>
                )}
                {a.actionable && !isPending && !a.noDeadline && (
                  <p className="text-xs text-red-600 font-medium mt-1.5">⏰ Batas waktu klarifikasi: paling lambat {deadlineLabel} (2 hari setelah tanggal Alpha)</p>
                )}
                {!a.actionable && !isPending && (
                  <p className="text-xs text-slate-400 mt-1.5">Sudah lewat dari batas waktu {deadlineLabel} — status Alpha tidak bisa diubah lagi.</p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {clarifyModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-5">
            <h3 className="text-lg font-bold text-slate-800 mb-1">Klarifikasi Alpha</h3>
            <p className="text-sm text-slate-500 mb-4">
              {new Date(clarifyModal.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
              {!clarifyModal.noDeadline && <>{' — batas waktu klarifikasi '}{new Date(clarifyModal.deadline + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long' })}</>}
            </p>
            {clarifyError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{clarifyError}</p>}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Sebenarnya kenapa?</label>
                <select value={clarifyType} onChange={e => setClarifyType(e.target.value as ClarifyType)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none bg-white">
                  <option value="sick">Sakit (tanpa surat dokter)</option>
                  <option value="sick_doc">Sakit (dengan surat dokter)</option>
                  <option value="permission">Izin</option>
                  <option value="leave">Libur (pakai jatah 4 hari/periode)</option>
                  <option value="lupa_absen">Lupa Absen (sebenarnya masuk kerja)</option>
                  {clarifyModal.noDeadline && <option value="hadir">Saya Hadir (periode transisi, gratis)</option>}
                </select>
                {clarifyType === 'lupa_absen' && (
                  <p className="text-xs text-amber-600 mt-1">Kalau disetujui HR, dianggap hadir (bukan Alpha/Izin) tapi tetap kena denda administratif Rp15.000. Maksimal 4x per periode gajian.</p>
                )}
                {clarifyType === 'hadir' && (
                  <p className="text-xs text-emerald-600 mt-1">Khusus periode transisi 26 Agustus - 25 September 2026 (banyak Alpha bukan karena kesalahan karyawan). Dianggap hadir penuh, GRATIS tanpa denda, tidak dibatasi berapa kali.</p>
                )}
                {clarifyType === 'leave' && (
                  <p className="text-xs text-emerald-600 mt-1">
                    Gratis, tidak ada potongan sama sekali — tapi cuma bisa kalau jatah libur periode ini masih ada.{' '}
                    {leaveQuotaUsed === null ? 'Mengecek sisa jatah...' : `Sudah terpakai ${leaveQuotaUsed} dari ${LEAVE_QUOTA_PER_PERIOD} hari.`}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Keterangan *</label>
                <textarea value={clarifyReason} onChange={e => setClarifyReason(e.target.value)} rows={3}
                  placeholder="Jelaskan alasannya..." className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" />
              </div>
              {clarifyType === 'sick_doc' && (
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Foto/Scan Surat Dokter *</label>
                  <input type="file" accept="image/*,.pdf" onChange={e => setClarifyFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setClarifyModal(null)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
              <button onClick={submitClarification} disabled={clarifySubmitting}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {clarifySubmitting ? 'Mengirim...' : 'Kirim Klarifikasi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
