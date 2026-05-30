'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type Position = { id: string; name: string }
type KPITemplate = {
  id: string
  position_id: string
  criteria_name: string
  weight_percent: number
  is_active: boolean
  positions?: { name: string }
}

export default function KPISetupPage() {
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [templates, setTemplates] = useState<KPITemplate[]>([])
  
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  const supabase = createClient()

  const [formData, setFormData] = useState({
    position_id: '',
    criteria_name: '',
    weight_percent: '20'
  })

  useEffect(() => {
    checkRoleAndFetchData()
  }, [])

  async function checkRoleAndFetchData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = userData?.role || ''
    setCurrentUserRole(role)

    if (role === 'owner' || role === 'hr') {
      await fetchPositions()
      await fetchTemplates()
    }
    
    setLoading(false)
  }

  async function fetchPositions() {
    const { data } = await supabase.from('positions').select('id, name').order('name')
    if (data) setPositions(data)
  }

  async function fetchTemplates() {
    const { data } = await supabase
      .from('kpi_templates')
      .select('id, position_id, criteria_name, weight_percent, is_active, positions(name)')
      .order('position_id')
      .order('criteria_name')
      
    if (data) setTemplates(data as unknown as KPITemplate[])
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setMessage(null)
    
    const { error } = await supabase
      .from('kpi_templates')
      .insert({
        position_id: formData.position_id,
        criteria_name: formData.criteria_name,
        weight_percent: parseFloat(formData.weight_percent) || 0,
        is_active: true
      })

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal menyimpan kriteria: ' + error.message)
    } else {
      showMessage('success', 'Kriteria KPI berhasil ditambahkan.')
      setFormData({ ...formData, criteria_name: '' })
      fetchTemplates()
    }
    setSubmitting(false)
  }

  async function toggleStatus(templateId: string, currentStatus: boolean) {
    setSubmitting(true)
    const { error } = await supabase
      .from('kpi_templates')
      .update({ is_active: !currentStatus })
      .eq('id', templateId)

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal mengupdate status: ' + error.message)
    } else {
      showMessage('success', 'Status kriteria berhasil diperbarui.')
      fetchTemplates()
    }
    setSubmitting(false)
  }

  async function handleDelete(templateId: string, criteriaName: string) {
    if (!confirm(`Hapus kriteria "${criteriaName}"?\n\nSemua data checklist harian dan skor penilaian untuk kriteria ini juga akan ikut terhapus.`)) return
    setSubmitting(true)

    // 1. Hapus kpi_daily_entries (checklist harian) yang merujuk kriteria ini
    const { error: e1 } = await supabase
      .from('kpi_daily_entries')
      .delete()
      .eq('criteria_id', templateId)
    if (e1) console.error('Delete daily_entries error:', JSON.stringify(e1, null, 2))

    // 2. Hapus kpi_scores yang merujuk kriteria ini
    const { error: e2 } = await supabase
      .from('kpi_scores')
      .delete()
      .eq('criteria_id', templateId)
    if (e2) console.error('Delete scores error:', JSON.stringify(e2, null, 2))

    // 3. Baru hapus template kriteria
    const { error: e3 } = await supabase
      .from('kpi_templates')
      .delete()
      .eq('id', templateId)

    if (e3) {
      console.error('Delete template error:', JSON.stringify(e3, null, 2))
      showMessage('error', 'Gagal menghapus kriteria: ' + e3.message)
    } else {
      showMessage('success', `Kriteria "${criteriaName}" berhasil dihapus.`)
      fetchTemplates()
    }
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="flex flex-col items-center gap-2 text-slate-400">
          <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span className="text-sm">Memuat...</span>
        </div>
      </div>
    )
  }

  if (currentUserRole !== 'owner' && currentUserRole !== 'hr') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
        <span className="text-4xl mb-3">🔒</span>
        <h2 className="text-xl font-bold text-slate-700">Akses Ditolak</h2>
        <p>Anda tidak memiliki akses ke halaman ini.</p>
        <Link href="/dashboard" className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition">
          Kembali ke Dashboard
        </Link>
      </div>
    )
  }

  const positionWeightWarnings = positions
    .map(pos => {
      const posTemplates = templates.filter(t => t.position_id === pos.id && t.is_active)
      if (posTemplates.length === 0) return null
      const total = posTemplates.reduce((acc, t) => acc + Number(t.weight_percent), 0)
      return total !== 100 ? `${pos.name} (total: ${total}%)` : null
    })
    .filter(Boolean)

  return (
    <div className="space-y-6">
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Setup Kriteria KPI</h1>
          <p className="text-sm text-slate-500">Kelola kriteria penilaian KPI per jabatan.</p>
        </div>
        <Link href="/kpi" className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
          Kembali ke Rekap KPI
        </Link>
      </div>

      {message && (
        <div className={`p-4 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Kolom Kiri: Form Tambah Kriteria */}
        <div className="xl:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Tambah Kriteria Baru</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jabatan <span className="text-red-500">*</span></label>
              <select 
                required 
                value={formData.position_id} 
                onChange={(e) => setFormData({...formData, position_id: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                <option value="">-- Pilih Jabatan --</option>
                {positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama Kriteria <span className="text-red-500">*</span></label>
              <input 
                type="text" 
                required 
                placeholder="Cth: Kehadiran, Kualitas Kerja"
                value={formData.criteria_name} 
                onChange={(e) => setFormData({...formData, criteria_name: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Bobot (%) <span className="text-red-500">*</span></label>
              <input 
                type="number" 
                required 
                min="1"
                max="100"
                placeholder="Cth: 20"
                value={formData.weight_percent} 
                onChange={(e) => setFormData({...formData, weight_percent: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>

            <div className="pt-2">
              <button 
                type="submit" 
                disabled={submitting} 
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Kriteria'}
              </button>
            </div>
          </form>
        </div>

        {/* Kolom Kanan: Tabel Kriteria per Jabatan */}
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <h2 className="text-sm font-bold text-slate-800">Daftar Kriteria KPI</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-slate-200">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-1/4">Jabatan</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nama Kriteria</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center w-24">Bobot (%)</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center w-24">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center w-24">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {templates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada kriteria KPI yang disetup.</td>
                    </tr>
                  ) : (
                    templates.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-slate-800">{t.positions?.name || '-'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-slate-700">{t.criteria_name}</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm font-medium text-slate-600">{t.weight_percent}%</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${t.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                            {t.is_active ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => toggleStatus(t.id, t.is_active)}
                            disabled={submitting}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition disabled:opacity-50 ${
                              t.is_active 
                                ? 'bg-white border border-red-200 text-red-600 hover:bg-red-50' 
                                : 'bg-white border border-green-200 text-green-600 hover:bg-green-50'
                            }`}
                          >
                            {t.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                          <button
                            onClick={() => handleDelete(t.id, t.criteria_name)}
                            disabled={submitting}
                            className="px-2.5 py-1 rounded text-xs font-medium transition disabled:opacity-50 bg-white border border-red-200 text-red-600 hover:bg-red-50 ml-1"
                          >
                            Hapus
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            
            {positionWeightWarnings.length > 0 && (
              <div className="mx-4 mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-700">
                ⚠️ Total bobot belum 100% untuk jabatan: {positionWeightWarnings.join(', ')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
