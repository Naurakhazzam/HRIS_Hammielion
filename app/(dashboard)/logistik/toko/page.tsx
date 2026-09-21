'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toWaLink } from '@/lib/whatsapp'

type Store = { id: string; name: string; address: string | null; phone: string | null; is_active: boolean }

export default function MasterTokoPage() {
  const supabase = createClient()
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: userData } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      if (userData) {
        // Cek posisi = Kepala Gudang (mirror RLS is_kepala_gudang_or_owner) — cuma untuk
        // sembunyikan tombol di UI, proteksi utama tetap di RLS.
        if (userData.role === 'owner') {
          setCanManage(true)
        } else if (userData.employee_id) {
          const { data: emp } = await supabase.from('employees').select('positions(name)').eq('id', userData.employee_id).single()
          const posName = (emp as any)?.positions?.name
          setCanManage(posName === 'Kepala Gudang')
        }
      }
    }
    await fetchStores()
    setLoading(false)
  }

  async function fetchStores() {
    const { data, error } = await supabase.from('logistics_stores').select('*').order('name')
    if (error) showMessage('error', 'Gagal memuat data toko: ' + error.message)
    else setStores(data || [])
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  function resetForm() {
    setName(''); setAddress(''); setPhone(''); setEditingId(null)
  }

  function openEdit(s: Store) {
    setEditingId(s.id)
    setName(s.name)
    setAddress(s.address || '')
    setPhone(s.phone || '')
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const payload = { name: name.trim(), address: address.trim() || null, phone: phone.trim() || null }

    const { error } = editingId
      ? await supabase.from('logistics_stores').update(payload).eq('id', editingId)
      : await supabase.from('logistics_stores').insert([payload])

    if (error) {
      showMessage('error', (editingId ? 'Gagal menyimpan perubahan: ' : 'Gagal menambah toko: ') + error.message)
    } else {
      showMessage('success', editingId ? 'Toko berhasil diperbarui.' : 'Toko berhasil ditambahkan.')
      resetForm()
      setShowForm(false)
      fetchStores()
    }
    setSubmitting(false)
  }

  async function toggleActive(s: Store) {
    const { error } = await supabase.from('logistics_stores').update({ is_active: !s.is_active }).eq('id', s.id)
    if (error) showMessage('error', 'Gagal mengubah status: ' + error.message)
    else { showMessage('success', `Toko "${s.name}" ${s.is_active ? 'dinonaktifkan' : 'diaktifkan'}.`); fetchStores() }
  }

  async function handleDelete(s: Store) {
    if (!confirm(`Hapus toko "${s.name}"? Kalau toko ini sudah pernah dipakai di rencana pengiriman, sebaiknya nonaktifkan saja, bukan dihapus.`)) return
    const { error } = await supabase.from('logistics_stores').delete().eq('id', s.id)
    if (error) showMessage('error', 'Gagal menghapus toko (mungkin masih dipakai di rencana pengiriman): ' + error.message)
    else { showMessage('success', `Toko "${s.name}" berhasil dihapus.`); fetchStores() }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Master Toko</h1>
          <p className="text-sm text-slate-500">Daftar toko tujuan pengiriman — dipakai saat menyusun Rencana Pengiriman.</p>
        </div>
        {canManage && (
          <button
            onClick={() => { if (showForm) resetForm(); setShowForm(!showForm) }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 shadow-sm"
          >
            {showForm ? 'Batal' : '+ Tambah Toko'}
          </button>
        )}
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {!loading && !canManage && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-6">
          Cuma Kepala Gudang atau Owner yang bisa menambah/mengubah data toko. Kamu tetap bisa lihat daftarnya di bawah.
        </div>
      )}

      {showForm && canManage && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">{editingId ? 'Edit Toko' : 'Tambah Toko Baru'}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Nama Toko <span className="text-red-500">*</span></label>
              <input type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Misal: Toko Sumber Jaya"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Alamat</label>
              <input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="Opsional"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Nomor Telepon / WhatsApp</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Misal: 0812xxxxxxx"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              <p className="text-xs text-slate-400">Dipakai driver untuk hubungi toko langsung lewat WhatsApp.</p>
            </div>
            <div className="md:col-span-2 pt-2 flex justify-end gap-3">
              {editingId && (
                <button type="button" onClick={() => { resetForm(); setShowForm(false) }}
                  className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-lg transition">
                  Batal
                </button>
              )}
              <button type="submit" disabled={submitting}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                {submitting ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Simpan Toko'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nama Toko</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Alamat</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">WhatsApp</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
              {canManage && <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">Memuat data...</td></tr>
            ) : stores.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada toko.</td></tr>
            ) : stores.map(s => (
              <tr key={s.id} className="hover:bg-slate-50 transition">
                <td className="px-4 py-3 text-sm font-medium text-slate-800">{s.name}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{s.address || '—'}</td>
                <td className="px-4 py-3 text-sm">
                  {s.phone ? (
                    <a href={toWaLink(s.phone)} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-green-600 hover:underline font-medium">
                      💬 {s.phone}
                    </a>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {s.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                {canManage && (
                  <td className="px-4 py-3 text-center">
                    <div className="flex gap-2 justify-center">
                      <button onClick={() => openEdit(s)} className="px-2.5 py-1 text-xs font-medium bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 rounded transition">Edit</button>
                      <button onClick={() => toggleActive(s)} className="px-2.5 py-1 text-xs font-medium bg-white border border-amber-200 text-amber-600 hover:bg-amber-50 rounded transition">
                        {s.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button onClick={() => handleDelete(s)} className="px-2.5 py-1 text-xs font-medium bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition">Hapus</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
