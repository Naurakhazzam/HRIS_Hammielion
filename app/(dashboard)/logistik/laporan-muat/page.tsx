'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import LogisticsCameraCapture from '@/components/LogisticsCameraCapture'
import { usePhotoLightbox } from '@/components/PhotoLightbox'
import RupiahInput from '@/components/RupiahInput'

type Loading = {
  id: string
  store_id: string
  status: 'proses' | 'selesai' | 'dibatalkan'
  delivery_method: 'driver' | 'toko_pusat'
  ongkir: number
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

// Status kiriman jalur "Diantar Toko Pusat Sendiri" (dari stop trip yang masih hidup).
type TpInfo = { pjName: string; pickupAt: string; arrivedAt: string | null; tripStatus: string; returnAt: string | null }

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID')

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
  const [tpInfo, setTpInfo] = useState<Record<string, TpInfo>>({})
  const [isOwner, setIsOwner] = useState(false)
  const [pickupFilter, setPickupFilter] = useState<PickupFilter>('semua')

  // Form "Tandai Selesai": pilih jalur antar + ongkir.
  const [finishMethod, setFinishMethod] = useState<'driver' | 'toko_pusat' | null>(null)
  const [ongkirMode, setOngkirMode] = useState<'tidak' | 'ada' | null>(null)
  const [ongkirDraft, setOngkirDraft] = useState('')
  // Pindah jalur / ubah ongkir setelah selesai.
  const [editMode, setEditMode] = useState<'method' | 'ongkir' | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  // Tambah toko baru ke Master Toko (kalau belum terdaftar).
  const [showNewStore, setShowNewStore] = useState(false)
  const [newStoreAddress, setNewStoreAddress] = useState('')
  const [newStorePhone, setNewStorePhone] = useState('')
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
        id, store_id, status, delivery_method, ongkir, created_at, completed_at, cancelled_at,
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

      const tpIds = rows.filter(r => r.delivery_method === 'toko_pusat').map(r => r.id)
      const tMap: Record<string, TpInfo> = {}
      if (tpIds.length > 0) {
        const { data: stopRows } = await supabase.from('logistics_tp_trip_stops')
          .select('loading_id, arrived_at, logistics_tp_trips(status, pickup_at, return_at, pj:employees!logistics_tp_trips_pj_id_fkey(full_name))')
          .in('loading_id', tpIds).is('cancelled_at', null)
        type StopRow = { loading_id: string; arrived_at: string | null; logistics_tp_trips: { status: string; pickup_at: string; return_at: string | null; pj: { full_name: string } | null } | null }
        ;(stopRows as unknown as StopRow[] || []).forEach(s => {
          const t = s.logistics_tp_trips
          if (!t) return
          tMap[s.loading_id] = { pjName: t.pj?.full_name ?? '-', pickupAt: t.pickup_at, arrivedAt: s.arrived_at, tripStatus: t.status, returnAt: t.return_at }
        })
      }
      setTpInfo(tMap)
    } else {
      setItemCounts({})
      setPackageCounts({})
      setTpInfo({})
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
          if (userData.role === 'owner') { setCanEdit(true); setCanView(true); setIsOwner(true) }
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
    resetFinishForm()
    fetchDetail(id)
  }

  function resetFinishForm() {
    setFinishMethod(null)
    setOngkirMode(null)
    setOngkirDraft('')
    setEditMode(null)
  }

  // Ongkir dari form: null = belum valid (belum pilih / "ada" tapi nominal kosong).
  function ongkirFromForm(): number | null {
    if (ongkirMode === 'tidak') return 0
    if (ongkirMode === 'ada') {
      const n = parseInt(ongkirDraft || '0', 10)
      return n > 0 ? n : null
    }
    return null
  }

  const availableStores = allStores
  const matchedStore = availableStores.find(s => s.name.trim().toLowerCase() === storeSearchText.trim().toLowerCase())

  async function handleCreateLoading(e: React.FormEvent) {
    e.preventDefault()
    let storeId = matchedStore?.id
    if (!storeId) {
      if (!showNewStore) { showMessage('error', 'Toko tidak ditemukan. Pilih dari saran yang muncul, atau tambahkan sebagai toko baru.'); return }
      setCreating(true)
      const { data: newId, error: storeErr } = await supabase.rpc('quick_create_logistics_store', {
        p_name: storeSearchText, p_address: newStoreAddress, p_phone: newStorePhone,
      })
      if (storeErr || !newId) { setCreating(false); showMessage('error', 'Gagal menambah toko: ' + storeErr?.message); return }
      storeId = newId as string
    }
    setCreating(true)
    const { data, error } = await supabase.from('logistics_central_loadings').insert({
      store_id: storeId, created_by: myEmployeeId,
    }).select('id').single()
    setCreating(false)
    if (error || !data) { showMessage('error', 'Gagal membuat laporan muat: ' + error?.message); return }
    if (showNewStore) {
      const { data: storeData } = await supabase.from('logistics_stores').select('id, name').eq('is_active', true).order('name')
      setAllStores(storeData || [])
    }
    setStoreSearchText('')
    setShowNewStore(false)
    setNewStoreAddress('')
    setNewStorePhone('')
    setShowCreateForm(false)
    resetFinishForm()
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
    if (!selectedLoadingId || detailPackages.length === 0 || !finishMethod) return
    const ongkir = finishMethod === 'toko_pusat' ? ongkirFromForm() : 0
    if (ongkir === null) { showMessage('error', 'Pilih "Tidak ada ongkir" atau isi nominal ongkirnya.'); return }
    const jalur = finishMethod === 'driver'
      ? 'DIANTAR DRIVER (muncul di Jemput Toko Pusat)'
      : `DIANTAR TOKO PUSAT SENDIRI (ongkir ${ongkir > 0 ? fmtRp(ongkir) : 'tidak ada'})`
    if (!confirm(`Tandai laporan muat ini selesai — ${jalur}?\nFoto tidak bisa ditambah/dihapus lagi setelah ini.`)) return
    setFinishing(true)
    const { error } = await supabase.rpc('finish_central_loading', {
      p_loading_id: selectedLoadingId, p_method: finishMethod, p_ongkir: ongkir,
    })
    setFinishing(false)
    if (error) { showMessage('error', 'Gagal menandai selesai: ' + error.message); return }
    showMessage('success', finishMethod === 'driver'
      ? 'Laporan muat ditandai selesai. Toko tujuan sudah bisa dijemput driver.'
      : 'Laporan muat ditandai selesai. Kiriman muncul di menu Kirim Barang untuk diantar orang Toko Pusat.')
    resetFinishForm()
    window.dispatchEvent(new Event('kirim-barang-badge-refresh'))
    await fetchLoadings()
    await fetchDetail(selectedLoadingId)
  }

  async function handleSaveEdit(l: Loading) {
    if (!editMode) return
    setSavingEdit(true)
    let error
    if (editMode === 'method') {
      const target = l.delivery_method === 'driver' ? 'toko_pusat' : 'driver'
      const ongkir = target === 'toko_pusat' ? ongkirFromForm() : 0
      if (ongkir === null) { setSavingEdit(false); showMessage('error', 'Pilih "Tidak ada ongkir" atau isi nominal ongkirnya.'); return }
      ;({ error } = await supabase.rpc('set_central_loading_method', { p_loading_id: l.id, p_method: target, p_ongkir: ongkir }))
    } else {
      const ongkir = ongkirFromForm()
      if (ongkir === null) { setSavingEdit(false); showMessage('error', 'Pilih "Tidak ada ongkir" atau isi nominal ongkirnya.'); return }
      ;({ error } = await supabase.rpc('set_central_loading_ongkir', { p_loading_id: l.id, p_ongkir: ongkir }))
    }
    setSavingEdit(false)
    if (error) { showMessage('error', 'Gagal menyimpan: ' + error.message); return }
    showMessage('success', editMode === 'method' ? 'Jalur pengantaran berhasil dipindah.' : 'Ongkir berhasil diubah.')
    resetFinishForm()
    window.dispatchEvent(new Event('kirim-barang-badge-refresh'))
    await fetchLoadings()
  }

  function pickupGroup(l: Loading): 'belum' | 'sudah' | 'proses' | 'batal' {
    if (l.status === 'dibatalkan') return 'batal'
    if (l.status === 'proses') return 'proses'
    if (l.delivery_method === 'toko_pusat') return tpInfo[l.id] ? 'sudah' : 'belum'
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

  function renderOngkirPicker() {
    const n = parseInt(ongkirDraft || '0', 10)
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-600">Ongkir (sesuai nota):</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setOngkirMode('tidak'); setOngkirDraft('') }}
            className={`px-3 py-1.5 rounded-lg border text-sm ${ongkirMode === 'tidak' ? 'border-blue-500 bg-blue-50 font-semibold' : 'border-slate-300 bg-white'}`}>
            Tidak ada ongkir
          </button>
          <button type="button" onClick={() => setOngkirMode('ada')}
            className={`px-3 py-1.5 rounded-lg border text-sm ${ongkirMode === 'ada' ? 'border-blue-500 bg-blue-50 font-semibold' : 'border-slate-300 bg-white'}`}>
            Ada ongkir
          </button>
        </div>
        {ongkirMode === 'ada' && (
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Rp</span>
              <RupiahInput value={ongkirDraft} onChange={setOngkirDraft} placeholder="Nominal ongkir"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            {n > 0 && <p className="text-xs text-green-700 mt-1">Bonus PJ (50%): {fmtRp(Math.floor(n * 0.5))} — hanya kalau tugas antar diselesaikan lengkap.</p>}
          </div>
        )}
      </div>
    )
  }

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
            {canEdit ? 'Laporkan barang toko tujuan — diantar driver atau oleh Toko Pusat sendiri.' : 'Pantau laporan muat dari Toko Pusat.'}
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
          <form onSubmit={handleCreateLoading} className="space-y-3">
            <div className="flex gap-2">
              <input type="text" list="laporan-muat-stores-datalist" value={storeSearchText}
                onChange={e => setStoreSearchText(e.target.value)}
                placeholder="Ketik nama toko tujuan..."
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
              <datalist id="laporan-muat-stores-datalist">
                {availableStores.map(s => <option key={s.id} value={s.name} />)}
              </datalist>
              <button type="submit"
                disabled={creating || (!matchedStore && (!showNewStore || storeSearchText.trim().length < 3 || newStoreAddress.trim().length < 5))}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {creating ? 'Membuat...' : '+ Buat'}
              </button>
            </div>
            {!matchedStore && storeSearchText.trim().length >= 3 && !showNewStore && (
              <div className="text-xs text-slate-500 flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span>Toko &quot;{storeSearchText.trim()}&quot; belum ada di Master Toko.</span>
                <button type="button" onClick={() => setShowNewStore(true)} className="shrink-0 text-blue-600 font-semibold hover:underline">
                  + Tambah Toko Baru
                </button>
              </div>
            )}
            {!matchedStore && showNewStore && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-blue-800">Toko baru: &quot;{storeSearchText.trim()}&quot; — akan ditambahkan ke Master Toko</p>
                <input type="text" value={newStoreAddress} onChange={e => setNewStoreAddress(e.target.value)}
                  placeholder="Alamat toko (wajib)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
                <input type="tel" value={newStorePhone} onChange={e => setNewStorePhone(e.target.value)}
                  placeholder="No. telepon (opsional)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
                <button type="button" onClick={() => setShowNewStore(false)} className="text-xs text-slate-500 hover:underline">Batal tambah toko</button>
              </div>
            )}
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
          const isTp = l.status === 'selesai' && l.delivery_method === 'toko_pusat'
          const tp = tpInfo[l.id]
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
                      {!isTp && pkg.diambil > 0 ? ` · sisa ${pkg.total - pkg.diambil} dari ${pkg.total} paket` : ''}
                    </p>
                  )}
                  {isTp && (
                    <p className="text-xs text-purple-700 mt-1">
                      🏪 Diantar Toko Pusat sendiri · Ongkir {l.ongkir > 0 ? fmtRp(l.ongkir) : 'tidak ada'}
                    </p>
                  )}
                  {isTp && tp && (
                    <p className="text-xs text-blue-700 mt-1">
                      {tp.arrivedAt
                        ? `✓ Sampai di toko oleh ${tp.pjName} · ${fmtDateTime(tp.arrivedAt)} (${fmtDuration(new Date(tp.arrivedAt).getTime() - new Date(tp.pickupAt).getTime())} sejak diambil)`
                        : `🛵 Dibawa ${tp.pjName} · sudah ${fmtDuration(now - new Date(tp.pickupAt).getTime())} di jalan`}
                    </p>
                  )}
                  {!isTp && pkg.takers.length > 0 && (
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
                  {isTp ? (
                    !tp ? (
                      <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-orange-100 text-orange-700">Belum Diambil</span>
                    ) : tp.arrivedAt ? (
                      <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-blue-100 text-blue-700">Terkirim</span>
                    ) : (
                      <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-purple-100 text-purple-700">Sedang Diantar</span>
                    )
                  ) : l.status === 'selesai' && pkg.total > 0 && (
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
                            {isTp ? (
                              <span className="inline-block mt-0.5 text-[11px] px-1.5 py-0.5 rounded font-medium bg-purple-50 text-purple-700">
                                {!tp ? 'Menunggu diambil orang Toko Pusat' : tp.arrivedAt ? `✓ Sampai · ${tp.pjName}` : `🛵 Dibawa ${tp.pjName}`}
                              </span>
                            ) : pk.status === 'diambil' ? (
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
                    <div className="space-y-3">
                      {detailPackages.length > 0 && (
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
                          <p className="text-sm font-bold text-slate-700">Siapa yang mengantar?</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button type="button" onClick={() => setFinishMethod('driver')}
                              className={`text-left px-3 py-2.5 rounded-lg border text-sm transition ${finishMethod === 'driver' ? 'border-green-500 bg-green-50 ring-2 ring-green-300' : 'border-slate-300 bg-white hover:bg-slate-50'}`}>
                              <span className="font-semibold">🚚 Diantar Driver</span>
                              <span className="block text-xs text-slate-500">Muncul di Jemput Toko Pusat</span>
                            </button>
                            <button type="button" onClick={() => setFinishMethod('toko_pusat')}
                              className={`text-left px-3 py-2.5 rounded-lg border text-sm transition ${finishMethod === 'toko_pusat' ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-300' : 'border-slate-300 bg-white hover:bg-slate-50'}`}>
                              <span className="font-semibold">🏪 Diantar Toko Pusat Sendiri</span>
                              <span className="block text-xs text-slate-500">Tidak muncul ke driver — masuk menu Kirim Barang</span>
                            </button>
                          </div>
                          {finishMethod === 'toko_pusat' && renderOngkirPicker()}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={handleBatalkan} disabled={cancelling}
                          className="px-4 py-2.5 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium rounded-lg transition disabled:opacity-50">
                          {cancelling ? 'Membatalkan...' : 'Batalkan Laporan'}
                        </button>
                        <button onClick={handleTandaiSelesai}
                          disabled={detailPackages.length === 0 || finishing || !finishMethod || (finishMethod === 'toko_pusat' && ongkirFromForm() === null)}
                          className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50">
                          {finishing ? 'Menyimpan...'
                            : detailPackages.length === 0 ? 'Tambah minimal 1 foto packing dulu'
                            : !finishMethod ? 'Pilih siapa yang mengantar dulu'
                            : finishMethod === 'toko_pusat' && ongkirFromForm() === null ? 'Isi ongkir dulu'
                            : finishMethod === 'driver' ? '✓ Tandai Selesai — Dijemput Driver' : '✓ Tandai Selesai — Diantar Toko Pusat'}
                        </button>
                      </div>
                    </div>
                  )}

                  {canEdit && l.status === 'selesai' && (() => {
                    const methodLocked = l.delivery_method === 'driver' ? pkg.diambil > 0 : !!tp
                    const ongkirLocked = !!tp && !isOwner
                    return (
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-slate-600">Jalur: <b>{l.delivery_method === 'driver' ? '🚚 Diantar Driver' : '🏪 Diantar Toko Pusat'}</b></span>
                          {l.delivery_method === 'toko_pusat' && <span className="text-slate-600">· Ongkir: <b>{l.ongkir > 0 ? fmtRp(l.ongkir) : 'tidak ada'}</b></span>}
                        </div>
                        {editMode === null && (
                          <div className="flex flex-wrap gap-2">
                            {!methodLocked && (
                              <button type="button" onClick={() => { setEditMode('method'); setOngkirMode(null); setOngkirDraft('') }}
                                className="px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white rounded-lg hover:bg-slate-100">
                                ⇄ Pindah ke {l.delivery_method === 'driver' ? 'Diantar Toko Pusat' : 'Diantar Driver'}
                              </button>
                            )}
                            {l.delivery_method === 'toko_pusat' && !ongkirLocked && (
                              <button type="button" onClick={() => { setEditMode('ongkir'); setOngkirMode(l.ongkir > 0 ? 'ada' : 'tidak'); setOngkirDraft(l.ongkir > 0 ? String(l.ongkir) : '') }}
                                className="px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white rounded-lg hover:bg-slate-100">
                                ✎ Ubah Ongkir
                              </button>
                            )}
                            {methodLocked && <span className="text-xs text-slate-400">Jalur terkunci — kiriman sudah diambil.</span>}
                            {l.delivery_method === 'toko_pusat' && ongkirLocked && <span className="text-xs text-slate-400">Ongkir terkunci — hanya Owner yang bisa mengubah.</span>}
                          </div>
                        )}
                        {editMode !== null && (
                          <div className="space-y-2">
                            {(editMode === 'ongkir' || l.delivery_method === 'driver') && renderOngkirPicker()}
                            {editMode === 'method' && l.delivery_method === 'toko_pusat' && (
                              <p className="text-xs text-slate-600">Kiriman akan dipindah ke driver dan muncul di Jemput Toko Pusat.</p>
                            )}
                            <div className="flex gap-2">
                              <button type="button" onClick={resetFinishForm} className="px-3 py-1.5 text-xs border border-slate-300 bg-white rounded-lg">Batal</button>
                              <button type="button" onClick={() => handleSaveEdit(l)} disabled={savingEdit}
                                className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg disabled:opacity-50">
                                {savingEdit ? 'Menyimpan...' : 'Simpan'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
