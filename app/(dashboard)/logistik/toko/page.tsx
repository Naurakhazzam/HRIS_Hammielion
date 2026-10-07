'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toWaLink } from '@/lib/whatsapp'

type StoreKind = 'toko' | 'pelanggan'
type Store = { id: string; name: string; address: string | null; phone: string | null; is_active: boolean; kind: StoreKind }

const KIND_LABEL: Record<StoreKind, string> = { toko: 'Toko', pelanggan: 'Pelanggan' }

type StoreReturn = {
  id: string; store_id: string; status: 'menunggu' | 'diambil'; note: string | null
  branches: { name: string } | null
  claimer: { full_name: string } | null
}

type Branch = { id: string; name: string }

// Pengaturan cabang grooming (migrasi 069): can_groom = cabang ini mengerjakan grooming;
// groom_branch_id = order yang diterima cabang ini dikerjakan di cabang mana.
type GroomSetting = { branch_id: string; can_groom: boolean; groom_branch_id: string | null; branches: { name: string } | null }

export default function MasterTokoPage() {
  const supabase = createClient()
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  // Tandai Ada Retur -- beda dari canManage (CRUD toko, khusus Kepala Gudang/Owner): ini juga
  // boleh Finance, karena mereka yang sering terima info retur dari toko lewat urusan keuangan.
  const [canFlagReturn, setCanFlagReturn] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [tab, setTab] = useState<'daftar' | 'grooming'>('daftar')
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [kind, setKind] = useState<StoreKind>('toko')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'semua' | StoreKind>('semua')
  const [noPhoneOnly, setNoPhoneOnly] = useState(false)

  const [groomSettings, setGroomSettings] = useState<GroomSetting[]>([])
  const [groomSaving, setGroomSaving] = useState(false)

  const [returnsByStore, setReturnsByStore] = useState<Record<string, StoreReturn>>({})
  const [branches, setBranches] = useState<Branch[]>([])
  const [flagStoreId, setFlagStoreId] = useState<string | null>(null)
  const [flagBranchId, setFlagBranchId] = useState('')
  const [flagNote, setFlagNote] = useState('')
  const [flagSubmitting, setFlagSubmitting] = useState(false)
  const [cancellingReturnId, setCancellingReturnId] = useState<string | null>(null)

  const filteredStores = stores.filter(s => {
    if (kindFilter !== 'semua' && s.kind !== kindFilter) return false
    if (noPhoneOnly && s.phone) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return s.name.toLowerCase().includes(q)
      || (s.address ?? '').toLowerCase().includes(q)
      || (s.phone ?? '').toLowerCase().includes(q)
  })

  const columnCount = 5 + (canFlagReturn ? 1 : 0) + (canManage ? 1 : 0)

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
          setIsOwner(true)
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
    await Promise.all([fetchStores(), fetchReturns(), fetchBranches(), fetchGroomSettings()])
    setLoading(false)
  }

  async function fetchStores() {
    const { data, error } = await supabase.from('logistics_stores').select('*').order('name')
    if (error) showMessage('error', 'Gagal memuat data toko: ' + error.message)
    else setStores(data || [])
  }

  async function fetchReturns() {
    const { data } = await supabase.from('logistics_store_returns')
      .select('id, store_id, status, note, branches(name), claimer:employees!logistics_store_returns_claimed_by_fkey(full_name)')
      .in('status', ['menunggu', 'diambil'])
    const map: Record<string, StoreReturn> = {}
    ;(data as unknown as StoreReturn[] || []).forEach(r => { map[r.store_id] = r })
    setReturnsByStore(map)
  }

  async function fetchBranches() {
    const { data } = await supabase.from('branches').select('id, name').order('name')
    setBranches(data || [])
  }

  async function fetchGroomSettings() {
    const { data } = await supabase.from('logistics_store_branches')
      .select('branch_id, can_groom, groom_branch_id, branches!logistics_store_branches_branch_id_fkey(name)')
    const rows = (data as unknown as GroomSetting[]) || []
    rows.sort((a, b) => (a.branches?.name ?? '').localeCompare(b.branches?.name ?? ''))
    setGroomSettings(rows)
  }

  function updateGroomSetting(branchId: string, patch: Partial<GroomSetting>) {
    setGroomSettings(prev => prev.map(g => {
      if (g.branch_id !== branchId) return g
      const next = { ...g, ...patch }
      // Cabang pengerja selalu mengerjakan order-nya sendiri.
      if (next.can_groom) next.groom_branch_id = next.branch_id
      else if (next.groom_branch_id === next.branch_id) next.groom_branch_id = null
      return next
    }))
  }

  async function saveGroomSettings() {
    setGroomSaving(true)
    const { error } = await supabase.rpc('save_grooming_branch_settings', {
      p_rows: groomSettings.map(g => ({ branch_id: g.branch_id, can_groom: g.can_groom, groom_branch_id: g.groom_branch_id })),
    })
    setGroomSaving(false)
    if (error) showMessage('error', 'Gagal menyimpan pengaturan: ' + error.message)
    else showMessage('success', 'Pengaturan cabang grooming tersimpan.')
    await fetchGroomSettings()
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

  // Lepas klaim: retur 'diambil' kembali 'menunggu' supaya bisa diklaim trip lain (mis. driver
  // tidak jadi ke toko itu). Barang yang sudah tercatat tetap tersimpan.
  async function releaseReturn(r: StoreReturn) {
    if (!confirm(`Lepas klaim retur ini dari ${r.claimer?.full_name ?? 'driver'}? Retur akan kembali "Menunggu Diambil" dan bisa diklaim driver lain.`)) return
    setCancellingReturnId(r.id)
    const { error } = await supabase.rpc('release_store_return', { p_return_id: r.id })
    if (error) showMessage('error', 'Gagal melepas klaim: ' + error.message)
    else { showMessage('success', 'Klaim retur dilepas. Retur kembali menunggu diambil.'); await fetchReturns() }
    setCancellingReturnId(null)
  }

  // Cuma bisa batalkan selagi status masih 'menunggu' (belum diklaim driver manapun) -- sesuai
  // RLS store_returns_delete. Kalau sudah 'diambil', lepas klaim dulu (releaseReturn).
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
    setName(''); setAddress(''); setPhone(''); setKind('toko'); setEditingId(null)
  }

  function openEdit(s: Store) {
    setEditingId(s.id)
    setName(s.name)
    setAddress(s.address || '')
    setPhone(s.phone || '')
    setKind(s.kind)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    if (kind === 'pelanggan' && !phone.trim()) {
      showMessage('error', 'Pelanggan wajib punya nomor HP.')
      setSubmitting(false)
      return
    }
    // Nomor dinormalisasi (08xx) & dicek dobel antar pelanggan oleh trigger DB (migrasi 069).
    const payload = { name: name.trim(), address: address.trim() || null, phone: phone.trim() || null, kind }

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
          <p className="text-sm text-slate-500">Daftar toko tujuan pengiriman & pelanggan grooming. Rencana Pengiriman & Laporan Muat hanya menampilkan jenis Toko.</p>
        </div>
        {canManage && tab === 'daftar' && (
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

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {([['daftar', 'Daftar Toko & Pelanggan'], ['grooming', '✂️ Cabang Grooming']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition ${tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'grooming' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <p className="text-sm text-slate-600 mb-4">
            Cabang yang <b>mengerjakan</b> grooming, dan order dari tiap cabang dikerjakan di mana.
            Dipakai order grooming: &quot;sampai di cabang grooming&quot; = cabang pengerja, bukan cabang penerima order.
            {!isOwner && <span className="block text-amber-700 mt-1">Hanya Owner yang bisa mengubah pengaturan ini.</span>}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-slate-50">Cabang</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center bg-slate-50">Mengerjakan Grooming</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-slate-50">Order Dikerjakan Di</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {groomSettings.map(g => {
                  const workers = groomSettings.filter(w => w.can_groom)
                  return (
                    <tr key={g.branch_id}>
                      <td className="px-4 py-3 text-sm font-medium text-slate-800">{g.branches?.name ?? '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <input type="checkbox" checked={g.can_groom} disabled={!isOwner}
                          onChange={e => updateGroomSetting(g.branch_id, { can_groom: e.target.checked })}
                          className="h-4 w-4 accent-blue-600" />
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {g.can_groom ? (
                          <span className="text-slate-600">{g.branches?.name} (sendiri)</span>
                        ) : (
                          <select value={g.groom_branch_id ?? ''} disabled={!isOwner}
                            onChange={e => updateGroomSetting(g.branch_id, { groom_branch_id: e.target.value || null })}
                            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50">
                            <option value="">— Tidak menerima order grooming —</option>
                            {workers.map(w => <option key={w.branch_id} value={w.branch_id}>{w.branches?.name}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {isOwner && (
            <div className="flex justify-end mt-4">
              <button onClick={saveGroomSettings} disabled={groomSaving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50">
                {groomSaving ? 'Menyimpan...' : 'Simpan Pengaturan'}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'daftar' && (<>
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
              <label className="text-sm font-medium text-slate-700">Jenis <span className="text-red-500">*</span></label>
              <select value={kind} onChange={e => setKind(e.target.value as StoreKind)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="toko">Toko (tujuan pengiriman barang)</option>
                <option value="pelanggan">Pelanggan (grooming)</option>
              </select>
              <p className="text-xs text-slate-400">Pelanggan tidak muncul di Rencana Pengiriman & Laporan Muat.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Nama {KIND_LABEL[kind]} <span className="text-red-500">*</span></label>
              <input type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Misal: Toko Sumber Jaya"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Alamat</label>
              <input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="Opsional"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Nomor Telepon / WhatsApp {kind === 'pelanggan' && <span className="text-red-500">*</span>}</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Misal: 0812xxxxxxx" required={kind === 'pelanggan'}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              <p className="text-xs text-slate-400">
                Disimpan seragam (08xx; +62/62 otomatis diubah).{kind === 'pelanggan' ? ' Nomor pelanggan tidak boleh dobel.' : ' Dipakai driver untuk hubungi toko lewat WhatsApp.'}
              </p>
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

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(['semua', 'toko', 'pelanggan'] as const).map(k => (
          <button key={k} onClick={() => setKindFilter(k)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition ${kindFilter === k ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
            {k === 'semua' ? 'Semua' : KIND_LABEL[k]} ({k === 'semua' ? stores.length : stores.filter(s => s.kind === k).length})
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-slate-600 ml-2">
          <input type="checkbox" checked={noPhoneOnly} onChange={e => setNoPhoneOnly(e.target.checked)} className="accent-blue-600" />
          Tanpa nomor HP ({stores.filter(s => !s.phone).length})
        </label>
      </div>

      {!loading && (search || kindFilter !== 'semua' || noPhoneOnly) && (
        <p className="text-xs text-slate-500 mb-2">
          Menampilkan {filteredStores.length} dari {stores.length} data.
        </p>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nama</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Jenis</th>
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
                <td className="px-4 py-3 text-sm">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.kind === 'pelanggan' ? 'bg-purple-100 text-purple-700' : 'bg-sky-100 text-sky-700'}`}>
                    {KIND_LABEL[s.kind]}
                  </span>
                </td>
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
                        {ret.status === 'diambil' && ret.claimer?.full_name && <span className="text-[11px] text-slate-400">oleh {ret.claimer.full_name}</span>}
                        {ret.status === 'menunggu' ? (
                          <button onClick={() => cancelReturn(ret)} disabled={cancellingReturnId === ret.id}
                            className="text-xs text-red-500 hover:underline disabled:opacity-50">
                            {cancellingReturnId === ret.id ? 'Membatalkan...' : 'Batalkan'}
                          </button>
                        ) : (
                          <button onClick={() => releaseReturn(ret)} disabled={cancellingReturnId === ret.id}
                            className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                            {cancellingReturnId === ret.id ? 'Memproses...' : 'Lepas Klaim'}
                          </button>
                        )}
                      </div>
                    ) : s.kind !== 'toko' ? (
                      <span className="text-slate-300">—</span>
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
      </>)}

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
