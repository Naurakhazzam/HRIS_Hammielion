'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type FreelanceWorker = { id: string; full_name: string }

type LoadingEntry = {
  id: string
  entry_date: string
  total_kg: number
  rate_per_kg: number
  total_earning: number
  payment_status: string
  freelance_workers: { full_name: string } | null
}

export default function RekapBoronganPage() {
  const [entries, setEntries] = useState<LoadingEntry[]>([])
  const [workers, setWorkers] = useState<FreelanceWorker[]>([])
  
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  const [weekOptions, setWeekOptions] = useState<{value: string, label: string}[]>([])
  const [filterWeek, setFilterWeek] = useState('') // value: "YYYY-MM-DD|YYYY-MM-DD"
  const [filterStatus, setFilterStatus] = useState('')
  
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const supabase = createClient()

  const [formData, setFormData] = useState({
    freelance_worker_id: '',
    entry_date: new Date().toISOString().split('T')[0],
    total_kg: ''
  })

  useEffect(() => {
    // Generate Weeks
    const weeks = []
    const today = new Date()
    const currentDay = today.getDay()
    const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay
    
    let currentMonday = new Date(today)
    currentMonday.setDate(today.getDate() + diffToMonday)
    
    for (let i = 0; i < 9; i++) {
      const monday = new Date(currentMonday)
      monday.setDate(currentMonday.getDate() - (i * 7))
      
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      
      const startStr = monday.toISOString().split('T')[0]
      const endStr = sunday.toISOString().split('T')[0]
      
      const startUI = monday.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
      const endUI = sunday.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
      
      weeks.push({
        value: `${startStr}|${endStr}`,
        label: i === 0 ? `Minggu Ini (${startUI} - ${endUI})` : `${startUI} - ${endUI}`
      })
    }
    setWeekOptions(weeks)
    setFilterWeek(weeks[0].value) // Default to current week

    fetchMyUser().then(() => {
      fetchWorkers()
    })
  }, [])

  // Refetch entries when filter changes, but only if week is set
  useEffect(() => {
    if (filterWeek) {
      fetchEntries()
    }
  }, [filterWeek, filterStatus])

  async function fetchMyUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase.from('users').select('employee_id').eq('id', user.id).single()
      if (data) {
        setMyEmployeeId(data.employee_id)
      }
    }
  }

  async function fetchWorkers() {
    const { data } = await supabase.from('freelance_workers').select('id, full_name').eq('is_active', true).order('full_name')
    if (data) setWorkers(data)
  }

  async function fetchEntries() {
    setLoading(true)
    let query = supabase
      .from('loading_entries')
      .select('id, entry_date, total_kg, rate_per_kg, total_earning, payment_status, freelance_workers(full_name)')
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (filterStatus) {
      query = query.eq('payment_status', filterStatus)
    }

    if (filterWeek) {
      const [startOfWeek, endOfWeek] = filterWeek.split('|')
      query = query.gte('entry_date', startOfWeek).lte('entry_date', endOfWeek)
    }

    const { data, error } = await query

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
    } else {
      setEntries((data as unknown as LoadingEntry[]) || [])
    }
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  // Get active rate for a date
  async function getActiveRate(dateStr: string) {
    const { data, error } = await supabase
      .from('loading_rate_config')
      .select('rate_per_kg')
      .lte('effective_date', dateStr)
      .order('effective_date', { ascending: false })
      .limit(1)
      .single()
      
    if (error || !data) {
      // Return fallback
      return 20 
    }
    return data.rate_per_kg
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myEmployeeId) {
      showMessage('error', 'Sesi tidak valid.')
      return
    }

    setSubmitting(true)
    setMessage(null)

    const kgNum = parseFloat(formData.total_kg)
    if (isNaN(kgNum) || kgNum <= 0) {
      showMessage('error', 'Total Kg tidak valid.')
      setSubmitting(false)
      return
    }

    // Cari tarif aktif
    const activeRate = await getActiveRate(formData.entry_date)
    const totalEarning = kgNum * activeRate

    const { error } = await supabase
      .from('loading_entries')
      .insert({
        freelance_worker_id: formData.freelance_worker_id,
        entry_date: formData.entry_date,
        total_kg: kgNum,
        rate_per_kg: activeRate,
        total_earning: totalEarning,
        payment_status: 'unpaid',
        created_by: myEmployeeId
      })

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal mencatat borongan: ' + error.message)
    } else {
      showMessage('success', 'Catatan borongan berhasil disimpan.')
      setFormData({ ...formData, total_kg: '' }) // Reset kg saja
      fetchEntries()
    }
    setSubmitting(false)
  }

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const unpaidIds = entries.filter(ent => ent.payment_status === 'unpaid').map(ent => ent.id)
      setSelectedIds(unpaidIds)
    } else {
      setSelectedIds([])
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function markAsPaid() {
    if (selectedIds.length === 0) return
    if (!myEmployeeId) return
    
    if (!confirm(`Tandai ${selectedIds.length} entri sebagai Lunas?`)) return
    
    setSubmitting(true)
    const { error } = await supabase
      .from('loading_entries')
      .update({
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        paid_by: myEmployeeId
      })
      .in('id', selectedIds)

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal memproses pembayaran: ' + error.message)
    } else {
      showMessage('success', `${selectedIds.length} tagihan berhasil dilunasi.`)
      setSelectedIds([])
      fetchEntries()
    }
    setSubmitting(false)
  }

  const formatRupiah = (angka: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)
  }

  // Summary Calculations
  const summaryTotalKg = entries.reduce((acc, ent) => acc + Number(ent.total_kg), 0)
  const summaryTotalEarning = entries.reduce((acc, ent) => acc + Number(ent.total_earning), 0)
  const summaryPaid = entries.filter(e => e.payment_status === 'paid').length
  const summaryUnpaid = entries.length - summaryPaid

  return (
    <>
    <div>
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Rekap Borongan</h1>
          <p className="text-sm text-slate-500">Catat pekerjaan harian dan proses pembayaran pekerja lepas.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/penggajian/borongan/pekerja" className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
            👥 Pekerja
          </Link>
          <Link href="/penggajian/borongan/tarif" className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
            ⚙️ Tarif
          </Link>
        </div>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Form Input Harian */}
        <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit print-hide">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Catat Borongan</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Pekerja Lepas <span className="text-red-500">*</span></label>
              <select 
                required 
                value={formData.freelance_worker_id} 
                onChange={(e) => setFormData({...formData, freelance_worker_id: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                <option value="">-- Pilih Pekerja --</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Kerja <span className="text-red-500">*</span></label>
              <input 
                type="date" 
                required 
                value={formData.entry_date} 
                onChange={(e) => setFormData({...formData, entry_date: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Total Muatan (Kg) <span className="text-red-500">*</span></label>
              <input 
                type="number" 
                required 
                min="0.1"
                step="0.1"
                value={formData.total_kg} 
                onChange={(e) => setFormData({...formData, total_kg: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>

            <div className="pt-2">
              <button 
                type="submit" 
                disabled={submitting || !myEmployeeId} 
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Entri'}
              </button>
            </div>
          </form>
        </div>

        {/* Tabel Rekap */}
        <div id="rekap-print-area-borongan" className="lg:col-span-3 space-y-4">
          
          <div className="hidden" id="borongan-print-header">
            <div className="text-center mb-4 pb-4 border-b-2 border-slate-800">
              <h1 className="text-xl font-bold text-slate-900 uppercase tracking-wider">HAMMIELION MANAGEMENT</h1>
              <p className="text-sm text-slate-600 mt-1">Rekap Penggajian Borongan</p>
              <p className="text-sm text-slate-600">
                Periode: {weekOptions.find(w => w.value === filterWeek)?.label ?? filterWeek}
              </p>
              <p className="text-xs text-slate-400 mt-1">Dicetak: {new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
            </div>
          </div>
          
          {/* Summary Widget */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Entri</p>
              <p className="text-xl font-bold text-slate-800">{entries.length}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Muatan</p>
              <p className="text-xl font-bold text-blue-600">{summaryTotalKg.toLocaleString('id-ID')} Kg</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Upah</p>
              <p className="text-xl font-bold text-slate-800">{formatRupiah(summaryTotalEarning)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase mb-1">Status Lunas</p>
              <p className="text-sm font-bold text-green-600">{summaryPaid} Lunas</p>
              <p className="text-sm font-bold text-red-500">{summaryUnpaid} Belum</p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Filters & Bulk Actions */}
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print-hide">
              <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Pilih Minggu</label>
                  <select 
                    value={filterWeek} 
                    onChange={(e) => setFilterWeek(e.target.value)}
                    className="w-full sm:w-64 px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white font-medium" 
                  >
                    {weekOptions.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Status Pembayaran</label>
                  <select 
                    value={filterStatus} 
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full sm:w-40 px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white font-medium"
                  >
                    <option value="">Semua Status</option>
                    <option value="unpaid">Belum Dibayar</option>
                    <option value="paid">Lunas</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {selectedIds.length > 0 && (
                  <button
                    onClick={markAsPaid}
                    disabled={submitting}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition whitespace-nowrap"
                  >
                    Lunasi Tagihan Minggu Ini ({selectedIds.length})
                  </button>
                )}
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition"
                >
                  🖨️ Cetak Rekap
                </button>
              </div>
            </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-slate-200">
                  <th className="px-4 py-3 w-10 text-center print-hide">
                    <input 
                      type="checkbox" 
                      onChange={handleSelectAll}
                      checked={selectedIds.length > 0 && selectedIds.length === entries.filter(e => e.payment_status === 'unpaid').length}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Pekerja</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Muatan (Kg)</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Tarif</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Total Upah</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data...</td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada catatan borongan.</td>
                  </tr>
                ) : (
                  entries.map((ent) => (
                    <tr key={ent.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 text-center print-hide">
                        {ent.payment_status === 'unpaid' && (
                          <input 
                            type="checkbox" 
                            checked={selectedIds.includes(ent.id)}
                            onChange={() => toggleSelect(ent.id)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-800">{ent.freelance_workers?.full_name}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-600">{new Date(ent.entry_date).toLocaleDateString('id-ID')}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-semibold text-slate-700">{ent.total_kg} Kg</span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-500">
                        {formatRupiah(ent.rate_per_kg)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-bold text-slate-800">{formatRupiah(ent.total_earning)}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${ent.payment_status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                          {ent.payment_status === 'paid' ? 'Lunas' : 'Belum Lunas'}
                        </span>
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
    </div>
    
    <style>{`
      @media print {
        nav, aside { display: none !important; }
        main { padding: 0 !important; overflow: visible !important; }
        .max-w-6xl { max-width: none !important; }
        .print-hide { display: none !important; }
        #borongan-print-header { display: block !important; }
      }
    `}</style>
    </>
  )
}
