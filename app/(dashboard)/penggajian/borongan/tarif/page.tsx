'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type RateConfig = {
  id: string
  rate_per_kg: number
  effective_date: string
  employees: { full_name: string } | null
}

export default function SetupTarifBoronganPage() {
  const [rates, setRates] = useState<RateConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)

  const supabase = createClient()

  const [formData, setFormData] = useState({
    rate_per_kg: '',
    effective_date: new Date().toISOString().split('T')[0]
  })

  useEffect(() => {
    fetchMyUser().then(() => {
      fetchRates()
    })
  }, [])

  async function fetchMyUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase.from('users').select('employee_id').eq('id', user.id).single()
      if (data) {
        setMyEmployeeId(data.employee_id)
      }
    }
  }

  async function fetchRates() {
    setLoading(true)
    const { data, error } = await supabase
      .from('loading_rate_config')
      .select('id, rate_per_kg, effective_date, employees(full_name)')
      .order('effective_date', { ascending: false })

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
      setLoading(false)
      return
    }

    if (!data || data.length === 0) {
      // Auto seed default Rp 20/kg if empty (jika user punya employeeId)
      if (myEmployeeId) {
        const { error: seedError } = await supabase.from('loading_rate_config').insert({
          rate_per_kg: 20,
          effective_date: '2020-01-01',
          set_by: myEmployeeId
        })
        if (!seedError) {
          // Fetch again
          const { data: newData } = await supabase
            .from('loading_rate_config')
            .select('id, rate_per_kg, effective_date, employees(full_name)')
            .order('effective_date', { ascending: false })
          setRates((newData as unknown as RateConfig[]) || [])
        }
      }
    } else {
      setRates((data as unknown as RateConfig[]) || [])
    }
    
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myEmployeeId) {
      showMessage('error', 'Sesi tidak valid. Harap login ulang.')
      return
    }

    setSubmitting(true)
    setMessage(null)

    const rateNum = parseFloat(formData.rate_per_kg)
    if (isNaN(rateNum) || rateNum <= 0) {
      showMessage('error', 'Tarif tidak valid.')
      setSubmitting(false)
      return
    }

    let formattedDate = ''
    try {
      formattedDate = new Date(formData.effective_date).toISOString().split('T')[0]
    } catch (e) {
      showMessage('error', 'Format tanggal tidak valid.')
      setSubmitting(false)
      return
    }

    const { error } = await supabase
      .from('loading_rate_config')
      .insert({
        rate_per_kg: rateNum,
        effective_date: formattedDate,
        set_by: myEmployeeId
      })

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal menyimpan tarif: ' + error.message)
    } else {
      showMessage('success', 'Tarif baru berhasil ditambahkan ke riwayat.')
      setFormData({ ...formData, rate_per_kg: '' })
      fetchRates()
    }
    setSubmitting(false)
  }

  const formatRupiah = (angka: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 2 }).format(angka)
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Setup Tarif Borongan</h1>
        <p className="text-sm text-slate-500">Atur tarif per kilogram untuk pekerja bongkar muat.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Form Insert */}
        <div className="md:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Tarif Baru</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tgl Efektif Berlaku <span className="text-red-500">*</span></label>
              <input 
                type="date" 
                required 
                value={formData.effective_date} 
                onChange={(e) => setFormData({...formData, effective_date: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nominal (Rp) / Kg <span className="text-red-500">*</span></label>
              <input 
                type="number" 
                required 
                min="1"
                step="0.01"
                value={formData.rate_per_kg} 
                onChange={(e) => setFormData({...formData, rate_per_kg: e.target.value})}
                placeholder="Contoh: 20"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>

            <div className="pt-2">
              <button 
                type="submit" 
                disabled={submitting || !myEmployeeId} 
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Tarif'}
              </button>
            </div>
          </form>
        </div>

        {/* List Data */}
        <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tgl Efektif</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Tarif per Kg</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Diatur Oleh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat histori tarif...</td>
                  </tr>
                ) : rates.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada riwayat tarif.</td>
                  </tr>
                ) : (
                  rates.map((r, i) => (
                    <tr key={r.id} className={`${i === 0 ? 'bg-blue-50/30' : 'hover:bg-slate-50'} transition`}>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-800">
                          {new Date(r.effective_date).toLocaleDateString('id-ID')}
                        </div>
                        {i === 0 && <div className="text-[10px] text-blue-600 font-bold uppercase mt-0.5">Aktif Saat Ini</div>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-sm font-bold text-slate-700">{formatRupiah(r.rate_per_kg)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-slate-500">{r.employees?.full_name || 'Sistem'}</div>
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
