'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toDateStr } from '@/lib/leaveQuota'

type WorkSchedule = {
  id: string
  name: string
  check_in_time: string
  check_out_time: string
  detect_until: string | null
  allow_overtime: boolean
  applies_to_dept: string
  departments: { name: string }
}

type Employee = { id: string; full_name: string; employee_code: string; department_id: string }

type RosterRow = { id: string; date: string; schedule_id: string | null; is_day_off: boolean }

const DEFAULT_DAYS = 7

function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

export default function ShiftRosterPage() {
  const supabase = createClient()

  const [schedules, setSchedules] = useState<WorkSchedule[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [startDate, setStartDate] = useState(toDateStr(new Date()))
  const [numDays, setNumDays] = useState(DEFAULT_DAYS)
  const [rosterDraft, setRosterDraft] = useState<Record<string, string>>({}) // date -> scheduleId | 'OFF'
  const [existingRoster, setExistingRoster] = useState<RosterRow[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchInitial() }, [])
  useEffect(() => { if (selectedEmployeeId) fetchExistingRoster() }, [selectedEmployeeId, startDate, numDays])

  async function fetchInitial() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: userData } = await supabase.from('users').select('employee_id').eq('id', user.id).single()
      if (userData) setMyEmployeeId(userData.employee_id)
    }

    const [{ data: schedData }, { data: empData }] = await Promise.all([
      supabase.from('work_schedules')
        .select('id, name, check_in_time, check_out_time, detect_until, allow_overtime, applies_to_dept, departments(name)')
        .order('applies_to_dept').order('check_in_time'),
      supabase.from('employees')
        .select('id, full_name, employee_code, department_id')
        .eq('is_active', true).order('full_name'),
    ])
    setSchedules((schedData as unknown as WorkSchedule[]) || [])
    setEmployees(empData || [])
    setLoading(false)
  }

  async function fetchExistingRoster() {
    const end = addDays(startDate, numDays - 1)
    const { data } = await supabase
      .from('employee_roster')
      .select('id, date, schedule_id, is_day_off')
      .eq('employee_id', selectedEmployeeId)
      .gte('date', startDate)
      .lte('date', end)
    const rows = (data as RosterRow[]) || []
    setExistingRoster(rows)
    // Pre-isi draft dari data yang sudah ada, supaya edit tidak menghapus yang belum diubah.
    const draft: Record<string, string> = {}
    rows.forEach(r => { draft[r.date] = r.is_day_off ? 'OFF' : (r.schedule_id || '') })
    setRosterDraft(draft)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId) || null
  const deptSchedules = selectedEmployee ? schedules.filter(s => s.applies_to_dept === selectedEmployee.department_id) : []
  const dateList = Array.from({ length: numDays }, (_, i) => addDays(startDate, i))

  function setDraftFor(date: string, value: string) {
    setRosterDraft(prev => ({ ...prev, [date]: value }))
  }

  async function handleSave() {
    if (!selectedEmployeeId) { showMessage('error', 'Pilih karyawan dulu.'); return }
    setSaving(true)

    const rowsToUpsert = dateList
      .filter(date => rosterDraft[date])
      .map(date => {
        const val = rosterDraft[date]
        return {
          employee_id: selectedEmployeeId,
          date,
          schedule_id: val === 'OFF' ? null : val,
          is_day_off: val === 'OFF',
          assigned_by: myEmployeeId,
        }
      })

    if (rowsToUpsert.length === 0) { showMessage('error', 'Belum ada jadwal yang diisi.'); setSaving(false); return }

    const { error } = await supabase.from('employee_roster').upsert(rowsToUpsert, { onConflict: 'employee_id,date' })
    if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
    else { showMessage('success', `Jadwal ${rowsToUpsert.length} hari berhasil disimpan.`); fetchExistingRoster() }
    setSaving(false)
  }

  async function handleClearDay(date: string) {
    const existing = existingRoster.find(r => r.date === date)
    if (!existing) { setDraftFor(date, ''); return }
    if (!confirm(`Hapus jadwal tanggal ${date}?`)) return
    const { error } = await supabase.from('employee_roster').delete().eq('id', existing.id)
    if (error) { showMessage('error', 'Gagal menghapus: ' + error.message); return }
    setDraftFor(date, '')
    fetchExistingRoster()
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Jadwal & Shift Karyawan</h1>
          <p className="text-sm text-slate-500">Rencanakan shift & hari libur karyawan ke depan — muncul di Portal &quot;Jadwal Saya&quot; masing-masing.</p>
        </div>
        <Link href="/absensi/jadwal"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
          ⚙️ Setup Jam Shift Departemen
        </Link>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-500">Memuat data...</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Karyawan</label>
              <select value={selectedEmployeeId} onChange={e => setSelectedEmployeeId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">-- Pilih Karyawan --</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.full_name} ({emp.employee_code})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Mulai Tanggal</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Jumlah Hari</label>
              <select value={numDays} onChange={e => setNumDays(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                {[7, 14, 30].map(n => <option key={n} value={n}>{n} hari</option>)}
              </select>
            </div>
          </div>

          {!selectedEmployeeId ? (
            <p className="text-sm text-slate-400 text-center py-6">Pilih karyawan untuk mulai atur jadwalnya.</p>
          ) : deptSchedules.length === 0 ? (
            <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Departemen karyawan ini belum punya aturan shift di <Link href="/absensi/jadwal" className="underline">Setup Jam Shift Departemen</Link>.
            </p>
          ) : (
            <>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase">Jadwal</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dateList.map(date => (
                      <tr key={date}>
                        <td className="px-4 py-2 text-slate-700 whitespace-nowrap">
                          {new Date(date).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-2">
                          <select value={rosterDraft[date] || ''} onChange={e => setDraftFor(date, e.target.value)}
                            className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                            <option value="">-- Belum diatur --</option>
                            <option value="OFF">🛑 Libur</option>
                            {deptSchedules.map(s => (
                              <option key={s.id} value={s.id}>{s.name} ({s.check_in_time?.substring(0,5)}-{s.check_out_time?.substring(0,5)})</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2 text-right">
                          {existingRoster.some(r => r.date === date) && (
                            <button onClick={() => handleClearDay(date)} className="text-xs text-red-600 hover:underline">Hapus</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <button onClick={handleSave} disabled={saving}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                  {saving ? 'Menyimpan...' : '💾 Simpan Jadwal'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Info deteksi otomatis — tetap berlaku untuk pencatatan absensi AKTUAL (fingerprint/HP),
          terpisah dari roster rencana di atas. */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mt-6">
        <h2 className="text-sm font-bold text-blue-800 mb-2">ℹ️ Absensi Aktual Tetap Terdeteksi Otomatis</h2>
        <p className="text-sm text-blue-700">Roster di atas cuma rencana ke depan (buat karyawan lihat jadwalnya). Saat karyawan clock-in sungguhan, sistem tetap mencocokkan jam masuk dengan aturan jadwal departemennya secara otomatis — tidak tergantung roster ini.</p>
      </div>
    </div>
  )
}
