'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import LogisticsCameraCapture from '@/components/LogisticsCameraCapture'
import { usePhotoLightbox } from '@/components/PhotoLightbox'
import RupiahInput from '@/components/RupiahInput'
import DeliveryAssigneePicker, { fetchDeliveryCandidates, type DeliveryCandidate } from '@/components/DeliveryAssigneePicker'

type Loading = {
  id: string
  store_id: string
  status: 'proses' | 'selesai' | 'dibatalkan' | 'perlu_keputusan'
  delivery_method: 'driver' | 'antar_sendiri'
  ongkir: number
  nota_amount: number | null
  nota_paid_amount: number | null
  nota_overpay_amount: number
  nota_payment_method: 'cash' | 'transfer' | 'deposit' | 'tempo' | null
  // Kirim Besok / Gagal dari driver (migrasi 088)
  postponed_at: string | null
  postpone_count: number
  last_postpone_reason: string | null
  fail_reason: string | null
  fail_photo_url: string | null
  created_by: string
  origin_branch_id: string
  assigned_to: string | null
  created_at: string
  completed_at: string | null
  cancelled_at: string | null
  logistics_stores: { name: string; address: string | null; kind: 'toko' | 'pelanggan' } | null
  origin: { name: string } | null
  creator: { full_name: string } | null
  completer: { full_name: string } | null
  canceller: { full_name: string } | null
  assignee: { full_name: string } | null
}

type AssignmentChange = {
  id: string
  reason: string | null
  changed_at: string
  old: { full_name: string } | null
  new: { full_name: string } | null
  by: { full_name: string } | null
}

type NotaChange = {
  id: string
  old_amount: number | null
  new_amount: number
  changed_at: string
  by: { full_name: string } | null
}

type Branch = { id: string; name: string }

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

type Store = { id: string; name: string; kind: 'toko' | 'pelanggan'; phone: string | null }

// Toko & Pelanggan satu sumber (Master Toko) dan boleh lewat jalur mana pun (migrasi 079).
// Nama pelanggan wajar kembar, jadi teks pilihannya ikut nomor HP (unik antar pelanggan).
const storeLabel = (s: Store) => s.kind === 'pelanggan' ? `${s.name} · Pelanggan ${s.phone ?? ''}`.trim() : s.name

type PackageSummary = { total: number; diambil: number; takers: string[]; lastTakenAt: string | null }

// Status kiriman jalur "Diantar Sendiri" (dari stop trip yang masih hidup).
type TpInfo = { pjName: string; pickupAt: string; arrivedAt: string | null; tripStatus: string; returnAt: string | null }

type NameRel = { full_name: string } | { full_name: string }[] | null
const relName = (r: NameRel) => (Array.isArray(r) ? r[0]?.full_name : r?.full_name) ?? null

// Baris daftar + ringkasan anak-anaknya dalam SATU query (tanpa URL foto) -- data makin besar,
// jadi tidak lagi .in() berisi semua id laporan ke 3 tabel terpisah.
type LoadingRow = Loading & {
  items: { count: number }[]
  packages: { status: string; taken_at: string | null; taken: NameRel }[]
  stops: {
    arrived_at: string | null
    cancelled_at: string | null
    logistics_tp_trips: { status: string; pickup_at: string; return_at: string | null; pj: NameRel } | null
  }[]
}

const LOADING_SELECT = `
  id, store_id, status, delivery_method, ongkir, nota_amount, nota_paid_amount, nota_overpay_amount, nota_payment_method, postponed_at, postpone_count, last_postpone_reason, fail_reason, fail_photo_url, created_by, origin_branch_id, assigned_to, created_at, completed_at, cancelled_at,
  logistics_stores(name, address, kind),
  origin:branches!logistics_central_loadings_origin_branch_id_fkey(name),
  creator:employees!logistics_central_loadings_created_by_fkey(full_name),
  completer:employees!logistics_central_loadings_completed_by_fkey(full_name),
  canceller:employees!logistics_central_loadings_cancelled_by_fkey(full_name),
  assignee:employees!logistics_central_loadings_assigned_to_fkey(full_name),
  items:logistics_central_loading_items(count),
  packages:logistics_central_loading_packages(status, taken_at, taken:employees!logistics_central_loading_packages_taken_by_fkey(full_name)),
  stops:logistics_tp_trip_stops(arrived_at, cancelled_at, logistics_tp_trips(status, pickup_at, return_at, pj:employees!logistics_tp_trips_pj_id_fkey(full_name)))
`

// Riwayat dimuat per halaman; yang masih Proses / Belum Diambil selalu dimuat semua.
const PAGE_SIZE = 30

function summarize(rows: LoadingRow[]) {
  const itemCounts: Record<string, number> = {}
  const packageCounts: Record<string, PackageSummary> = {}
  const tpInfo: Record<string, TpInfo> = {}
  for (const r of rows) {
    itemCounts[r.id] = r.items?.[0]?.count ?? 0
    const s: PackageSummary = { total: 0, diambil: 0, takers: [], lastTakenAt: null }
    for (const p of r.packages || []) {
      s.total++
      if (p.status !== 'diambil') continue
      s.diambil++
      const name = relName(p.taken)
      if (name && !s.takers.includes(name)) s.takers.push(name)
      if (p.taken_at && (!s.lastTakenAt || p.taken_at > s.lastTakenAt)) s.lastTakenAt = p.taken_at
    }
    packageCounts[r.id] = s
    if (r.delivery_method === 'antar_sendiri') {
      const stop = (r.stops || []).find(st => !st.cancelled_at && st.logistics_tp_trips)
      const t = stop?.logistics_tp_trips
      if (stop && t) tpInfo[r.id] = { pjName: relName(t.pj) ?? '-', pickupAt: t.pickup_at, arrivedAt: stop.arrived_at, tripStatus: t.status, returnAt: t.return_at }
    }
  }
  return { itemCounts, packageCounts, tpInfo }
}

function mergeRows(prev: LoadingRow[], incoming: LoadingRow[]) {
  const map = new Map(prev.map(r => [r.id, r]))
  for (const r of incoming) map.set(r.id, r)
  return Array.from(map.values()).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID')
const PAY_LABEL = { cash: 'Cash', transfer: 'Transfer', deposit: 'Deposit', tempo: 'Tempo' } as const

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

// Makin lama paket nongkrong di cabang, makin mencolok warnanya.
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

  const [loadings, setLoadings] = useState<LoadingRow[]>([])
  const { itemCounts, packageCounts, tpInfo } = useMemo(() => summarize(loadings), [loadings])
  // created_at baris paling tua di halaman riwayat -- titik lanjut "Muat lebih banyak".
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  // Kepala Gudang ikut "kantor": boleh memutuskan kiriman yang Gagal (migrasi 090).
  const [isKepalaGudang, setIsKepalaGudang] = useState(false)
  const [myBranchId, setMyBranchId] = useState('')
  // Cabang toko (Toko Pusat/Toko Depan/Markas/Raja) -- Owner yang bukan karyawan cabang toko
  // memilih cabang asal saat membuat laporan.
  const [storeBranches, setStoreBranches] = useState<Branch[]>([])
  const [createBranchId, setCreateBranchId] = useState('')
  const [candidates, setCandidates] = useState<DeliveryCandidate[]>([])
  const [pickupFilter, setPickupFilter] = useState<PickupFilter>('semua')

  // Form "Tandai Selesai": pilih jalur antar + pengantar + ongkir.
  const [finishMethod, setFinishMethod] = useState<'driver' | 'antar_sendiri' | null>(null)
  const [assigneeDraft, setAssigneeDraft] = useState('')
  const [ongkirMode, setOngkirMode] = useState<'tidak' | 'ada' | null>(null)
  const [ongkirDraft, setOngkirDraft] = useState('')
  // Nominal nota cabang -- wajib di Tandai Selesai (kedua jalur), lihat migrasi 082.
  const [notaDraft, setNotaDraft] = useState('')
  const [detailNotaChanges, setDetailNotaChanges] = useState<NotaChange[]>([])
  // Pindah jalur / ubah ongkir / ubah nota / ganti penerima tugas setelah selesai.
  const [editMode, setEditMode] = useState<'method' | 'ongkir' | 'nota' | 'assignee' | null>(null)
  const [reassignReason, setReassignReason] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [detailChanges, setDetailChanges] = useState<AssignmentChange[]>([])

  // Tambah toko baru ke Master Toko (kalau belum terdaftar).
  const [showNewStore, setShowNewStore] = useState(false)
  const [newStoreAddress, setNewStoreAddress] = useState('')
  const [newStorePhone, setNewStorePhone] = useState('')
  const [newStoreKind, setNewStoreKind] = useState<'toko' | 'pelanggan'>('toko')
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
    const [pageRes, prosesRes, pendingPkgRes, tpWaitRes] = await Promise.all([
      // Halaman riwayat pertama (terbaru).
      supabase.from('logistics_central_loadings').select(LOADING_SELECT)
        .order('created_at', { ascending: false }).limit(PAGE_SIZE),
      // Selalu tampil walau lama: masih proses...
      supabase.from('logistics_central_loadings').select(LOADING_SELECT).in('status', ['proses', 'perlu_keputusan']),
      // ...jalur driver yang masih ada paket belum diambil...
      supabase.from('logistics_central_loading_packages')
        .select('loading_id, logistics_central_loadings!inner(status, delivery_method)')
        .eq('status', 'pending')
        .eq('logistics_central_loadings.status', 'selesai')
        .eq('logistics_central_loadings.delivery_method', 'driver'),
      // ...dan jalur antar sendiri yang belum foto 1 (tidak punya stop trip yang masih hidup).
      supabase.from('logistics_central_loadings').select('id, logistics_tp_trip_stops(id)')
        .eq('status', 'selesai').eq('delivery_method', 'antar_sendiri')
        .is('logistics_tp_trip_stops.cancelled_at', null)
        .is('logistics_tp_trip_stops', null),
    ])
    const err = pageRes.error || prosesRes.error || pendingPkgRes.error || tpWaitRes.error
    if (err) { showMessage('error', 'Gagal memuat laporan muat: ' + err.message); return }

    const page = (pageRes.data as unknown as LoadingRow[]) || []
    let rows = mergeRows(page, (prosesRes.data as unknown as LoadingRow[]) || [])
    const have = new Set(rows.map(r => r.id))
    const waitingIds = [...new Set([
      ...((pendingPkgRes.data as { loading_id: string }[]) || []).map(r => r.loading_id),
      ...((tpWaitRes.data as { id: string }[]) || []).map(r => r.id),
    ])].filter(id => !have.has(id))
    for (let i = 0; i < waitingIds.length; i += 100) {
      const { data, error } = await supabase.from('logistics_central_loadings').select(LOADING_SELECT).in('id', waitingIds.slice(i, i + 100))
      if (error) { showMessage('error', 'Gagal memuat laporan muat: ' + error.message); return }
      rows = mergeRows(rows, (data as unknown as LoadingRow[]) || [])
    }

    setLoadings(rows)
    setCursor(page.length > 0 ? page[page.length - 1].created_at : null)
    setHasMore(page.length === PAGE_SIZE)
  }, [supabase])

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    const { data, error } = await supabase.from('logistics_central_loadings').select(LOADING_SELECT)
      .lt('created_at', cursor).order('created_at', { ascending: false }).limit(PAGE_SIZE)
    setLoadingMore(false)
    if (error) { showMessage('error', 'Gagal memuat riwayat: ' + error.message); return }
    const page = (data as unknown as LoadingRow[]) || []
    setLoadings(prev => mergeRows(prev, page))
    if (page.length > 0) setCursor(page[page.length - 1].created_at)
    setHasMore(page.length === PAGE_SIZE)
  }

  // Habis aksi pada satu laporan cukup muat ulang laporan itu saja, bukan seluruh daftar.
  async function refreshOne(id: string) {
    const { data, error } = await supabase.from('logistics_central_loadings').select(LOADING_SELECT).eq('id', id).maybeSingle()
    if (error) { showMessage('error', 'Gagal memuat ulang laporan: ' + error.message); return }
    if (!data) { setLoadings(prev => prev.filter(r => r.id !== id)); return }
    setLoadings(prev => mergeRows(prev, [data as unknown as LoadingRow]))
  }

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
          const { data: sbRows } = await supabase.from('logistics_store_branches').select('branch_id, branches!logistics_store_branches_branch_id_fkey(id, name)')
          type SbRow = { branch_id: string; branches: Branch | Branch[] | null }
          const sbs = ((sbRows as unknown as SbRow[]) || [])
            .map(r => (Array.isArray(r.branches) ? r.branches[0] : r.branches))
            .filter((b): b is Branch => !!b)
            .sort((a, b) => a.name.localeCompare(b.name))
          setStoreBranches(sbs)
          let branchId = ''
          let position: string | undefined
          if (userData.employee_id) {
            const { data: emp } = await supabase.from('employees').select('branch_id, positions(name)').eq('id', userData.employee_id).single()
            type NameRel = { name: string } | { name: string }[] | null
            const pos = emp?.positions as NameRel
            position = Array.isArray(pos) ? pos[0]?.name : pos?.name
            branchId = emp?.branch_id || ''
          }
          setMyBranchId(branchId)
          const isStoreStaff = sbs.some(b => b.id === branchId)
          setCreateBranchId(isStoreStaff ? branchId : (sbs.find(b => b.name === 'Toko Pusat')?.id ?? ''))
          if (userData.role === 'owner') { setCanEdit(true); setCanView(true); setIsOwner(true) }
          else {
            setCanEdit(isStoreStaff)
            setCanView(isStoreStaff || position === 'Kepala Gudang')
            setIsKepalaGudang(position === 'Kepala Gudang')
          }
          if (userData.role === 'owner' || isStoreStaff) setCandidates(await fetchDeliveryCandidates(supabase))
        }
      }
      const { data: storeData } = await supabase.from('logistics_stores').select('id, name, kind, phone').eq('is_active', true).order('name')
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

    const { data: changes } = await supabase.from('logistics_assignment_changes')
      .select(`
        id, reason, changed_at,
        old:employees!logistics_assignment_changes_old_emp_fkey(full_name),
        new:employees!logistics_assignment_changes_new_emp_fkey(full_name),
        by:employees!logistics_assignment_changes_changed_by_fkey(full_name)
      `)
      .eq('loading_id', loadingId).order('changed_at')
    setDetailChanges((changes as unknown as AssignmentChange[]) || [])

    const { data: notaChanges } = await supabase.from('logistics_nota_changes')
      .select('id, old_amount, new_amount, changed_at, by:employees!logistics_nota_changes_changed_by_fkey(full_name)')
      .eq('loading_id', loadingId).order('changed_at')
    setDetailNotaChanges((notaChanges as unknown as NotaChange[]) || [])
  }

  function toggleSelect(id: string) {
    if (selectedLoadingId === id) { setSelectedLoadingId(null); return }
    setSelectedLoadingId(id)
    setDetailChanges([])
    setDetailNotaChanges([])
    setItemCaptionDraft('')
    setPackageCaptionDraft('')
    resetFinishForm()
    fetchDetail(id)
  }

  function resetFinishForm() {
    setFinishMethod(null)
    setAssigneeDraft('')
    setOngkirMode(null)
    setOngkirDraft('')
    setNotaDraft('')
    setEditMode(null)
    setReassignReason('')
  }

  // Nominal nota dari form: null = belum diisi / tidak valid.
  function notaFromForm(): number | null {
    const n = parseInt(notaDraft || '0', 10)
    return n > 0 ? n : null
  }

  // Kelola isi laporan (foto, selesai, jalur, ongkir) -- staf cabang asal atau Owner.
  const canManage = (l: Loading) => isOwner || (canEdit && !!myBranchId && l.origin_branch_id === myBranchId)
  // Ganti penerima tugas sebelum foto 1 -- pembuat, rekan satu cabangnya, atau Owner (dicek ulang di server).
  const canReassign = (l: Loading) => canManage(l) || l.created_by === myEmployeeId
  const branchName = (id: string) => storeBranches.find(b => b.id === id)?.name ?? 'cabang'
  // Owner/Kepala Gudang melihat kiriman beberapa cabang -- tampilkan asal tiap kartu.
  const showOrigin = isOwner || new Set(loadings.map(l => l.origin_branch_id)).size > 1

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
  const matchedStore = availableStores.find(s => storeLabel(s).trim().toLowerCase() === storeSearchText.trim().toLowerCase())

  async function handleCreateLoading(e: React.FormEvent) {
    e.preventDefault()
    let storeId = matchedStore?.id
    if (!storeId) {
      if (!showNewStore) { showMessage('error', 'Toko tidak ditemukan. Pilih dari saran yang muncul, atau tambahkan sebagai toko baru.'); return }
      setCreating(true)
      const { data: newId, error: storeErr } = await supabase.rpc('quick_create_logistics_store', {
        p_name: storeSearchText, p_address: newStoreAddress, p_phone: newStorePhone, p_kind: newStoreKind,
      })
      if (storeErr || !newId) { setCreating(false); showMessage('error', `Gagal menambah ${newStoreKind === 'pelanggan' ? 'pelanggan' : 'toko'}: ` + storeErr?.message); return }
      storeId = newId as string
    }
    if (!createBranchId) { showMessage('error', 'Pilih cabang asal kiriman dulu.'); return }
    setCreating(true)
    const { data, error } = await supabase.from('logistics_central_loadings').insert({
      store_id: storeId, created_by: myEmployeeId, origin_branch_id: createBranchId,
    }).select('id').single()
    setCreating(false)
    if (error || !data) { showMessage('error', 'Gagal membuat laporan muat: ' + error?.message); return }
    if (showNewStore) {
      const { data: storeData } = await supabase.from('logistics_stores').select('id, name, kind, phone').eq('is_active', true).order('name')
      setAllStores(storeData || [])
    }
    setStoreSearchText('')
    setShowNewStore(false)
    setNewStoreAddress('')
    setNewStorePhone('')
    setNewStoreKind('toko')
    setShowCreateForm(false)
    resetFinishForm()
    await refreshOne(data.id)
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
    await refreshOne(selectedLoadingId)
  }

  async function handleDeleteItem(itemId: string) {
    if (!selectedLoadingId || !confirm('Hapus foto ini?')) return
    const { error } = await supabase.from('logistics_central_loading_items').delete().eq('id', itemId)
    if (error) { showMessage('error', 'Gagal menghapus: ' + error.message); return }
    await fetchDetail(selectedLoadingId)
    await refreshOne(selectedLoadingId)
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
    await refreshOne(selectedLoadingId)
  }

  async function handleDeletePackage(packageId: string) {
    if (!selectedLoadingId || !confirm('Hapus paket ini?')) return
    const { error } = await supabase.from('logistics_central_loading_packages').delete().eq('id', packageId)
    if (error) { showMessage('error', 'Gagal menghapus: ' + error.message); return }
    await fetchDetail(selectedLoadingId)
    await refreshOne(selectedLoadingId)
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
    await refreshOne(selectedLoadingId)
    await fetchDetail(selectedLoadingId)
  }

  async function handleTandaiSelesai() {
    if (!selectedLoadingId || detailPackages.length === 0 || !finishMethod) return
    const nota = notaFromForm()
    if (nota === null) { showMessage('error', 'Isi nominal nota dulu (wajib).'); return }
    const self = finishMethod === 'antar_sendiri'
    const ongkir = self ? ongkirFromForm() : 0
    if (ongkir === null) { showMessage('error', 'Pilih "Tidak ada ongkir" atau isi nominal ongkirnya.'); return }
    if (self && !assigneeDraft) { showMessage('error', 'Pilih siapa yang mengantar.'); return }
    const assignee = candidates.find(c => c.id === assigneeDraft)
    const jalur = !self
      ? 'DIANTAR DRIVER GUDANG (muncul di Jemput Barang Cabang)'
      : `DIANTAR SENDIRI oleh ${assignee?.full_name} (${assignee?.branch_name}) — ongkir ${ongkir > 0 ? fmtRp(ongkir) : 'tidak ada'}`
    if (!confirm(`Tandai laporan muat ini selesai — ${jalur}?\nNota: ${fmtRp(nota)}\nFoto tidak bisa ditambah/dihapus lagi setelah ini.`)) return
    setFinishing(true)
    const { error } = await supabase.rpc('finish_central_loading', {
      p_loading_id: selectedLoadingId, p_method: finishMethod, p_ongkir: ongkir, p_assigned_to: self ? assigneeDraft : null,
      p_nota_amount: nota,
    })
    setFinishing(false)
    if (error) { showMessage('error', 'Gagal menandai selesai: ' + error.message); return }
    showMessage('success', !self
      ? 'Laporan muat ditandai selesai. Toko tujuan sudah bisa dijemput driver.'
      : `Laporan muat ditandai selesai. Tugas antar muncul di menu Kirim Barang milik ${assignee?.full_name}.`)
    resetFinishForm()
    window.dispatchEvent(new Event('kirim-barang-badge-refresh'))
    await refreshOne(selectedLoadingId)
    await fetchDetail(selectedLoadingId)
  }

  async function handleSaveEdit(l: Loading) {
    if (!editMode) return
    setSavingEdit(true)
    let error
    if (editMode === 'method') {
      const target = l.delivery_method === 'driver' ? 'antar_sendiri' : 'driver'
      const ongkir = target === 'antar_sendiri' ? ongkirFromForm() : 0
      if (ongkir === null) { setSavingEdit(false); showMessage('error', 'Pilih "Tidak ada ongkir" atau isi nominal ongkirnya.'); return }
      if (target === 'antar_sendiri' && !assigneeDraft) { setSavingEdit(false); showMessage('error', 'Pilih siapa yang mengantar.'); return }
      ;({ error } = await supabase.rpc('set_central_loading_method', {
        p_loading_id: l.id, p_method: target, p_ongkir: ongkir, p_assigned_to: target === 'antar_sendiri' ? assigneeDraft : null,
      }))
    } else if (editMode === 'assignee') {
      if (!assigneeDraft) { setSavingEdit(false); showMessage('error', 'Pilih penerima tugas yang baru.'); return }
      if (reassignReason.trim().length < 3) { setSavingEdit(false); showMessage('error', 'Alasan wajib diisi (minimal 3 huruf).'); return }
      ;({ error } = await supabase.rpc('reassign_loading_before_pickup', {
        p_loading_id: l.id, p_new_emp: assigneeDraft, p_reason: reassignReason.trim(),
      }))
    } else if (editMode === 'nota') {
      const nota = notaFromForm()
      if (nota === null) { setSavingEdit(false); showMessage('error', 'Nominal nota wajib lebih dari 0.'); return }
      ;({ error } = await supabase.rpc('set_central_loading_nota', { p_loading_id: l.id, p_nota_amount: nota }))
    } else {
      const ongkir = ongkirFromForm()
      if (ongkir === null) { setSavingEdit(false); showMessage('error', 'Pilih "Tidak ada ongkir" atau isi nominal ongkirnya.'); return }
      ;({ error } = await supabase.rpc('set_central_loading_ongkir', { p_loading_id: l.id, p_ongkir: ongkir }))
    }
    setSavingEdit(false)
    if (error) { showMessage('error', 'Gagal menyimpan: ' + error.message); return }
    showMessage('success', editMode === 'method' ? 'Jalur pengantaran berhasil dipindah.'
      : editMode === 'assignee' ? 'Penerima tugas berhasil diganti.'
      : editMode === 'nota' ? 'Nominal nota berhasil diubah.' : 'Ongkir berhasil diubah.')
    resetFinishForm()
    window.dispatchEvent(new Event('kirim-barang-badge-refresh'))
    await refreshOne(l.id)
    await fetchDetail(l.id)
  }

  // Kiriman yang Gagal (toko menolak / batal pesan): kirim lagi atau batalkan -- cabang asal / kantor.
  async function decideFailed(l: Loading, decision: 'jadwal_ulang' | 'batal') {
    const text = window.prompt(decision === 'batal' ? 'Batalkan kiriman ini? Alasan:' : 'Kirim ulang kiriman ini? Catatan (opsional):')
    if (text === null) return
    if (decision === 'batal' && text.trim().length < 3) { showMessage('error', 'Alasan wajib diisi (minimal 3 huruf).'); return }
    const { error } = await supabase.rpc('decide_failed_loading', { p_id: l.id, p_decision: decision, p_note: text.trim() })
    if (error) { showMessage('error', error.message); return }
    showMessage('success', decision === 'batal' ? 'Kiriman dibatalkan.' : 'Kiriman dijadwalkan ulang — paket kembali menunggu dijemput.')
    window.dispatchEvent(new Event('kirim-barang-badge-refresh'))
    await refreshOne(l.id)
  }

  function pickupGroup(l: Loading): 'belum' | 'sudah' | 'proses' | 'batal' {
    if (l.status === 'dibatalkan') return 'batal'
    if (l.status === 'perlu_keputusan') return 'belum'
    if (l.status === 'proses') return 'proses'
    if (l.delivery_method === 'antar_sendiri') return tpInfo[l.id] ? 'sudah' : 'belum'
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
          Cuma staf cabang toko (Toko Pusat, Toko Depan, Markas, Raja), Kepala Gudang, atau Owner yang bisa membuka halaman ini.
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
            {canEdit
              ? `Laporkan barang toko tujuan${!isOwner && myBranchId ? ` dari ${branchName(myBranchId)}` : ''} — diantar Driver Gudang atau diantar sendiri.`
              : 'Pantau laporan muat dari cabang toko.'}
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
            {isOwner && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-600 shrink-0">Cabang asal:</label>
                <select value={createBranchId} onChange={e => setCreateBranchId(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                  {storeBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-2">
              <input type="text" list="laporan-muat-stores-datalist" value={storeSearchText}
                onChange={e => setStoreSearchText(e.target.value)}
                placeholder="Ketik nama toko / pelanggan tujuan..."
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
              <datalist id="laporan-muat-stores-datalist">
                {availableStores.map(s => <option key={s.id} value={storeLabel(s)} />)}
              </datalist>
              <button type="submit"
                disabled={creating || (!matchedStore && (!showNewStore || storeSearchText.trim().length < 3 || newStoreAddress.trim().length < 5
                  || (newStoreKind === 'pelanggan' && newStorePhone.trim().length < 9)))}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {creating ? 'Membuat...' : '+ Buat'}
              </button>
            </div>
            {!matchedStore && storeSearchText.trim().length >= 3 && !showNewStore && (
              <div className="text-xs text-slate-500 flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span>&quot;{storeSearchText.trim()}&quot; belum ada di Master Toko.</span>
                <button type="button" onClick={() => setShowNewStore(true)} className="shrink-0 text-blue-600 font-semibold hover:underline">
                  + Tambah Baru
                </button>
              </div>
            )}
            {!matchedStore && showNewStore && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-blue-800">Baru: &quot;{storeSearchText.trim()}&quot; — akan ditambahkan ke Master Toko</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['toko', 'pelanggan'] as const).map(k => (
                    <button key={k} type="button" onClick={() => setNewStoreKind(k)}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium transition ${newStoreKind === k ? 'border-blue-500 bg-white ring-2 ring-blue-300 text-blue-800' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                      {k === 'toko' ? '🏪 Toko' : '👤 Pelanggan (konsumen)'}
                    </button>
                  ))}
                </div>
                <input type="text" value={newStoreAddress} onChange={e => setNewStoreAddress(e.target.value)}
                  placeholder="Alamat (wajib)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
                <input type="tel" value={newStorePhone} onChange={e => setNewStorePhone(e.target.value)}
                  placeholder={newStoreKind === 'pelanggan' ? 'No. HP pelanggan (wajib)' : 'No. telepon (opsional)'}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
                <button type="button" onClick={() => setShowNewStore(false)} className="text-xs text-slate-500 hover:underline">Batal tambah baru</button>
              </div>
            )}
          </form>
        </div>
      )}

      {(() => {
        // Proses & Belum Diambil selalu lengkap; Sudah Diambil & Semua cuma sejauh riwayat yang dimuat.
        const cards: { key: PickupFilter; label: string; count: number; partial?: boolean; tone: string; active: string }[] = [
          { key: 'belum', label: 'Belum Diambil', count: loadings.filter(l => pickupGroup(l) === 'belum').length,
            tone: 'border-orange-200 text-orange-700', active: 'bg-orange-50 ring-2 ring-orange-400' },
          { key: 'sudah', label: 'Sudah Diambil', count: loadings.filter(l => pickupGroup(l) === 'sudah').length, partial: hasMore,
            tone: 'border-blue-200 text-blue-700', active: 'bg-blue-50 ring-2 ring-blue-400' },
          { key: 'proses', label: 'Masih Proses', count: loadings.filter(l => pickupGroup(l) === 'proses').length,
            tone: 'border-amber-200 text-amber-700', active: 'bg-amber-50 ring-2 ring-amber-400' },
          { key: 'semua', label: 'Semua', count: loadings.length, partial: hasMore,
            tone: 'border-slate-200 text-slate-700', active: 'bg-slate-50 ring-2 ring-slate-400' },
        ]
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {cards.map(c => (
              <button key={c.key} onClick={() => setPickupFilter(c.key)}
                className={`text-left bg-white border rounded-xl px-4 py-3 transition hover:shadow-sm ${c.tone} ${pickupFilter === c.key ? c.active : ''}`}>
                <p className="text-2xl font-bold">{c.count}{c.partial ? '+' : ''}</p>
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
          const isTp = l.status === 'selesai' && l.delivery_method === 'antar_sendiri'
          const tp = tpInfo[l.id]
          const manage = canManage(l)
          return (
            <div key={l.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <button onClick={() => toggleSelect(l.id)} className="w-full text-left px-5 py-4 hover:bg-slate-50 transition flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">
                    {l.logistics_stores?.name}
                    {l.logistics_stores?.kind === 'pelanggan' && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 align-middle">Pelanggan</span>}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {showOrigin && <span className="font-semibold text-slate-500">📍 {l.origin?.name ?? '-'} · </span>}
                    Dibuat oleh {l.creator?.full_name ?? '-'} · {fmtDateTime(l.created_at)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {itemCounts[l.id] || 0} foto barang · {pkg.total} paket{pkg.total > 0 ? ` (${pkg.diambil} diambil)` : ''}
                  </p>
                  {l.nota_amount != null ? (
                    <p className="text-xs font-semibold text-emerald-700 mt-0.5">
                      🧾 Nota {fmtRp(l.nota_amount)}
                      {l.nota_payment_method && (() => {
                        const paid = Number(l.nota_paid_amount ?? 0)
                        const short = l.nota_amount - paid
                        return (
                          <span className="font-normal text-slate-600">
                            {' '}· 💰 {PAY_LABEL[l.nota_payment_method]}{l.nota_payment_method !== 'tempo' ? ` ${fmtRp(paid)}` : ''}
                            {short > 0 && <span className="text-amber-700"> · {l.nota_payment_method === 'tempo' ? 'piutang' : 'kurang'} {fmtRp(short)}</span>}
                            {l.nota_overpay_amount > 0 && <span className="text-blue-700"> · lebih {fmtRp(l.nota_overpay_amount)}</span>}
                          </span>
                        )
                      })()}
                    </p>
                  ) : l.status === 'selesai' && (
                    <p className="text-xs text-slate-400 mt-0.5">🧾 Nota belum diisi</p>
                  )}
                  {l.postponed_at && l.status === 'selesai' && (
                    <p className="text-xs text-amber-700 mt-0.5">
                      📅 Ditunda driver {l.postpone_count}× sejak {fmtDateTime(l.postponed_at)} — {l.last_postpone_reason ?? '-'} (paket kembali, menunggu dijemput lagi)
                    </p>
                  )}
                  {l.status === 'dibatalkan' && l.fail_reason && (
                    <p className="text-xs text-red-600 mt-0.5">❌ Gagal kirim: {l.fail_reason}</p>
                  )}
                  {l.status === 'perlu_keputusan' && (
                    <p className="text-xs text-red-700 font-semibold mt-0.5">❌ Gagal kirim: {l.fail_reason ?? '-'} — menunggu keputusan (buka untuk jadwalkan ulang / batalkan)</p>
                  )}
                  {group === 'belum' && l.completed_at && l.status === 'selesai' && (
                    <p className={`inline-block mt-1.5 text-xs font-semibold px-2 py-1 rounded-md border ${waitingTone(waitingMs)}`}>
                      ⏱ Sudah {fmtDuration(waitingMs)} belum diambil
                      {!isTp && pkg.diambil > 0 ? ` · sisa ${pkg.total - pkg.diambil} dari ${pkg.total} paket` : ''}
                    </p>
                  )}
                  {isTp && (
                    <p className="text-xs text-purple-700 mt-1">
                      🛵 Diantar sendiri oleh <b>{l.assignee?.full_name ?? '-'}</b> · Ongkir {l.ongkir > 0 ? fmtRp(l.ongkir) : 'tidak ada'}
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
                    l.status === 'selesai' ? 'bg-green-100 text-green-700' : l.status === 'dibatalkan' || l.status === 'perlu_keputusan' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {l.status === 'selesai' ? 'Selesai' : l.status === 'dibatalkan' ? 'Dibatalkan' : l.status === 'perlu_keputusan' ? 'Perlu Keputusan' : 'Proses'}
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
                  {l.status === 'perlu_keputusan' && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                      <p className="text-sm font-semibold text-red-700">❌ Gagal kirim: {l.fail_reason ?? '-'}</p>
                      {l.fail_photo_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.fail_photo_url} alt="Foto toko" onClick={() => openLightbox(l.fail_photo_url!, 'Foto toko')}
                          className="w-40 rounded-lg border border-red-200 cursor-zoom-in" />
                      )}
                      {(manage || isOwner || isKepalaGudang) ? (
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => decideFailed(l, 'jadwal_ulang')} className="px-3 py-1.5 text-xs font-semibold border border-blue-300 text-blue-700 bg-white rounded-lg">
                            🔁 Jadwalkan ulang (kirim lagi)
                          </button>
                          <button onClick={() => decideFailed(l, 'batal')} className="px-3 py-1.5 text-xs font-semibold border border-red-300 text-red-700 bg-white rounded-lg">
                            🗑️ Batalkan kiriman
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">Menunggu keputusan cabang asal / kantor.</p>
                      )}
                    </div>
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
                            {manage && l.status === 'proses' && (
                              <button onClick={() => handleDeleteItem(it.id)}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-red-600 text-white rounded-full text-xs shadow">✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {manage && l.status === 'proses' && (
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
                                {!tp ? `Menunggu diambil ${l.assignee?.full_name ?? 'pengantar'}` : tp.arrivedAt ? `✓ Sampai · ${tp.pjName}` : `🛵 Dibawa ${tp.pjName}`}
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
                            {manage && l.status === 'proses' && (
                              <button onClick={() => handleDeletePackage(pk.id)}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-red-600 text-white rounded-full text-xs shadow">✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {manage && l.status === 'proses' && (
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

                  {manage && l.status === 'proses' && (
                    <div className="space-y-3">
                      {detailPackages.length > 0 && (
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
                          <div className="space-y-1">
                            <p className="text-sm font-bold text-slate-700">Nominal nota (wajib)</p>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-slate-500">Rp</span>
                              <RupiahInput value={notaDraft} onChange={setNotaDraft} placeholder="Total nota untuk toko tujuan"
                                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                            <p className="text-xs text-slate-500">Sesuai nota yang dibawa ke toko tujuan. Pengantar/driver tidak perlu mengetik ulang.</p>
                          </div>
                          <p className="text-sm font-bold text-slate-700">Siapa yang mengantar?</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button type="button" onClick={() => setFinishMethod('driver')}
                              className={`text-left px-3 py-2.5 rounded-lg border text-sm transition ${finishMethod === 'driver' ? 'border-green-500 bg-green-50 ring-2 ring-green-300' : 'border-slate-300 bg-white hover:bg-slate-50'}`}>
                              <span className="font-semibold">🚚 Diantar Driver Gudang</span>
                              <span className="block text-xs text-slate-500">Muncul di Jemput Barang Cabang (driver)</span>
                            </button>
                            <button type="button" onClick={() => setFinishMethod('antar_sendiri')}
                              className={`text-left px-3 py-2.5 rounded-lg border text-sm transition ${finishMethod === 'antar_sendiri' ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-300' : 'border-slate-300 bg-white hover:bg-slate-50'}`}>
                              <span className="font-semibold">🛵 Diantar Sendiri</span>
                              <span className="block text-xs text-slate-500">Pilih pengantar (boleh dari cabang lain) — tugas masuk menu Kirim Barang miliknya</span>
                            </button>
                          </div>
                          {finishMethod === 'antar_sendiri' && (
                            <>
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-slate-600">Pengantar (wajib):</p>
                                <DeliveryAssigneePicker candidates={candidates} value={assigneeDraft} onChange={setAssigneeDraft} />
                              </div>
                              {renderOngkirPicker()}
                            </>
                          )}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={handleBatalkan} disabled={cancelling}
                          className="px-4 py-2.5 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium rounded-lg transition disabled:opacity-50">
                          {cancelling ? 'Membatalkan...' : 'Batalkan Laporan'}
                        </button>
                        <button onClick={handleTandaiSelesai}
                          disabled={detailPackages.length === 0 || finishing || notaFromForm() === null || !finishMethod
                            || (finishMethod === 'antar_sendiri' && (!assigneeDraft || ongkirFromForm() === null))}
                          className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50">
                          {finishing ? 'Menyimpan...'
                            : detailPackages.length === 0 ? 'Tambah minimal 1 foto packing dulu'
                            : notaFromForm() === null ? 'Isi nominal nota dulu'
                            : !finishMethod ? 'Pilih siapa yang mengantar dulu'
                            : finishMethod === 'antar_sendiri' && !assigneeDraft ? 'Pilih pengantar dulu'
                            : finishMethod === 'antar_sendiri' && ongkirFromForm() === null ? 'Isi ongkir dulu'
                            : finishMethod === 'driver' ? '✓ Tandai Selesai — Dijemput Driver Gudang' : '✓ Tandai Selesai — Diantar Sendiri'}
                        </button>
                      </div>
                    </div>
                  )}

                  {l.status === 'selesai' && (manage || (l.delivery_method === 'antar_sendiri' && canReassign(l))) && (() => {
                    const self = l.delivery_method === 'antar_sendiri'
                    const methodLocked = !self ? pkg.diambil > 0 : !!tp
                    const ongkirLocked = !!tp && !isOwner
                    // Sama dengan server (is_central_loading_taken): terkunci begitu barang diambil, kecuali Owner.
                    const notaLocked = (pkg.diambil > 0 || !!tp) && !isOwner
                    return (
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-slate-600">Jalur: <b>{!self ? '🚚 Diantar Driver Gudang' : '🛵 Diantar Sendiri'}</b></span>
                          {self && <span className="text-slate-600">· Pengantar: <b>{l.assignee?.full_name ?? '-'}</b></span>}
                          {self && <span className="text-slate-600">· Ongkir: <b>{l.ongkir > 0 ? fmtRp(l.ongkir) : 'tidak ada'}</b></span>}
                          <span className="text-slate-600">· Nota: <b>{l.nota_amount != null ? fmtRp(l.nota_amount) : 'belum diisi'}</b></span>
                        </div>
                        {editMode === null && (
                          <div className="flex flex-wrap gap-2">
                            {self && !tp && canReassign(l) && (
                              <button type="button" onClick={() => { setEditMode('assignee'); setAssigneeDraft(''); setReassignReason('') }}
                                className="px-3 py-1.5 text-xs font-medium border border-purple-300 text-purple-700 bg-white rounded-lg hover:bg-purple-50">
                                👤 Ganti Penerima Tugas
                              </button>
                            )}
                            {manage && !methodLocked && (
                              <button type="button" onClick={() => { setEditMode('method'); setOngkirMode(null); setOngkirDraft(''); setAssigneeDraft('') }}
                                className="px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white rounded-lg hover:bg-slate-100">
                                ⇄ Pindah ke {!self ? 'Diantar Sendiri' : 'Diantar Driver Gudang'}
                              </button>
                            )}
                            {manage && self && !ongkirLocked && (
                              <button type="button" onClick={() => { setEditMode('ongkir'); setOngkirMode(l.ongkir > 0 ? 'ada' : 'tidak'); setOngkirDraft(l.ongkir > 0 ? String(l.ongkir) : '') }}
                                className="px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white rounded-lg hover:bg-slate-100">
                                ✎ Ubah Ongkir
                              </button>
                            )}
                            {manage && !notaLocked && (
                              <button type="button" onClick={() => { setEditMode('nota'); setNotaDraft(l.nota_amount != null ? String(l.nota_amount) : '') }}
                                className="px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white rounded-lg hover:bg-slate-100">
                                🧾 {l.nota_amount != null ? 'Ubah Nota' : 'Isi Nota'}
                              </button>
                            )}
                            {manage && notaLocked && <span className="text-xs text-slate-400">Nota terkunci — barang sudah diambil, hanya Owner yang bisa mengubah.</span>}
                            {manage && methodLocked && <span className="text-xs text-slate-400">Jalur terkunci — kiriman sudah diambil.</span>}
                            {self && tp && <span className="text-xs text-slate-400">Penerima tugas terkunci setelah foto 1 — hanya Owner yang bisa mengalihkan (menu Kirim Barang).</span>}
                            {manage && self && ongkirLocked && <span className="text-xs text-slate-400">Ongkir terkunci — hanya Owner yang bisa mengubah.</span>}
                          </div>
                        )}
                        {editMode !== null && (
                          <div className="space-y-2">
                            {editMode === 'assignee' && (
                              <>
                                <p className="text-xs font-semibold text-slate-600">Penerima tugas baru:</p>
                                <DeliveryAssigneePicker candidates={candidates} value={assigneeDraft} onChange={setAssigneeDraft} excludeId={l.assigned_to} />
                                <input type="text" value={reassignReason} onChange={e => setReassignReason(e.target.value)}
                                  placeholder="Alasan ganti (wajib, mis. sakit / tidak masuk)"
                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
                              </>
                            )}
                            {editMode === 'method' && !self && (
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-slate-600">Pengantar (wajib):</p>
                                <DeliveryAssigneePicker candidates={candidates} value={assigneeDraft} onChange={setAssigneeDraft} />
                              </div>
                            )}
                            {(editMode === 'ongkir' || (editMode === 'method' && !self)) && renderOngkirPicker()}
                            {editMode === 'nota' && (
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-slate-600">Nominal nota baru:</p>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-slate-500">Rp</span>
                                  <RupiahInput value={notaDraft} onChange={setNotaDraft} placeholder="Nominal nota"
                                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                              </div>
                            )}
                            {editMode === 'method' && self && (
                              <p className="text-xs text-slate-600">Kiriman akan dipindah ke Driver Gudang dan muncul di Jemput Barang Cabang.</p>
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

                  {detailNotaChanges.length > 0 && (
                    <div>
                      <p className="text-sm font-bold text-slate-700 mb-2">🧾 Riwayat Nota</p>
                      <ul className="space-y-1">
                        {detailNotaChanges.map(c => (
                          <li key={c.id} className="text-xs text-slate-600">
                            {fmtDateTime(c.changed_at)} · {c.old_amount != null ? <>{fmtRp(c.old_amount)} → </> : 'Diisi '}<b>{fmtRp(c.new_amount)}</b>
                            {' '}oleh {c.by?.full_name ?? '-'}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {detailChanges.length > 0 && (
                    <div>
                      <p className="text-sm font-bold text-slate-700 mb-2">👤 Riwayat Penerima Tugas</p>
                      <ul className="space-y-1">
                        {detailChanges.map(c => (
                          <li key={c.id} className="text-xs text-slate-600">
                            {fmtDateTime(c.changed_at)} · {c.old ? <>{c.old.full_name} → </> : 'Ditugaskan ke '}<b>{c.new?.full_name ?? '(jalur driver)'}</b>
                            {' '}oleh {c.by?.full_name ?? '-'}{c.reason ? <> — <i>&quot;{c.reason}&quot;</i></> : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {hasMore && (pickupFilter === 'semua' || pickupFilter === 'sudah') && (
        <button onClick={loadMore} disabled={loadingMore}
          className="w-full mt-4 py-2.5 border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium text-slate-600 rounded-lg transition disabled:opacity-50">
          {loadingMore ? 'Memuat...' : 'Muat lebih banyak riwayat'}
        </button>
      )}
    </div>
  )
}
