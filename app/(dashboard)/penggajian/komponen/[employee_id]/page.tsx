'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import RupiahInput from '@/components/RupiahInput'
import { useRouter } from 'next/navigation'
import { localDateStr } from '@/lib/date'
import Link from 'next/link'

import { use } from 'react'

type SalaryComponent = {
  id: string
  base_salary: number
  position_allowance: number
  meal_allowance: number
  special_allowance: number
  overtime_rate_per_hour: number
  late_penalty_per_minute: number
  effective_date: string
}

// Slip gaji memakai SATU baris komponen per periode (26–25): baris terakhir yang tanggal
// efektifnya <= tanggal 25 akhir periode (lihat buildSlipPreview di penggajian/bulanan). Jadi baris
// bertanggal efektif d berlaku mulai periode yang memuat d -- dan TERTIMPA (tidak pernah dipakai)
// kalau ada baris lebih baru yang tanggalnya masih di periode yang sama.
function periodEndOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const endY = d >= 26 && m === 12 ? y + 1 : y
  const endM = d >= 26 ? (m % 12) + 1 : m
  return `${endY}-${String(endM).padStart(2, '0')}-25`
}
function periodLabelOf(date: string): string {
  const end = periodEndOf(date)
  return new Date(end + 'T00:00:00').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
}
function fmtTgl(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
}
/** Baris lebih baru yang menimpa baris bertanggal `date` di periode yang sama (kalau ada). */
function overriddenBy(date: string, rows: { effective_date: string }[]): string | null {
  const end = periodEndOf(date)
  const newer = rows.map(r => r.effective_date).filter(d => d > date && d <= end).sort()
  return newer.length ? newer[newer.length - 1] : null
}

export default function DetailKomponenGajiPage({ params }: { params: Promise<{ employee_id: string }> }) {
  const { employee_id } = use(params)
  const router = useRouter()
  const supabase = createClient()
  const [employee, setEmployee] = useState<any>(null)
  const [history, setHistory] = useState<SalaryComponent[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const [formData, setFormData] = useState({
    base_salary: '',
    position_allowance: '0',
    meal_allowance: '0',
    special_allowance: '0',
    overtime_rate_per_hour: '0',
    effective_date: localDateStr(new Date())
  })

  function showMessage(type: 'success' | 'error', text: string, ms = 5000) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), ms)
  }

  useEffect(() => {
    if (employee_id) {
      fetchData(employee_id)
    }
  }, [employee_id])

  async function fetchData(empId: string, keepForm = false) {
    if (!keepForm) setLoading(true)
    
    // Fetch Employee Info
    const { data: empData, error: empError } = await supabase
      .from('employees')
      .select('id, full_name, employee_type, branches(name), positions(name)')
      .eq('id', empId)
      .single()

    if (empError) {
      console.error('Detail error:', JSON.stringify(empError, null, 2))
      showMessage('error', 'Karyawan tidak ditemukan: ' + empError.message)
      setLoading(false)
      return
    }
    setEmployee(empData)

    // Fetch Salary History
    const { data: salaryData, error: salaryError } = await supabase
      .from('salary_components')
      .select('*')
      .eq('employee_id', empId)
      .order('effective_date', { ascending: false })

    if (salaryError) {
      console.error('Detail error:', JSON.stringify(salaryError, null, 2))
      showMessage('error', 'Gagal memuat histori gaji: ' + salaryError.message)
    } else {
      setHistory(salaryData || [])

      if (keepForm) {
        // Sesudah simpan/hapus: biarkan isi form apa adanya.
      } else if (salaryData && salaryData.length > 0) {
        // Sudah ada riwayat — isi form dari data terbaru seperti biasa.
        const latest = salaryData[0]
        setFormData({
          base_salary: latest.base_salary.toString(),
          position_allowance: latest.position_allowance.toString(),
          meal_allowance: latest.meal_allowance.toString(),
          special_allowance: (latest.special_allowance ?? 0).toString(),
          overtime_rate_per_hour: latest.overtime_rate_per_hour.toString(),
          effective_date: localDateStr(new Date()) // default ke hari ini
        })
      } else {
        // Belum ada riwayat sama sekali (karyawan baru) — bantu isi dari Gaji Standar supaya
        // HR tidak perlu ketik ulang angka yang sama seperti karyawan lain.
        const { data: def } = await supabase.from('salary_defaults').select('base_salary, position_allowance, meal_allowance').order('label').limit(1).maybeSingle()
        if (def) {
          setFormData(f => ({
            ...f,
            base_salary: def.base_salary.toString(),
            position_allowance: def.position_allowance.toString(),
            meal_allowance: def.meal_allowance.toString(),
          }))
        }
      }
    }

    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setMessage(null)

    const baseSalaryNum = parseFloat(formData.base_salary)
    if (isNaN(baseSalaryNum) || baseSalaryNum < 0) {
      showMessage('error', 'Gaji Pokok tidak valid.')
      setSubmitting(false)
      return
    }

    // Memastikan format effective_date adalah YYYY-MM-DD
    let formattedDate = ''
    try {
      formattedDate = new Date(formData.effective_date).toISOString().split('T')[0]
    } catch (e) {
      showMessage('error', 'Format tanggal tidak valid.')
      setSubmitting(false)
      return
    }

    // Cari baris dengan tanggal efektif PERSIS SAMA — kalau ada, berarti ini koreksi untuk
    // tanggal yang sama (ditimpa); kalau beda, ini perubahan baru jadi ditambah baris riwayat
    // baru. (Sebelumnya kode ini selalu menimpa baris TERAKHIR apa pun tanggal efektifnya,
    // jadi histori kenaikan gaji tidak pernah benar-benar tersimpan berjenjang.)
    const { data: existing } = await supabase
      .from('salary_components')
      .select('id')
      .eq('employee_id', employee_id)
      .eq('effective_date', formattedDate)
      .maybeSingle()

    const payload = {
      employee_id: employee_id,
      base_salary: baseSalaryNum,
      position_allowance: parseFloat(formData.position_allowance) || 0,
      meal_allowance: parseFloat(formData.meal_allowance) || 0,
      special_allowance: parseFloat(formData.special_allowance) || 0,
      overtime_rate_per_hour: parseFloat(formData.overtime_rate_per_hour) || 0,
      effective_date: formattedDate
    }

    const { error } = existing
      ? await supabase.from('salary_components').update(payload).eq('id', existing.id)
      : await supabase.from('salary_components').insert(payload)

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
      console.error('Supabase error:', error.message, error.details, error.hint)
      showMessage('error', `Gagal menyimpan komponen gaji: ${error.message} (Detail: ${error.details || '-'})`)
    } else {
      const base = existing ? 'Komponen gaji untuk tanggal efektif ini diperbarui.' : 'Baris riwayat gaji baru ditambahkan.'
      // Peringatkan kalau perubahan ini tertimpa baris yang lebih baru di periode yang sama --
      // dulu disimpan "berhasil" tapi slip tetap memakai baris lain tanpa penjelasan apa pun.
      const over = overriddenBy(formattedDate, history)
      if (over) {
        showMessage('error', `${base} TAPI slip periode ${periodLabelOf(formattedDate)} tetap memakai baris tanggal ${fmtTgl(over)} (lebih baru). Hapus baris ${fmtTgl(over)} kalau perubahan ini yang harus berlaku.`, 15000)
      } else {
        showMessage('success', `${base} Berlaku mulai slip periode ${periodLabelOf(formattedDate)}.`)
      }
      fetchData(employee_id, true) // Refresh list, form tetap seperti yang baru disimpan
    }
    setSubmitting(false)
  }

  function loadRowToForm(h: SalaryComponent) {
    setFormData({
      base_salary: String(h.base_salary),
      position_allowance: String(h.position_allowance),
      meal_allowance: String(h.meal_allowance),
      special_allowance: String(h.special_allowance ?? 0),
      overtime_rate_per_hour: String(h.overtime_rate_per_hour),
      effective_date: h.effective_date,
    })
    showMessage('success', `Baris ${fmtTgl(h.effective_date)} dimuat ke form. Ubah angkanya lalu Simpan untuk mengoreksi baris ini.`)
  }

  async function deleteRow(h: SalaryComponent) {
    if (history.length <= 1) { showMessage('error', 'Baris terakhir tidak bisa dihapus — karyawan harus punya minimal 1 komponen gaji.'); return }
    if (!confirm(`Hapus baris komponen gaji tanggal efektif ${fmtTgl(h.effective_date)}?\n\nSlip yang SUDAH dibuat tidak berubah. Slip yang dibuat sesudah ini akan memakai baris lain yang berlaku.`)) return
    const { error } = await supabase.from('salary_components').delete().eq('id', h.id)
    if (error) showMessage('error', 'Gagal menghapus: ' + error.message)
    else { showMessage('success', `Baris ${fmtTgl(h.effective_date)} dihapus.`); fetchData(employee_id, true) }
  }

  const formatRupiah = (angka: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)
  }

  // Baris yang dipakai slip periode berjalan = baris terakhir dengan tgl efektif <= tgl 25 akhir
  // periode ini (history sudah urut tanggal efektif menurun).
  const currentPeriodEnd = periodEndOf(localDateStr(new Date()))
  const currentRowId = history.find(h => h.effective_date <= currentPeriodEnd)?.id ?? null

  if (loading) return <div className="p-8 text-center text-slate-500">Memuat data...</div>
  if (!employee) return <div className="p-8 text-center text-red-500">Karyawan tidak ditemukan.</div>

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">{employee.full_name}</h1>
          <p className="text-sm text-slate-500">
            {employee.positions?.name} • {employee.branches?.name} • <span className="capitalize">{employee.employee_type}</span>
          </p>
        </div>
        <Link
          href="/penggajian/komponen"
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          &larr; Kembali ke Daftar
        </Link>
      </div>

      {message && (
        <div className={`p-4 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Form Insert */}
        <div className="md:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Perbarui Komponen</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Efektif <span className="text-red-500">*</span></label>
              <input 
                type="date" 
                required 
                value={formData.effective_date} 
                onChange={(e) => setFormData({...formData, effective_date: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
              {formData.effective_date && (
                <p className="text-[10px] text-slate-500 mt-1">
                  Berlaku mulai slip periode <strong>{periodLabelOf(formData.effective_date)}</strong> (26–25). Tiap periode memakai baris terakhir yang tanggal efektifnya ≤ tanggal 25 akhir periode.
                </p>
              )}
              {formData.effective_date && overriddenBy(formData.effective_date, history) && (
                <p className="text-[10px] text-red-600 font-medium mt-1">
                  ⚠️ Ada baris lebih baru ({fmtTgl(overriddenBy(formData.effective_date, history)!)}) di periode yang sama — perubahan dengan tanggal ini TIDAK akan terpakai di slip {periodLabelOf(formData.effective_date)}.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Gaji Pokok (Rp) <span className="text-red-500">*</span></label>
              <RupiahInput
                required
                value={formData.base_salary}
                onChange={(v) => setFormData({...formData, base_salary: v})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tunj. Jabatan (Rp)</label>
              <RupiahInput
                value={formData.position_allowance}
                onChange={(v) => setFormData({...formData, position_allowance: v})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tunj. Tetap (Rp)</label>
              <RupiahInput
                value={formData.meal_allowance}
                onChange={(v) => setFormData({...formData, meal_allowance: v})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tunj. Khusus (Rp)</label>
              <RupiahInput
                value={formData.special_allowance}
                onChange={(v) => setFormData({...formData, special_allowance: v})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <p className="text-[10px] text-slate-500 mt-1">Khusus karyawan ini saja — beda dari gaji standar yang sama untuk sesama posisi.</p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
              <p className="text-xs text-slate-500">Tarif <strong>lembur</strong>, <strong>telat</strong>, dan potongan tidak masuk kerja berlaku sama untuk semua staff — atur di <Link href="/penggajian/potongan-lembur" className="text-blue-600 hover:underline">Potongan &amp; Lembur</Link>, bukan di sini.</p>
            </div>

            <div className="pt-2">
              <button 
                type="submit" 
                disabled={submitting} 
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          </form>
        </div>

        {/* Tabel Histori */}
        <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-bold text-slate-800">Riwayat Perubahan Gaji</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-white border-b border-slate-200">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tgl Efektif</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Gaji Pokok</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Tunjangan</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Tunj. Khusus</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada riwayat gaji untuk karyawan ini.</td>
                  </tr>
                ) : (
                  history.map((h) => {
                    const over = overriddenBy(h.effective_date, history)
                    const isCurrent = h.id === currentRowId
                    return (
                    <tr key={h.id} className={`${isCurrent ? 'bg-blue-50/30' : over ? 'bg-red-50/40' : 'hover:bg-slate-50'} transition`}>
                      <td className="px-4 py-3">
                        <div className={`text-sm font-medium ${over ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                          {fmtTgl(h.effective_date)}
                        </div>
                        {over ? (
                          <div className="text-[10px] text-red-600 font-bold mt-0.5">Tidak terpakai — tertimpa baris {fmtTgl(over)}</div>
                        ) : (
                          <div className="text-[10px] text-slate-500 mt-0.5">Mulai slip {periodLabelOf(h.effective_date)}</div>
                        )}
                        {isCurrent && <div className="text-[10px] text-blue-600 font-bold uppercase mt-0.5">Dipakai periode berjalan</div>}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700 font-medium">
                        {formatRupiah(h.base_salary)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-xs text-slate-600">Jab: {formatRupiah(h.position_allowance)}</div>
                        <div className="text-xs text-slate-600 mt-0.5">Mkn: {formatRupiah(h.meal_allowance)}</div>
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">
                        {h.special_allowance > 0 ? formatRupiah(h.special_allowance) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button type="button" onClick={() => loadRowToForm(h)} className="text-xs text-blue-600 hover:text-blue-800 font-medium mr-3">Ubah</button>
                        <button type="button" onClick={() => deleteRow(h)} className="text-xs text-red-600 hover:text-red-800 font-medium">Hapus</button>
                      </td>
                    </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
