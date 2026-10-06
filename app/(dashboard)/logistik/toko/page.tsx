'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toWaLink } from '@/lib/whatsapp'

type Store = { id: string; name: string; address: string | null; phone: string | null; is_active: boolean }

type StoreReturn = {
  id: string; store_id: string; status: 'menunggu' | 'diambil'; note: string | null
  branches: { name: string } | null
}

type Branch = { id: string; name: string }

export default function MasterTokoPage() {
  const supabase = createClient()
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  // Tandai Ada Retur -- beda dari canManage (CRUD toko, khusus Kepala Gudang/Owner): ini juga
  // boleh Finance, karena mereka yang sering terima info retur dari toko lewat urusan keuangan.
  const [canFlagReturn, setCanFlagReturn] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')

  const [returnsByStore, setReturnsByStore] = useState<Record<string, StoreReturn>>({})
  const [branches, setBranches] = useState<Branch[]>([])
  const [flagStoreId, setFlagStoreId] = useState<string | null>(null)
  const [flagBranchId, setFlagBranchId] = useState('')
  const [flagNote, setFlagNote] = useState('')
  const [flagSubmitting, setFlagSubmitting] = useState(false)
  const [cancellingReturnId, setCancellingReturnId] = useState<string | null>(null)

  const filteredStores = stores.filter(s => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return s.name.toLowerCase().includes(q)
      || (s.address ?? '').toLowerCase().includes(q)
      || (s.phone ?? '').toLowerCase().includes(q)
  })

  const columnCount = 4 + (canFlagReturn ? 1 : 0) + (canManage ? 1 : 0)

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
          setCanFlagReturn(true)
        } else if (userData.role === 'finance') {
          setCanFlagReturn(true)
        } else if (userData.employee_id) {
          const { data: emp } = await supabase.from('employees').select('positions(name)').eq('id', userData.employee_id).single()
          const posName = (emp as any)?.positions?.name
          setCanManage(posName === 'Kepala Gudang')
          setCanFlagReturn(posName === 'Kepala Gudang')
        }
      }
    }
    await Promise.all([fetchStores(), fetchReturns(), fetchBranches()])
    setLoading(false)
  }

  async function fetchStores() {
    const { data, error } = await supabase.from('logistics_stores').select('*').order('name')
    if (error) showMessage('error', 'Gagal memuat data toko: ' + error.message)
    else setStores(data || [])
  }

  async function fetchReturns() {
    const { data } = await supabase.from('logistics_store_returns')
      .select('id, store_id, status, note, branches(name)').in('status', ['menunggu', 'diambil'])
    const map: Record<string, StoreReturn> = {}
    ;(data as unknown as StoreReturn[] || []).forEach(r => { map[r.store_id] = r })
    setReturnsByStore(map)
  }

  async function fetchBranches() {
    const { data } = await supabase.from('branches').select('id, name').order('name')
    setBranches(data || [])
  }

  function openFlagReturn(storeId: string) {
    setFlagStoreId(storeId)
    setFlagBranchId('')
    setFlagNote('')
  }

  async function submitFlagReturn() {
    if (!flagStoreId || !flagBranchId) return
    setFlagSubmitting(true)
    const { error } = await supabase.rpc('flag_store_return', {
      p_store_id: flagStoreId, p_recipient_branch_id: flagBranchId, p_note: flagNote.trim() || null,
    })
    if (error) showMessage('error', 'Gagal menandai retur: ' + error.message)
    else showMessage('success', 'Toko berhasil ditandai ada retur menunggu diambil.')
    setFlagStoreId(null)
    await fetchReturns()
    setFlagSubmitting(false)
  }

  // Cuma bisa batalkan selagi status masih 'menunggu' (belum diklaim driver manapun) -- sesuai
  // RLS store_returns_delete. Kalau sudah 'diambil', biarkan driver yang menyelesaikannya.
  async function cancelReturn(r: StoreReturn) {
    if (!confirm('Batalkan penandaan retur untuk toko ini?')) return
    setCancellingReturnId(r.id)
    const { error } = await supabase.from('logistics_store_returns').delete().eq('id', r.id)
    if (error) showMessage('error', 'Gagal membatalkan: ' + error.message)
    else { showMessage('success', 'Penandaan retur dibatalkan.'); await fetchReturns() }
    setCancellingReturnId(null)
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

      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Cari nama toko, alamat, atau nomor WhatsApp..."
          className="w-full pl-9 pr-9 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            aria-label="Bersihkan pencarian"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        )}
      </div>

      {!loading && search && (
        <p className="text-xs text-slate-500 mb-2">
          Menampilkan {filteredStores.length} dari {stores.length} toko.
        </p>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nama Toko</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Alamat</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">WhatsApp</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
              {canFlagReturn && <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Retur</th>}
              {canManage && <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading && stores.length === 0 ? (
              <tr><td colSpan={columnCount} className="px-4 py-8 text-center text-slate-400 text-sm">Memuat data...</td></tr>
            ) : stores.length === 0 ? (
              <tr><td colSpan={columnCount} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada toko.</td></tr>
            ) : filteredStores.length === 0 ? (
              <tr><td colSpan={columnCount} className="px-4 py-8 text-center text-slate-500 text-sm">Tidak ada toko yang cocok dengan pencarian "{search}".</td></tr>
            ) : filteredStores.map(s => {
              const ret = returnsByStore[s.id]
              return (
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
                {canFlagReturn && (
                  <td className="px-4 py-3 text-center">
                    {ret ? (
                      <div className="flex flex-col items-center gap-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ret.status === 'menunggu' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                          {ret.status === 'menunggu' ? 'Menunggu Diambil' : 'Sedang Diambil'}
                        </span>
                        {ret.branches?.name && <span className="text-[11px] text-slate-400">untuk {ret.branches.name}</span>}
                        {ret.status === 'menunggu' && (
                          <button onClick={() => cancelReturn(ret)} disabled={cancellingReturnId === ret.id}
                            className="text-xs text-red-500 hover:underline disabled:opacity-50">
                            {cancellingReturnId === ret.id ? 'Membatalkan...' : 'Batalkan'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <button onClick={() => openFlagReturn(s.id)}
                        className="px-2.5 py-1 text-xs font-medium bg-white border border-amber-200 text-amber-600 hover:bg-amber-50 rounded transition">
                        + Tandai Ada Retur
                      </button>
                    )}
                  </td>
                )}
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
            )})}
          </tbody>
        </table>
      </div>

      {flagStoreId && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-slate-800 mb-1">Tandai Ada Retur</h3>
            <p className="text-xs text-slate-500 mb-4">{stores.find(s => s.id === flagStoreId)?.name}</p>
            <label className="text-xs font-medium text-slate-600 block mb-1">Barang Milik Cabang <span className="text-red-500">*</span></label>
            <select required value={flagBranchId} onChange={e => setFlagBranchId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none mb-1">
              <option value="">-- Pilih Cabang --</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <p className="text-[11px] text-slate-400 mb-3">Cuma karyawan di cabang ini (atau Owner) yang nanti bisa konfirmasi terima barangnya di Penerimaan Retur.</p>
            <label className="text-xs font-medium text-slate-600 block mb-1">Catatan (opsional)</label>
            <textarea value={flagNote} onChange={e => setFlagNote(e.target.value)} rows={3}
              placeholder="Misal: toko telepon, ada barang rusak mau diretur"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none mb-4" />
            <p className="text-[11px] text-slate-400 mb-4">Detail barang (nama, foto, alasan) akan diisi driver sendiri saat mengambil di lapangan.</p>
            <div className="flex gap-3">
              <button onClick={() => setFlagStoreId(null)} className="flex-1 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Batal</button>
              <button onClick={submitFlagReturn} disabled={!flagBranchId || flagSubmitting}
                className="flex-1 py-2 text-sm text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50">
                {flagSubmitting ? 'Menyimpan...' : 'Tandai'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
