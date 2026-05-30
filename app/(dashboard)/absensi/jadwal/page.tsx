'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Department = { id: string; name: string }

type WorkSchedule = {
  id: string
  name: string
  check_in_time: string
  check_out_time: string
  detect_until: string | null
  allow_overtime: boolean
  applies_to_dept: string
  departments: Department
}

export default function JadwalKerjaPage() {
  const [schedules, setSchedules] = useState<WorkSchedule[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const [name, setName] = useState('')
  const [checkInTime, setCheckInTime] = useState('')
  const [checkOutTime, setCheckOutTime] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [detectUntil, setDetectUntil] = useState('')
  const [allowOvertime, setAllowOvertime] = useState(true)

  const supabase = createClient()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data: deptData } = await supabase.from('departments').select('id, name').order('name')
    if (deptData) {
      setDepartments(deptData)
      if (deptData.length > 0) setDepartmentId(deptData[0].id)
    }

    const { data, error } = await supabase
      .from('work_schedules')
      .select('id, name, check_in_time, check_out_time, detect_until, allow_overtime, applies_to_dept, departments(id, name)')
      .order('applies_to_dept')
      .order('check_in_time')

    if (error) showMessage('error', 'Gagal memuat jadwal: ' + error.message)
    else setSchedules((data as unknown as WorkSchedule[]) || [])
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setMessage(null)

    if (!departmentId) {
      showMessage('error', 'Pilih departemen yang berlaku untuk jadwal ini.')
      setSubmitting(false)
      return
    }

    const checkIn  = checkInTime.length === 5  ? `${checkInTime}:00`  : checkInTime
    const checkOut = checkOutTime.length === 5  ? `${checkOutTime}:00` : checkOutTime
    const detect   = detectUntil ? (detectUntil.length === 5 ? `${detectUntil}:00` : detectUntil) : null

    const { error } = await supabase.from('work_schedules').insert([{
      name,
      check_in_time: checkIn,
      check_out_time: checkOut,
      detect_until: detect,
      allow_overtime: allowOvertime,
      applies_to_dept: departmentId
    }])

    if (error) {
      showMessage('error', 'Gagal menambah jadwal: ' + error.message)
    } else {
      showMessage('success', 'Jadwal kerja berhasil ditambahkan.')
      setName(''); setCheckInTime(''); setCheckOutTime(''); setDetectUntil(''); setAllowOvertime(true)
      setShowForm(false)
      fetchData()
    }
    setSubmitting(false)
  }

  async function handleDelete(schedule: WorkSchedule) {
    if (!confirm(`Hapus jadwal "${schedule.name}"?`)) return
    const { error } = await supabase.from('work_schedules').delete().eq('id', schedule.id)
    if (error) showMessage('error', 'Gagal menghapus jadwal: ' + error.message)
    else { showMessage('success', `Jadwal "${schedule.name}" berhasil dihapus.`); fetchData() }
  }

  const fmt = (t: string | null) => t ? t.substring(0, 5) : '-'

  // Group by department
  const grouped = schedules.reduce((acc, s) => {
    const dept = s.departments?.name || 'Lainnya'
    if (!acc[dept]) acc[dept] = []
    acc[dept].push(s)
    return acc
  }, {} as Record<string, WorkSchedule[]>)

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Jadwal Kerja</h1>
          <p className="text-sm text-slate-500">Setup jadwal & aturan deteksi shift otomatis per departemen.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 shadow-sm"
        >
          {showForm ? 'Batal' : '+ Tambah Jadwal'}
        </button>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-700">
        <p className="font-semibold mb-1">💡 Cara kerja deteksi shift otomatis</p>
        <p>Saat karyawan clock-in, sistem mencocokkan jam masuk dengan <strong>Batas Deteksi</strong> jadwal di departemennya. Jadwal dengan batas terkecil dicek lebih dulu. Jika jam masuk ≤ batas → shift terdeteksi. Jadwal tanpa batas (—) menangkap semua sisa jam masuk.</p>
        <p className="mt-1">Contoh Team Toko: <strong>Shift 1</strong> batas 09:30 + <strong>Shift 2</strong> tanpa batas → masuk ≤09:30 = Shift 1, masuk &gt;09:30 = Shift 2.</p>
      </div>

      {showForm && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Tambah Jadwal Baru</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Nama Jadwal <span className="text-red-500">*</span></label>
              <input type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Misal: Shift Pagi"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Berlaku Untuk Dept <span className="text-red-500">*</span></label>
              <select required value={departmentId} onChange={e => setDepartmentId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Jam Masuk <span className="text-red-500">*</span></label>
              <input type="time" required value={checkInTime} onChange={e => setCheckInTime(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Jam Pulang <span className="text-red-500">*</span></label>
              <input type="time" required value={checkOutTime} onChange={e => setCheckOutTime(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">
                Batas Deteksi Shift
                <span className="ml-1 text-xs text-slate-400 font-normal">(kosongkan jika jadwal tunggal atau shift terakhir)</span>
              </label>
              <input type="time" value={detectUntil} onChange={e => setDetectUntil(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Hitung Overtime?</label>
              <div className="flex gap-4 pt-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" checked={allowOvertime === true} onChange={() => setAllowOvertime(true)} className="text-blue-600" />
                  Ya
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" checked={allowOvertime === false} onChange={() => setAllowOvertime(false)} className="text-blue-600" />
                  Tidak
                </label>
              </div>
            </div>

            <div className="md:col-span-2 lg:col-span-3 pt-2 flex justify-end gap-3">
              <button type="submit" disabled={submitting}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                {submitting ? 'Menyimpan...' : 'Simpan Jadwal'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabel Grouped by Dept */}
      {loading ? (
        <div className="flex justify-center items-center h-32 text-slate-400 text-sm">Memuat data...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">Belum ada jadwal.</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([deptName, deptSchedules]) => (
            <div key={deptName} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-700">{deptName}</span>
                <span className="text-xs text-slate-400">{deptSchedules.length} jadwal</span>
              </div>
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Nama</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Jam Masuk</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Jam Pulang</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase text-center">Batas Deteksi</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase text-center">Overtime</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {deptSchedules.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 text-sm font-medium text-slate-800">{s.name}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-emerald-600">{fmt(s.check_in_time)}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-red-500">{fmt(s.check_out_time)}</td>
                      <td className="px-4 py-3 text-center">
                        {s.detect_until ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-700">
                            ≤ {fmt(s.detect_until)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">— (semua sisa)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.allow_overtime ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {s.allow_overtime ? 'Ya' : 'Tidak'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => handleDelete(s)}
                          className="px-2.5 py-1 text-xs font-medium bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition">
                          Hapus
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
