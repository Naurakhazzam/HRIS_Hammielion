'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id: string; name: string }

type BranchShift = {
  id: string
  name: string
  check_in_time: string
  check_out_time: string
  detect_until: string | null
  allow_overtime: boolean
  branch_id: string
  branches: Branch
}

export default function ShiftCabangPage() {
  const [shifts, setShifts] = useState<BranchShift[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const [name, setName] = useState('')
  const [checkInTime, setCheckInTime] = useState('')
  const [checkOutTime, setCheckOutTime] = useState('')
  const [branchId, setBranchId] = useState('')
  const [detectUntil, setDetectUntil] = useState('')
  const [allowOvertime, setAllowOvertime] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data: branchData } = await supabase.from('branches').select('id, name').order('name')
    if (branchData) {
      setBranches(branchData)
      if (branchData.length > 0) setBranchId(branchData[0].id)
    }

    const { data, error } = await supabase
      .from('branch_shift_schedules')
      .select('id, name, check_in_time, check_out_time, detect_until, allow_overtime, branch_id, branches(id, name)')
      .eq('is_active', true)
      .order('branch_id')
      .order('check_in_time')

    if (error) showMessage('error', 'Gagal memuat jadwal shift: ' + error.message)
    else setShifts((data as unknown as BranchShift[]) || [])
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

    if (!branchId) {
      showMessage('error', 'Pilih cabang yang berlaku untuk shift ini.')
      setSubmitting(false)
      return
    }

    const checkIn  = checkInTime.length === 5  ? `${checkInTime}:00`  : checkInTime
    const checkOut = checkOutTime.length === 5  ? `${checkOutTime}:00` : checkOutTime
    const detect   = detectUntil ? (detectUntil.length === 5 ? `${detectUntil}:00` : detectUntil) : null

    const payload = {
      name,
      check_in_time: checkIn,
      check_out_time: checkOut,
      detect_until: detect,
      allow_overtime: allowOvertime,
      branch_id: branchId,
    }

    const { error } = editingId
      ? await supabase.from('branch_shift_schedules').update(payload).eq('id', editingId)
      : await supabase.from('branch_shift_schedules').insert([payload])

    if (error) {
      showMessage('error', (editingId ? 'Gagal menyimpan perubahan: ' : 'Gagal menambah shift: ') + error.message)
    } else {
      showMessage('success', editingId ? 'Shift cabang berhasil diperbarui.' : 'Shift cabang berhasil ditambahkan.')
      resetForm()
      setShowForm(false)
      fetchData()
    }
    setSubmitting(false)
  }

  function resetForm() {
    setName(''); setCheckInTime(''); setCheckOutTime(''); setDetectUntil(''); setAllowOvertime(true)
    setEditingId(null)
    if (branches.length > 0) setBranchId(branches[0].id)
  }

  function openEdit(s: BranchShift) {
    setEditingId(s.id)
    setName(s.name)
    setCheckInTime(s.check_in_time.substring(0, 5))
    setCheckOutTime(s.check_out_time.substring(0, 5))
    setDetectUntil(s.detect_until ? s.detect_until.substring(0, 5) : '')
    setAllowOvertime(s.allow_overtime)
    setBranchId(s.branch_id)
    setShowForm(true)
    setMessage(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleDelete(shift: BranchShift) {
    if (!confirm(`Hapus shift "${shift.name}" di ${shift.branches?.name}?`)) return
    const { error } = await supabase.from('branch_shift_schedules').delete().eq('id', shift.id)
    if (error) showMessage('error', 'Gagal menghapus shift: ' + error.message)
    else { showMessage('success', `Shift "${shift.name}" berhasil dihapus.`); fetchData() }
  }

  const fmt = (t: string | null) => t ? t.substring(0, 5) : '-'

  // Group by cabang
  const grouped = shifts.reduce((acc, s) => {
    const cabang = s.branches?.name || 'Lainnya'
    if (!acc[cabang]) acc[cabang] = []
    acc[cabang].push(s)
    return acc
  }, {} as Record<string, BranchShift[]>)

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Jadwal Shift Cabang</h1>
          <p className="text-sm text-slate-500">Jam buka & shift per cabang — dipakai khusus untuk hitung telat/lembur saat karyawan absen "Perbantuan" di cabang yang bukan penempatannya.</p>
        </div>
        <button
          onClick={() => { if (showForm) resetForm(); setShowForm(!showForm) }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 shadow-sm"
        >
          {showForm ? 'Batal' : '+ Tambah Shift'}
        </button>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-700">
        <p className="font-semibold mb-1">💡 Kapan jadwal ini dipakai</p>
        <p>Absen normal di cabang sendiri tetap pakai <strong>Jadwal Kerja</strong> per departemen seperti biasa (menu terpisah) — jadwal ini TIDAK berpengaruh ke situ. Jadwal ini cuma dipakai saat karyawan scan QR cabang lain dan memilih "Perbantuan": telat/pulang-cepat/lembur hari itu dihitung dari shift cabang tempat dia perbantuan, bukan jadwal departemennya.</p>
        <p className="mt-1">Cabang yang belum punya shift di sini: kalau ada yang perbantuan ke situ, dianggap tidak telat/tidak lembur dulu sampai di-setup.</p>
      </div>

      {showForm && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">{editingId ? 'Edit Shift' : 'Tambah Shift Baru'}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Nama Shift <span className="text-red-500">*</span></label>
              <input type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Misal: Shift 1"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Cabang <span className="text-red-500">*</span></label>
              <select required value={branchId} onChange={e => setBranchId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
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
                <span className="ml-1 text-xs text-slate-400 font-normal">(kosongkan jika shift tunggal atau shift terakhir)</span>
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
              {editingId && (
                <button type="button" onClick={() => { resetForm(); setShowForm(false) }}
                  className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-lg transition">
                  Batal
                </button>
              )}
              <button type="submit" disabled={submitting}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                {submitting ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Simpan Shift'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center h-32 text-slate-400 text-sm">Memuat data...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">Belum ada shift cabang.</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([cabangName, cabangShifts]) => (
            <div key={cabangName} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-700">{cabangName}</span>
                <span className="text-xs text-slate-400">{cabangShifts.length} shift</span>
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
                  {cabangShifts.map(s => (
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
                        <div className="flex gap-2 justify-center">
                          <button onClick={() => openEdit(s)}
                            className="px-2.5 py-1 text-xs font-medium bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 rounded transition">
                            Edit
                          </button>
                          <button onClick={() => handleDelete(s)}
                            className="px-2.5 py-1 text-xs font-medium bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition">
                            Hapus
                          </button>
                        </div>
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
