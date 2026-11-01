'use client'

// Hitung Ulang Telat -- dipakai setelah HR mengubah jadwal kerja (jam masuk departemen/cabang
// atau jam kerja khusus karyawan). Absen lama TIDAK otomatis ikut dihitung ulang (trigger DB
// calc_attendance_times() cuma jalan saat jam masuk berubah), jadi HR jalankan ini per periode.
// Rumus 100% dari trigger DB yang sama lewat RPC recalc_late_minutes() (migrasi 111): pratinjau
// dulu, lalu terapkan hanya baris yang dicentang. Lembur tidak disentuh, telat yang sudah
// dikompensasi (klarifikasi disetujui) dilewati, semua perubahan tercatat di log edit absensi.

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { localDateStr } from '@/lib/date'
import { getCurrentRosterPeriod } from '@/lib/rosterPeriod'
import { chargeableLateMinutes } from '@/lib/lateTolerance'

type Option = { id: string; name: string }

type PreviewRow = {
  attendance_id: string
  employee_id: string
  employee_name: string
  att_date: string
  check_in_local: string
  source: string | null
  old_late: number
  new_late: number
  manually_edited: boolean
  payroll_status: string | null
}

function periodRange(offsetMonths: number) {
  const { start } = getCurrentRosterPeriod(new Date())
  const s = new Date(start.getFullYear(), start.getMonth() + offsetMonths, 26)
  const e = new Date(s.getFullYear(), s.getMonth() + 1, 25)
  return { start: localDateStr(s), end: localDateStr(e) }
}

const PAYROLL_LABEL: Record<string, string> = {
  draft: 'Draft', pending_approval: 'Menunggu Approval', approved: 'Disetujui', paid: 'Sudah Dibayar',
}

export default function RecalcLateMinutes({ departments }: { departments: Option[] }) {
  const supabase = createClient()
  const lastPeriod = periodRange(-1)

  const [branches, setBranches] = useState<Option[]>([])
  const [startDate, setStartDate] = useState(lastPeriod.start)
  const [endDate, setEndDate] = useState(lastPeriod.end)
  const [deptId, setDeptId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [reason, setReason] = useState('')

  const [rows, setRows] = useState<PreviewRow[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    supabase.from('branches').select('id, name').order('name').then(({ data }) => setBranches(data || []))
  }, [])

  // Filter berubah -> pratinjau lama tidak berlaku lagi.
  function resetPreview() { setRows(null); setSelected(new Set()) }
  const onFilter = <T,>(set: (v: T) => void) => (v: T) => { set(v); resetPreview() }

  function rpcArgs(apply: boolean, ids?: string[]) {
    return {
      p_start: startDate, p_end: endDate,
      p_department_id: deptId || null, p_branch_id: branchId || null, p_employee_id: null,
      p_apply: apply, p_reason: reason || null, p_only_ids: ids ?? null,
    }
  }

  async function handlePreview() {
    setMsg(null)
    if (!startDate || !endDate || endDate < startDate) { setMsg({ type: 'error', text: 'Rentang tanggal tidak valid.' }); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('recalc_late_minutes', rpcArgs(false))
    setLoading(false)
    if (error) { setMsg({ type: 'error', text: 'Gagal membuat pratinjau: ' + error.message }); return }
    const list = (data as PreviewRow[]) || []
    setRows(list)
    // Default: centang semua KECUALI yang telatnya pernah diubah manual di Rekap Absensi.
    setSelected(new Set(list.filter(r => !r.manually_edited).map(r => r.attendance_id)))
  }

  async function handleApply() {
    if (!rows || selected.size === 0) return
    const lockedCount = rows.filter(r => selected.has(r.attendance_id) && r.payroll_status && r.payroll_status !== 'draft').length
    const warn = lockedCount > 0
      ? `\n\n⚠️ ${lockedCount} baris milik slip gaji yang sudah disetujui/dibayar — slip itu TIDAK ikut berubah otomatis.`
      : ''
    if (!confirm(`Terapkan hitung ulang telat untuk ${selected.size} baris absensi?${warn}`)) return
    setApplying(true)
    const { data, error } = await supabase.rpc('recalc_late_minutes', rpcArgs(true, Array.from(selected)))
    setApplying(false)
    if (error) { setMsg({ type: 'error', text: 'Gagal menerapkan: ' + error.message }); return }
    const n = ((data as PreviewRow[]) || []).length
    setMsg({ type: 'success', text: `${n} baris absensi berhasil dihitung ulang. Kalau slip gaji periode ini sudah dibuat, hitung ulang slipnya di Penggajian.` })
    setRows(null); setSelected(new Set())
  }

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const allChecked = !!rows && rows.length > 0 && rows.every(r => selected.has(r.attendance_id))
  const summary = useMemo(() => {
    if (!rows) return null
    const people = new Set(rows.map(r => r.employee_id)).size
    const chargeable = rows.filter(r => chargeableLateMinutes(r.new_late, r.source) !== chargeableLateMinutes(r.old_late, r.source)).length
    return { people, chargeable }
  }, [rows])

  const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white'

  return (
    <div className="bg-white rounded-xl shadow-sm border border-amber-200 mb-6 overflow-hidden">
      <div className="px-5 py-4 bg-amber-50 border-b border-amber-200">
        <h2 className="text-sm font-bold text-amber-800">🔁 Hitung Ulang Telat</h2>
        <p className="text-xs text-amber-700 mt-1">
          Mengubah jadwal di atas <strong>tidak</strong> otomatis mengubah telat di absensi yang sudah tercatat.
          Pakai ini untuk menghitung ulang telat periode tertentu dengan jadwal yang berlaku sekarang.
          Lembur tidak diubah, telat yang sudah dikompensasi (klarifikasi disetujui) dilewati, dan semua perubahan tercatat di log edit absensi.
        </p>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { const p = periodRange(-1); setStartDate(p.start); setEndDate(p.end); resetPreview() }}
            className="px-3 py-1 text-xs rounded-full border border-slate-300 hover:bg-slate-50">Periode lalu</button>
          <button type="button" onClick={() => { const p = periodRange(0); setStartDate(p.start); setEndDate(p.end); resetPreview() }}
            className="px-3 py-1 text-xs rounded-full border border-slate-300 hover:bg-slate-50">Periode berjalan</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Dari Tanggal</label>
            <input type="date" value={startDate} onChange={e => onFilter(setStartDate)(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Sampai Tanggal</label>
            <input type="date" value={endDate} onChange={e => onFilter(setEndDate)(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Departemen</label>
            <select value={deptId} onChange={e => onFilter(setDeptId)(e.target.value)} className={inputCls}>
              <option value="">Semua</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Cabang</label>
            <select value={branchId} onChange={e => onFilter(setBranchId)(e.target.value)} className={inputCls}>
              <option value="">Semua</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Alasan (opsional)</label>
            <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="mis. jam masuk jadi 07:30" className={inputCls} />
          </div>
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={handlePreview} disabled={loading}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
            {loading ? 'Menghitung...' : '🔍 Lihat Pratinjau'}
          </button>
        </div>

        {msg && (
          <div className={`p-3 rounded-lg border text-sm ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {msg.text}
          </div>
        )}

        {rows && rows.length === 0 && (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            ✅ Semua telat di rentang ini sudah sesuai jadwal yang berlaku sekarang — tidak ada yang perlu diubah.
          </p>
        )}

        {rows && rows.length > 0 && summary && (
          <>
            <p className="text-sm text-slate-600">
              <strong>{rows.length}</strong> baris dari <strong>{summary.people}</strong> karyawan akan berubah
              ({summary.chargeable} di antaranya mengubah potongan gaji — sisanya masih dalam toleransi QR 5 menit).
              Baris bertanda <span className="text-amber-700 font-medium">diedit manual</span> tidak dicentang otomatis — cek dulu sebelum ikut diterapkan.
            </p>
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[640px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 w-8">
                      <input type="checkbox" checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map(r => r.attendance_id)))} />
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Karyawan</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Masuk</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase text-right">Telat Lama</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase text-right">Telat Baru</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Catatan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(r => {
                    const tolerated = chargeableLateMinutes(r.new_late, r.source) === 0 && r.new_late > 0
                    return (
                      <tr key={r.attendance_id} className={selected.has(r.attendance_id) ? '' : 'bg-slate-50 text-slate-400'}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selected.has(r.attendance_id)} onChange={() => toggle(r.attendance_id)} />
                        </td>
                        <td className="px-3 py-2 font-medium">{r.employee_name}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {new Date(r.att_date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' })}
                        </td>
                        <td className="px-3 py-2">{r.check_in_local}</td>
                        <td className="px-3 py-2 text-right">{r.old_late} mnt</td>
                        <td className="px-3 py-2 text-right font-semibold">{r.new_late} mnt</td>
                        <td className="px-3 py-2 text-xs space-x-1">
                          {r.manually_edited && <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">diedit manual</span>}
                          {tolerated && <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">toleransi QR</span>}
                          {r.payroll_status && (
                            <span className={`inline-block px-1.5 py-0.5 rounded ${r.payroll_status === 'draft' ? 'bg-blue-50 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                              Slip: {PAYROLL_LABEL[r.payroll_status] ?? r.payroll_status}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={handleApply} disabled={applying || selected.size === 0}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {applying ? 'Menerapkan...' : `✅ Terapkan ${selected.size} Baris`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
