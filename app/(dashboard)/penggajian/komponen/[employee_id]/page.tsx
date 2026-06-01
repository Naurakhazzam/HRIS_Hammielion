'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import { use } from 'react'

type SalaryComponent = {
  id: string
  base_salary: number
  position_allowance: number
  meal_allowance: number
  overtime_rate_per_hour: number
  late_penalty_per_minute: number
  effective_date: string
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
    overtime_rate_per_hour: '0',
    late_penalty_per_minute: '0',
    effective_date: new Date().toISOString().split('T')[0]
  })

  useEffect(() => {
    if (employee_id) {
      fetchData(employee_id)
    }
  }, [employee_id])

  async function fetchData(empId: string) {
    setLoading(true)
    
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
      
      // Jika ada data lama, set default value form dari data terbaru
      if (salaryData && salaryData.length > 0) {
        const latest = salaryData[0]
        setFormData({
          base_salary: latest.base_salary.toString(),
          position_allowance: latest.position_allowance.toString(),
          meal_allowance: latest.meal_allowance.toString(),
          overtime_rate_per_hour: latest.overtime_rate_per_hour.toString(),
          late_penalty_per_minute: latest.late_penalty_per_minute.toString(),
          effective_date: new Date().toISOString().split('T')[0] // default ke hari ini
        })
      }
    }

    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
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

    // Cek apakah sudah ada record untuk karyawan ini
    const { data: existing } = await supabase
      .from('salary_components')
      .select('id')
      .eq('employee_id', employee_id)
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    const payload = {
      employee_id: employee_id,
      base_salary: baseSalaryNum,
      position_allowance: parseFloat(formData.position_allowance) || 0,
      meal_allowance: parseFloat(formData.meal_allowance) || 0,
      overtime_rate_per_hour: parseFloat(formData.overtime_rate_per_hour) || 0,
      late_penalty_per_minute: parseFloat(formData.late_penalty_per_minute) || 0,
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
      showMessage('success', 'Komponen gaji berhasil diperbarui. Baris histori baru telah ditambahkan.')
      fetchData(employee_id) // Refresh list
    }
    setSubmitting(false)
  }

  const formatRupiah = (angka: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)
  }

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
              <p className="text-[10px] text-slate-500 mt-1">Gaji dengan tgl efektif terbaru akan digunakan sistem otomatis.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Gaji Pokok (Rp) <span className="text-red-500">*</span></label>
              <input 
                type="number" 
                required 
                min="0"
                value={formData.base_salary} 
                onChange={(e) => setFormData({...formData, base_salary: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tunj. Jabatan (Rp)</label>
              <input 
                type="number" 
                min="0"
                value={formData.position_allowance} 
                onChange={(e) => setFormData({...formData, position_allowance: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tunj. Tetap (Rp)</label>
              <input 
                type="number" 
                min="0"
                value={formData.meal_allowance} 
                onChange={(e) => setFormData({...formData, meal_allowance: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tarif Lembur / Jam (Rp)</label>
              <input 
                type="number" 
                min="0"
                value={formData.overtime_rate_per_hour} 
                onChange={(e) => setFormData({...formData, overtime_rate_per_hour: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Potongan Telat / Menit (Rp)</label>
              <input 
                type="number" 
                min="0"
                value={formData.late_penalty_per_minute} 
                onChange={(e) => setFormData({...formData, late_penalty_per_minute: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
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
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Rate Lembur/Jam</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Denda/Mnt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada riwayat gaji untuk karyawan ini.</td>
                  </tr>
                ) : (
                  history.map((h, i) => (
                    <tr key={h.id} className={`${i === 0 ? 'bg-blue-50/30' : 'hover:bg-slate-50'} transition`}>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-800">
                          {new Date(h.effective_date).toLocaleDateString('id-ID')}
                        </div>
                        {i === 0 && <div className="text-[10px] text-blue-600 font-bold uppercase mt-0.5">Aktif Saat Ini</div>}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700 font-medium">
                        {formatRupiah(h.base_salary)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-xs text-slate-600">Jab: {formatRupiah(h.position_allowance)}</div>
                        <div className="text-xs text-slate-600 mt-0.5">Mkn: {formatRupiah(h.meal_allowance)}</div>
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {formatRupiah(h.overtime_rate_per_hour)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-red-600">
                        -{formatRupiah(h.late_penalty_per_minute)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
