'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import LogisticsCameraCapture from '@/components/LogisticsCameraCapture'
import { usePhotoLightbox } from '@/components/PhotoLightbox'

type Loading = {
  id: string
  store_id: string
  status: 'proses' | 'selesai' | 'dibatalkan'
  created_at: string
  completed_at: string | null
  cancelled_at: string | null
  logistics_stores: { name: string; address: string | null } | null
  creator: { full_name: string } | null
  completer: { full_name: string } | null
  canceller: { full_name: string } | null
}

type LoadingItem = {
  id: string
  photo_url: string
  caption: string
  created_at: string
  employees: { full_name: string } | null
}

type LoadingPackage = {
  id: string
  photo_url: string
  caption: string
  status: 'pending' | 'diambil'
  taken_at: string | null
  creator: { full_name: string } | null
  taken: { full_name: string } | null
}

type Store = { id: string; name: string }

type PackageSummary = { total: number; diambil: number; takers: string[]; lastTakenAt: string | null }

type PickupFilter = 'semua' | 'belum' | 'sudah' | 'proses'

const fmtDateTime = (s: string) => new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function fmtDuration(ms: number) {
  const totalMin = Math.max(0, Math.floor(ms / 60000))
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  if (days > 0) return `${days} hari${hours > 0 ? ` ${hours} jam` : ''}`
  if (hours > 0) return `${hours} jam${mins > 0 ? ` ${mins} menit` : ''}`
  return `${mins} menit`
}

// Makin lama paket nongkrong di Toko Pusat, makin mencolok warnanya.
function waitingTone(ms: number) {
  const hours = ms / 3600000
  if (hours >= 24) return 'bg-red-50 border-red-200 text-red-700'
  if (hours >= 6) return 'bg-orange-50 border-orange-200 text-orange-700'
  return 'bg-amber-50 border-amber-200 text-amber-700'
}

export default function LaporanMuatPage() {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()

  const [loading, setLoading] = useState(true)
  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [myName, setMyName] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [canView, setCanView] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const [loadings, setLoadings] = useState<Loading[]>([])
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({})
  const [packageCounts, setPackageCounts] = useState<Record<string, PackageSummary>>({})
  const [pickupFilter, setPickupFilter] = useState<PickupFilter>('semua')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  const [allStores, setAllStores] = useState<Store[]>([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [storeSearchText, setStoreSearchText] = useState('')
  const [creating, setCreating] = useState(false)

  const [selectedLoadingId, setSelectedLoadingId] = useState<string | null>(null)
  const [detailItems, setDetailItems] = useState<LoadingItem[]>([])
  const [detailPackages, setDetailPackages] = useState<LoadingPackage[]>([])
  const [itemCaptionDraft, setItemCaptionDraft] = useState('')
  const [packageCaptionDraft, setPackageCaptionDraft] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  const fetchLoadings = useCallback(async () => {
    const { data, error } = await supabase
      .from('logistics_central_loadings')
      .select(`
        id, store_id, status, created_at, completed_at, cancelled_at,
        logistics_stores(name, address),
        creator:employees!logistics_central_loadings_created_by_fkey(full_name),
        completer:employees!logistics_central_loadings_completed_by_fkey(full_name),
        canceller:employees!logistics_central_loadings_cancelled_by_fkey(full_name)
      `)
      .order('created_at', { ascending: false })
    if (error) { showMessage('error', 'Gagal memuat laporan muat: ' + error.message); return }
    const rows = (data as unknown as Loading[]) || []
    setLoadings(rows)

    if (rows.length > 0) {
      const ids = rows.map(r => r.id)
      const { data: itemRows } = await supabase.from('logistics_central_loading_items').select('loading_id').in('loading_id', ids)
      const iCounts: Record<string, number> = {}
      ;(itemRows as { loading_id: string }[] || []).forEach(r => { iCounts[r.loading_id] = (iCounts[r.loading_id] || 0) + 1 })
      setItemCounts(iCounts)

      const { data: pkgRows } = await supabase.from('logistics_central_loading_packages')
        .select('loading_id, status, taken_at, taken:employees!logistics_central_loading_packages_taken_by_fkey(full_name)')
        .in('loading_id', ids)
      const pCounts: Record<string, PackageSummary> = {}
      type PkgRow = { loading_id: string; status: string; taken_at: string | null; taken: { full_name: string } | { full_name: string }[] | null }
      ;(pkgRows as unknown as PkgRow[] || []).forEach(r => {
        const s = pCounts[r.loading_id] ??= { total: 0, diambil: 0, takers: [], lastTakenAt: null }
        s.total++
        if (r.status === 'diambil') {
          s.diambil++
          const name = Array.isArray(r.taken) ? r.taken[0]?.full_name : r.taken?.full_name
          if (name && !s.takers.includes(name)) s.takers.push(name)
          if (r.taken_at && (!s.lastTakenAt || r.taken_at > s.lastTakenAt)) s.lastTakenAt = r.taken_at
        }
      })
      setPackageCounts(pCounts)
    } else {
      setItemCounts({})
      setPackageCounts({})
    }
  }, [supabase])

  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: userData } = await supabase.from('users').select('role, employee_id, employees(full_name)').eq('id', user.id).single()
        if (userData) {
          setMyEmployeeId(userData.employee_id || '')
          const me = userData.employees as unknown as { full_name: string } | { full_name: string }[] | null
          setMyName((Array.isArray(me) ? me[0]?.full_name : me?.full_name) || '')
          if (userData.role === 'owner') { setCanEdit(true); setCanView(true) }
          else if (userData.employee_id) {
            const { data: emp } = await supabase.from('employees').select('positions(name), branches(name)').eq('id', userData.employee_id).single()
            type NameRel = { name: string } | { name: string }[] | null
            const pos = emp?.positions as NameRel
            const br = emp?.branches as NameRel
            const position = Array.isArray(pos) ? pos[0]?.name : pos?.name
            const branch = Array.isArray(br) ? br[0]?.name : br?.name
            setCanEdit(branch === 'Toko Pusat')
            setCanView(branch === 'Toko Pusat' || position === 'Kepala Gudang')
          }
        }
      }
      const { data: storeData } = await supabase.from('logistics_stores').select('id, name').eq('is_active', true).order('name')
      setAllStores(storeData || [])
      await fetchLoadings()
      setLoading(false)
    }
    init()
  }, [fetchLoadings, supabase])

  async function fetchDetail(loadingId: string) {
    const { data: items } = await supabase.from('logistics_central_loading_items')
      .select('id, photo_url, caption, created_at, employees(full_name)')
      .eq('loading_id', loadingId).order('created_at')
    setDetailItems((items as unknown as LoadingItem[]) || [])

    const { data: packages } = await supabase.from('logistics_central_loading_packages')
      .select(`
        id, photo_url, caption, status, taken_at,
        creator:employees!logistics_central_loading_packages_created_by_fkey(full_name),
        taken:employees!logistics_central_loading_packages_taken_by_fkey(full_name)
      `)
      .eq('loading_id', loadingId).order('created_at')
    setDetailPackages((packages as unknown as LoadingPackage[]) || [])
  }

  function toggleSelect(id: string) {
    if (selectedLoadingId === id) { setSelectedLoadingId(null); return }
    setSelectedLoadingId(id)
    setItemCaptionDraft('')
    setPackageCaptionDraft('')
    fetchDetail(id)
  }

  const availableStores = allStores
  const matchedStore = availableStores.find(s => s.name.trim().toLowerCase() === storeSearchText.trim().toLowerCase())

  async function handleCreateLoading(e: React.FormEvent) {
    e.preventDefault()
    if (!matchedStore) { showMessage('error', 'Toko tidak ditemukan. Ketik nama toko lalu pilih dari saran yang muncul.'); return }
    setCreating(true)
    const { data, error } = await supabase.from('logistics_central_loadings').insert({
      store_id: matchedStore.id, created_by: myEmployeeId,
    }).select('id').single()
    setCreating(false)
    if (error || !data) { showMessage('error', 'Gagal membuat laporan muat: ' + error?.message); return }
    setStoreSearchText('')
    setShowCreateForm(false)
    await fetchLoadings()
    setSelectedLoadingId(data.id)
    setItemCaptionDraft('')
    setPackageCaptionDraft('')
    fetchDetail(data.id)
  }

  async function uploadCentralPhoto(loadingId: string, blob: Blob, tag: string): Promise<string | null> {
    const path = `${loadingId}/${tag}-${Date.now()}.jpg`
    const { error } = await supabase.storage.from('logistics-photos').upload(path, blob, { contentType: 'image/jpeg' })
    if (error) { showMessage('error', 'Gagal unggah foto: ' + error.message); return null }
    const { data } = supabase.storage.from('logistics-photos').getPublicUrl(path)
    return data.publicUrl
  }

  async function handleAddItemPhoto(blob: Blob) {
    if (!selectedLoadingId || !itemCaptionDraft.trim()) return
    const url = await uploadCentralPhoto(selectedLoadingId, blob, 'item')
    if (!url) return
    const { error } = await supabase.from('logistics_central_loading_items').insert({
      loading_id: selectedLoadingId, photo_url: url, caption: itemCaptionDraft.trim(), created_by: myEmployeeId,
    })
    if (error) { showMessage('error', 'Gagal menyimpan foto: ' + error.message); return }
    setItemCaptionDraft('')
    await fetchDetail(selectedLoadingId)
    await fetchLoadings()
  }

  async function handleDeleteItem(itemId: string) {
    if (!selectedLoadingId || !confirm('Hapus foto ini?')) return
    const { error } = await supabase.from('logistics_central_loading_items').delete().eq('id', itemId)
    if (error) { showMessage('error', 'Gagal menghapus: ' + error.message); return }
    await fetchDetail(selectedLoadingId)
    await fetchLoadings()
  }

  async function handleAddPackagePhoto(blob: Blob) {
    if (!selectedLoadingId || !packageCaptionDraft.trim()) return
    const url = await uploadCentralPhoto(selectedLoadingId, blob, 'package')
    if (!url) return
    const { error } = await supabase.from('logistics_central_loading_packages').insert({
      loading_id: selectedLoadingId, photo_url: url, caption: packageCaptionDraft.trim(), created_by: myEmployeeId,
    })
    if (error) { showMessage('error', 'Gagal menyimpan foto: ' + error.message); return }
    setPackageCaptionDraft('')
    await fetchDetail(selectedLoadingId)
    await fetchLoadings()
  }

  async function handleDeletePackage(packageId: string) {
    if (!selectedLoadingId || !confirm('Hapus paket ini?')) return
    const { error } = await supabase.from('logistics_central_loading_packages').delete().eq('id', packageId)
    if (error) { showMessage('error', 'Gagal menghapus: ' + error.message); return }
    await fetchDetail(selectedLoadingId)
    await fetchLoadings()
  }

  async function handleBatalkan() {
    if (!selectedLoadingId) return
    if (!confirm('Batalkan laporan muat ini? Laporan tidak akan terlihat lagi oleh driver, tapi riwayatnya (foto & data) tetap tersimpan.')) return
    setCancelling(true)
    const { error } = await supabase.from('logistics_central_loadings').update({
      status: 'dibatalkan', cancelled_by: myEmployeeId, cancelled_at: new Date().toISOString(),
    }).eq('id', selectedLoadingId).eq('status', 'proses')
    setCancelling(false)
    if (error) { showMessage('error', 'Gagal membatalkan: ' + error.message); return }
    showMessage('success', 'Laporan muat dibatalkan.')
    await fetchLoadings()
    await fetchDetail(selectedLoadingId)
  }

  async function handleTandaiSelesai() {
    if (!selectedLoadingId || detailPackages.length === 0) return
    if (!confirm('Tandai laporan muat ini selesai? Foto tidak bisa ditambah/dihapus lagi setelah ini.')) return
    setFinishing(true)
    const { error } = await supabase.from('logistics_central_loadings').update({
      status: 'selesai', completed_by: myEmployeeId, completed_at: new Date().toISOString(),
    }).eq('id', selectedLoadingId).eq('status', 'proses')
    setFinishing(false)
    if (error) { showMessage('error', 'Gagal menandai selesai: ' + error.message); return }
    showMessage('success', 'Laporan muat ditandai selesai. Toko tujuan sudah bisa dijemput driver.')
    await fetchLoadings()
    await fetchDetail(selectedLoadingId)
  }

  function pickupGroup(l: Loading): 'belum' | 'sudah' | 'proses' | 'batal' {
    if (l.status === 'dibatalkan') return 'batal'
    if (l.status === 'proses') return 'proses'
    const pkg = packageCounts[l.id]
    return pkg && pkg.diambil < pkg.total ? 'belum' : 'sudah'
  }

  // Yang belum diambil ditaruh paling atas, paling lama nunggu duluan.
  const visibleLoadings = (pickupFilter === 'semua' ? loadings : loadings.filter(l => pickupGroup(l) === pickupFilter))
    .slice()
    .sort((a, b) => {
      const aw = pickupGroup(a) === 'belum' ? 0 : 1
      const bw = pickupGroup(b) === 'belum' ? 0 : 1
      if (aw !== bw) return aw - bw
      if (aw === 0) return (a.completed_at ?? '').localeCompare(b.completed_at ?? '')
      return b.created_at.localeCompare(a.created_at)
    })

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  if (!canView) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Laporan Muat</h1>
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mt-4">
          Cuma Team Toko Pusat, Kepala Gudang, atau Owner yang bisa membuka halaman ini.
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Laporan Muat</h1>
          <p className="text-sm text-slate-500">
            {canEdit ? 'Laporkan barang toko tujuan yang harus diambil driver dari Toko Pusat.' : 'Pantau laporan muat dari Toko Pusat.'}
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
            {showCreateForm ? 'Batal' : '+ Buat Laporan Baru'}
          </button>
        )}
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {showCreateForm && canEdit && (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 mb-6">
          <form onSubmit={handleCreateLoading} className="flex gap-2">
            <input type="text" list="laporan-muat-stores-datalist" value={storeSearchText}
              onChange={e => setStoreSearchText(e.target.value)}
              placeholder="Ketik nama toko tujuan..."
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
            <datalist id="laporan-muat-stores-datalist">
              {availableStores.map(s => <option key={s.id} value={s.name} />)}
            </datalist>
            <button type="submit" disabled={!matchedStore || creating}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
              {creating ? 'Membuat...' : '+ Buat'}
            </button>
          </form>
        </div>
      )}

      {(() => {
        const cards: { key: PickupFilter; label: string; count: number; tone: string; active: string }[] = [
          { key: 'belum', label: 'Belum Diambil', count: loadings.filter(l => pickupGroup(l) === 'belum').length,
            tone: 'border-orange-200 text-orange-700', active: 'bg-orange-50 ring-2 ring-orange-400' },
          { key: 'sudah', label: 'Sudah Diambil', count: loadings.filter(l => pickupGroup(l) === 'sudah').length,
            tone: 'border-blue-200 text-blue-700', active: 'bg-blue-50 ring-2 ring-blue-400' },
          { key: 'proses', label: 'Masih Proses', count: loadings.filter(l => pickupGroup(l) === 'proses').length,
            tone: 'border-amber-200 text-amber-700', active: 'bg-amber-50 ring-2 ring-amber-400' },
          { key: 'semua', label: 'Semua', count: loadings.length,
            tone: 'border-slate-200 text-slate-700', active: 'bg-slate-50 ring-2 ring-slate-400' },
        ]
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {cards.map(c => (
              <button key={c.key} onClick={() => setPickupFilter(c.key)}
                className={`text-left bg-white border rounded-xl px-4 py-3 transition hover:shadow-sm ${c.tone} ${pickupFilter === c.key ? c.active : ''}`}>
                <p className="text-2xl font-bold">{c.count}</p>
                <p className="text-xs font-medium">{c.label}</p>
              </button>
            ))}
          </div>
        )
      })()}

      <div className="space-y-3">
        {visibleLoadings.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            {loadings.length === 0 ? 'Belum ada laporan muat.' : 'Tidak ada laporan muat di kategori ini.'}
          </div>
        ) : visibleLoadings.map(l => {
          const pkg = packageCounts[l.id] || { total: 0, diambil: 0, takers: [], lastTakenAt: null }
          const isOpen = selectedLoadingId === l.id
          const group = pickupGroup(l)
          const waitingMs = group === 'belum' && l.completed_at ? now - new Date(l.completed_at).getTime() : 0
          return (
            <div key={l.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <button onClick={() => toggleSelect(l.id)} className="w-full text-left px-5 py-4 hover:bg-slate-50 transition flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{l.logistics_stores?.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Dibuat oleh {l.creator?.full_name ?? '-'} · {fmtDateTime(l.created_at)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {itemCounts[l.id] || 0} foto barang · {pkg.total} paket{pkg.total > 0 ? ` (${pkg.diambil} diambil)` : ''}
                  </p>
                  {group === 'belum' && l.completed_at && (
                    <p className={`inline-block mt-1.5 text-xs font-semibold px-2 py-1 rounded-md border ${waitingTone(waitingMs)}`}>
                      ⏱ Sudah {fmtDuration(waitingMs)} belum diambil
                      {pkg.diambil > 0 ? ` · sisa ${pkg.total - pkg.diambil} dari ${pkg.total} paket` : ''}
                    </p>
                  )}
                  {pkg.takers.length > 0 && (
                    <p className="text-xs text-blue-700 mt-1">
                      🚚 Diambil oleh {pkg.takers.join(', ')}{group === 'sudah' && pkg.lastTakenAt ? ` · ${fmtDateTime(pkg.lastTakenAt)}` : ''}
                    </p>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                    l.status === 'selesai' ? 'bg-green-100 text-green-700' : l.status === 'dibatalkan' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {l.status === 'selesai' ? 'Selesai' : l.status === 'dibatalkan' ? 'Dibatalkan' : 'Proses'}
                  </span>
                  {l.status === 'selesai' && pkg.total > 0 && (
                    pkg.diambil < pkg.total ? (
                      <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-orange-100 text-orange-700">
                        Belum Diambil{pkg.diambil > 0 ? ` (${pkg.diambil}/${pkg.total})` : ''}
                      </span>
                    ) : (
                      <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-blue-100 text-blue-700">Sudah Diambil</span>
                    )
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-slate-100 p-5 space-y-6">
                  {l.status === 'selesai' && (
                    <p className="text-xs text-slate-400">Diselesaikan oleh {l.completer?.full_name ?? '-'} · {l.completed_at ? fmtDateTime(l.completed_at) : '-'}</p>
                  )}
                  {l.status === 'dibatalkan' && (
                    <p className="text-xs text-red-500">Dibatalkan oleh {l.canceller?.full_name ?? '-'} · {l.cancelled_at ? fmtDateTime(l.cancelled_at) : '-'}</p>
                  )}

                  {/* Foto Laporan Muat */}
                  <div>
                    <p className="text-sm font-bold text-slate-700 mb-2">📋 Foto Laporan Muat ({detailItems.length})</p>
                    {detailItems.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                        {detailItems.map(it => (
                          <div key={it.id} className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={it.photo_url} alt={it.caption} onClick={() => openLightbox(it.photo_url, it.caption)}
                              className="w-full aspect-square object-cover rounded-lg border border-slate-200 cursor-zoom-in" />
                            <p className="text-xs text-slate-600 mt-1 truncate" title={it.caption}>{it.caption}</p>
                            {canEdit && l.status === 'proses' && (
                              <button onClick={() => handleDeleteItem(it.id)}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-red-600 text-white rounded-full text-xs shadow">✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {canEdit && l.status === 'proses' && (
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                        <input type="text" value={itemCaptionDraft} onChange={e => setItemCaptionDraft(e.target.value)}
                          placeholder="Keterangan barang (contoh: loqy klg salmon 6)"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        {itemCaptionDraft.trim() ? (
                          <LogisticsCameraCapture label="Foto Barang" employeeName={myName} onCaptured={handleAddItemPhoto} />
                        ) : (
                          <p className="text-xs text-slate-400 text-center py-2">Isi keterangan barang dulu sebelum foto.</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Foto Hasil Packing */}
                  <div>
                    <p className="text-sm font-bold text-slate-700 mb-2">📦 Foto Hasil Packing / Paket ({detailPackages.length})</p>
                    {detailPackages.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                        {detailPackages.map(pk => (
                          <div key={pk.id} className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={pk.photo_url} alt={pk.caption} onClick={() => openLightbox(pk.photo_url, pk.caption)}
                              className="w-full aspect-square object-cover rounded-lg border border-slate-200 cursor-zoom-in" />
                            <p className="text-xs text-slate-600 mt-1 truncate" title={pk.caption}>{pk.caption}</p>
                            {pk.status === 'diambil' ? (
                              <span className="inline-block mt-0.5 text-[11px] px-1.5 py-0.5 rounded font-medium bg-green-100 text-green-700">
                                ✓ Diambil {pk.taken?.full_name ?? ''} · {pk.taken_at ? fmtDateTime(pk.taken_at) : ''}
                              </span>
                            ) : l.status === 'selesai' && l.completed_at ? (
                              <span className={`inline-block mt-0.5 text-[11px] px-1.5 py-0.5 rounded font-medium border ${waitingTone(now - new Date(l.completed_at).getTime())}`}>
                                ⏱ Belum diambil · {fmtDuration(now - new Date(l.completed_at).getTime())}
                              </span>
                            ) : (
                              <span className="inline-block mt-0.5 text-[11px] px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-500">Belum diambil</span>
                            )}
                            {canEdit && l.status === 'proses' && (
                              <button onClick={() => handleDeletePackage(pk.id)}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-red-600 text-white rounded-full text-xs shadow">✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {canEdit && l.status === 'proses' && (
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                        <input type="text" value={packageCaptionDraft} onChange={e => setPackageCaptionDraft(e.target.value)}
                          placeholder="Keterangan paket (contoh: Paket 1/3)"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        {packageCaptionDraft.trim() ? (
                          <LogisticsCameraCapture label="Foto Hasil Packing" employeeName={myName} onCaptured={handleAddPackagePhoto} />
                        ) : (
                          <p className="text-xs text-slate-400 text-center py-2">Isi keterangan paket dulu sebelum foto.</p>
                        )}
                      </div>
                    )}
                  </div>

                  {canEdit && l.status === 'proses' && (
                    <div className="flex gap-2">
                      <button onClick={handleBatalkan} disabled={cancelling}
                        className="px-4 py-2.5 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium rounded-lg transition disabled:opacity-50">
                        {cancelling ? 'Membatalkan...' : 'Batalkan Laporan'}
                      </button>
                      <button onClick={handleTandaiSelesai} disabled={detailPackages.length === 0 || finishing}
                        className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50">
                        {finishing ? 'Menyimpan...' : detailPackages.length === 0 ? 'Tambah minimal 1 foto packing dulu' : '✓ Tandai Selesai — Bisa Dijemput Driver'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
