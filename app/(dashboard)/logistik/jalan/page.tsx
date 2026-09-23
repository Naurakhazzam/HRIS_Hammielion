'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import RupiahInput from '@/components/RupiahInput'
import LogisticsCameraCapture from '@/components/LogisticsCameraCapture'
import { usePhotoLightbox } from '@/components/PhotoLightbox'
import { toWaLink } from '@/lib/whatsapp'

type PlanSummary = {
  id: string
  plan_date: string
  status: string
  vehicle_id: string
  route_id: string
  driver_id: string
  helper_id: string | null
  box_confirmed_at: string | null
  vehicles: { name: string; plate_number: string | null } | null
  delivery_routes: { name: string } | null
}

// SEMENTARA 0 untuk keperluan testing Owner — WAJIB dikembalikan ke 30 sebelum dipakai
// driver/kenek sungguhan lagi (jeda ini mencegah kecurangan lapor sampai garasi terlalu cepat).
// Nilainya sekarang dibaca dari tabel logistics_settings (bisa dinyalakan/dimatikan Owner dari
// Dashboard Pengiriman untuk keperluan testing) -- lihat fetchGarageGapMinutes(), RPC
// complete_logistics_delivery membaca setting yang sama di database jadi keduanya selalu sinkron.
const GARAGE_GAP_MINUTES_DEFAULT = 30

const fmtRp = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

type PlanStore = {
  id: string
  store_id: string
  sequence_order: number
  status: string
  delivery_photo_urls: string[] | null
  payment_method: PaymentMethod | null
  payment_amount: number | null
  payment_photo_url: string | null
  payment_due_date: string | null
  incident_type: 'tidak_ada' | 'salah_muat' | 'retur'
  incident_photo_url: string | null
  incident_description: string | null
  failed_reason: string | null
  logistics_stores: { name: string; address: string | null; phone: string | null } | null
}

type ActionMode = null | 'kirim' | 'gagal'
type PaymentMethod = '' | 'cash' | 'transfer' | 'deposit' | 'tempo'

const PAYMENT_LABEL: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', deposit: 'Deposit', tempo: 'Tempo' }

const STATUS_LABEL: Record<string, string> = {
  ready: 'Siap Berangkat', departed: 'Sedang Jalan', closing: 'Menuju Garasi',
}

export default function JalanPengirimanPage() {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()
  const [loading, setLoading] = useState(true)
  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [myName, setMyName] = useState('')
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [planStores, setPlanStores] = useState<PlanStore[]>([])
  // Toko TIDAK wajib dikerjakan berurutan — driver bebas pilih toko mana saja dari daftar
  // yang tersisa (sequence_order cuma dipakai sebagai nomor referensi urutan rencana awal,
  // bukan aturan yang mengunci). null = belum pilih, tampilkan daftar toko yang bisa dipilih.
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [actionMode, setActionMode] = useState<ActionMode>(null)
  // Alur "Kirim" sekarang bertahap (wizard), bukan 1 layar isi semua sekaligus -- driver harus
  // selesaikan & konfirmasi 1 langkah sebelum lanjut ke langkah berikutnya:
  // 1=Foto Bukti Kirim, 2=Metode Pembayaran + konfirmasi ke toko, 3=Kejadian + kirim akhir.
  const [kirimStep, setKirimStep] = useState<1 | 2 | 3>(1)
  // Muncul saat tombol "Lanjut ke Langkah 2" ditekan -- konfirmasi eksplisit dulu (bukan
  // langsung pindah langkah) supaya driver benar-benar yakin semua barang toko ini sudah
  // turun sebelum foto buktinya dianggap final.
  const [showUnloadConfirm, setShowUnloadConfirm] = useState(false)

  // Form Kirim
  // Bukti Kirim boleh lebih dari 1 foto (barang yang dikirim ke 1 toko bisa banyak, 1 foto
  // sering tidak cukup) -- addingDeliveryPhoto mengontrol kapan kamera ditampilkan lagi untuk
  // foto tambahan (vs. galeri foto yang sudah diambil + tombol "+ Tambah Foto Lagi").
  const [deliveryPhotoUrls, setDeliveryPhotoUrls] = useState<string[]>([])
  const [addingDeliveryPhoto, setAddingDeliveryPhoto] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentPhotoUrl, setPaymentPhotoUrl] = useState('')
  const [paymentDueDate, setPaymentDueDate] = useState('')
  const [incidentType, setIncidentType] = useState<'tidak_ada' | 'salah_muat' | 'retur'>('tidak_ada')
  const [incidentPhotoUrl, setIncidentPhotoUrl] = useState('')
  const [incidentDescription, setIncidentDescription] = useState('')

  // Form Gagal Kirim
  const [failedReason, setFailedReason] = useState('')

  // Edit nominal/metode bayar toko yang SUDAH terkirim — untuk perbaiki salah ketik tanpa
  // perlu ulang seluruh alur foto. Cuma boleh selama trip belum "Selesai Kirim" (completed).
  const [editHistoryStore, setEditHistoryStore] = useState<PlanStore | null>(null)
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>('')
  const [editPaymentAmount, setEditPaymentAmount] = useState('')
  const [editPaymentDueDate, setEditPaymentDueDate] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Selesai Tugas lebih awal — kalau masih ada toko pending pas driver mau akhiri trip (mis.
  // kehabisan waktu), sisa toko yang belum diproses WAJIB dikonfirmasi dulu baru ditandai Gagal
  // Kirim sekaligus (bukan diam-diam hilang) -- supaya tetap ada jejaknya (kemungkinan salah
  // pencet/lupa tetap harus lewat konfirmasi eksplisit dulu).
  const [showFinishConfirm, setShowFinishConfirm] = useState(false)
  const [finishReason, setFinishReason] = useState('')
  const [finishSaving, setFinishSaving] = useState(false)

  // Penutupan trip (box kosong -> jeda 30 menit -> lapor garasi)
  const [boxPhotoUrl, setBoxPhotoUrl] = useState('')
  const [garagePhotoUrl, setGaragePhotoUrl] = useState('')
  const [needsRefuel, setNeedsRefuel] = useState<boolean | null>(null)
  const [nowTick, setNowTick] = useState(Date.now())
  const [garageGapMinutes, setGarageGapMinutes] = useState(GARAGE_GAP_MINUTES_DEFAULT)

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])

  const selectedPlan = plans.find(p => p.id === selectedPlanId) || null
  const pendingStores = planStores.filter(ps => ps.status === 'pending').sort((a, b) => a.sequence_order - b.sequence_order)
  const selectedStore = pendingStores.find(ps => ps.id === selectedStoreId) || null
  const allResolved = planStores.length > 0 && pendingStores.length === 0

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedPlanId) fetchPlanStores(selectedPlanId)
  }, [selectedPlanId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data: userData } = await supabase.from('users').select('employee_id, employees(full_name)').eq('id', user.id).single()
    const empId = userData?.employee_id || ''
    setMyEmployeeId(empId)
    setMyName((userData as any)?.employees?.full_name || '')
    if (empId) await fetchPlans(empId)
    const { data: settings } = await supabase.from('logistics_settings').select('garage_gap_active').eq('id', true).maybeSingle()
    setGarageGapMinutes(settings?.garage_gap_active === false ? 0 : GARAGE_GAP_MINUTES_DEFAULT)
    setLoading(false)
  }

  const fetchPlans = useCallback(async (empId: string) => {
    const { data, error } = await supabase
      .from('logistics_delivery_plans')
      .select('id, plan_date, status, vehicle_id, route_id, driver_id, helper_id, box_confirmed_at, vehicles(name, plate_number), delivery_routes(name)')
      .or(`driver_id.eq.${empId},helper_id.eq.${empId}`)
      .in('status', ['ready', 'departed', 'closing'])
      .order('plan_date', { ascending: false })
    if (error) { showMessage('error', 'Gagal memuat tugas: ' + error.message); return }
    setPlans((data as unknown as PlanSummary[]) || [])
  }, [supabase])

  async function fetchPlanStores(planId: string) {
    const { data } = await supabase.from('logistics_plan_stores')
      .select(`id, store_id, sequence_order, status, delivery_photo_urls,
        payment_method, payment_amount, payment_photo_url, payment_due_date,
        incident_type, incident_photo_url, incident_description, failed_reason,
        logistics_stores(name, address, phone)`)
      .eq('plan_id', planId).order('sequence_order')
    setPlanStores((data as unknown as PlanStore[]) || [])
  }

  async function refresh() {
    if (myEmployeeId) await fetchPlans(myEmployeeId)
    if (selectedPlanId) await fetchPlanStores(selectedPlanId)
  }

  // Simpan toko yang sedang DITUJU ke rencana (bukan cuma state lokal) -- supaya kantor bisa
  // lihat progres real-time di Laporan Pengiriman ("Sedang dalam perjalanan menuju..."), bukan
  // cuma status akhir toko itu sendiri.
  async function selectTargetStore(storeId: string) {
    setSelectedStoreId(storeId)
    if (selectedPlanId) {
      await supabase.from('logistics_delivery_plans').update({ current_target_store_id: storeId }).eq('id', selectedPlanId)
    }
  }

  async function clearTargetStore() {
    setSelectedStoreId(null)
    setActionMode(null)
    if (selectedPlanId) {
      await supabase.from('logistics_delivery_plans').update({ current_target_store_id: null }).eq('id', selectedPlanId)
    }
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 6000)
  }

  // Hidrasi dari data yang SUDAH tersimpan di database (kalau ada) -- bukan selalu mulai
  // kosong. Ini yang membuat foto tidak hilang kalau driver tidak sengaja pencet tombol
  // kembali di tengah proses: foto sudah diunggah & disimpan ke baris toko ini seketika
  // (lihat persistDeliveryPhotos & sejenisnya), jadi begitu dibuka lagi, tetap ada.
  function resetKirimForm(store?: PlanStore | null) {
    setKirimStep(1); setShowUnloadConfirm(false)
    setDeliveryPhotoUrls(store?.delivery_photo_urls || []); setAddingDeliveryPhoto(false)
    setPaymentMethod(store?.payment_method || '')
    setPaymentAmount(store?.payment_amount != null ? String(store.payment_amount) : '')
    setPaymentPhotoUrl(store?.payment_photo_url || ''); setPaymentDueDate(store?.payment_due_date || '')
    setIncidentType(store?.incident_type || 'tidak_ada')
    setIncidentPhotoUrl(store?.incident_photo_url || ''); setIncidentDescription(store?.incident_description || '')
  }

  function openAction(mode: ActionMode) {
    resetKirimForm(mode === 'kirim' ? selectedStore : null)
    setFailedReason('')
    setActionMode(mode)
  }

  // Simpan patch ke state lokal planStores juga (bukan cuma database) -- supaya selectedStore
  // langsung ikut ter-update tanpa perlu refetch, dipakai saat resetKirimForm() hidrasi ulang.
  function patchSelectedStoreLocal(patch: Partial<PlanStore>) {
    if (!selectedStore) return
    setPlanStores(prev => prev.map(ps => ps.id === selectedStore.id ? { ...ps, ...patch } : ps))
  }

  // Simpan foto ke database SETIAP KALI berhasil diambil (bukan nunggu submit akhir) --
  // laporan driver: foto ikut hilang kalau tidak sengaja pencet tombol kembali sebelum sempat
  // menekan "Kirim". File-nya sendiri sebenarnya sudah aman di storage sejak diunggah, yang
  // hilang cuma REFERENSI-nya di state lokal HP -- jadi begitu path-nya juga langsung ditulis
  // ke baris toko ini, referensinya tidak hilang lagi walau state lokal reset.
  async function persistStorePhotoField(field: 'delivery_photo_urls' | 'payment_photo_url' | 'incident_photo_url', value: string[] | string | null) {
    if (!selectedStore) return
    const { error } = await supabase.from('logistics_plan_stores').update({ [field]: value }).eq('id', selectedStore.id)
    if (error) { showMessage('error', 'Foto sudah diunggah tapi gagal disimpan ke rencana: ' + error.message); return }
    patchSelectedStoreLocal({ [field]: value } as Partial<PlanStore>)
  }

  async function uploadPhoto(blob: Blob, tag: string): Promise<string | null> {
    if (!selectedPlan || !selectedStore) return null
    const path = `${selectedPlan.id}/${selectedStore.id}-${tag}-${Date.now()}.jpg`
    const { error } = await supabase.storage.from('logistics-photos').upload(path, blob, { contentType: 'image/jpeg' })
    if (error) { showMessage('error', 'Gagal unggah foto: ' + error.message); return null }
    const { data } = supabase.storage.from('logistics-photos').getPublicUrl(path)
    return data.publicUrl
  }

  // Foto tingkat-rencana (box kosong, amper bensin) — bukan per-toko.
  async function uploadPlanPhoto(blob: Blob, tag: string): Promise<string | null> {
    if (!selectedPlan) return null
    const path = `${selectedPlan.id}/${tag}-${Date.now()}.jpg`
    const { error } = await supabase.storage.from('logistics-photos').upload(path, blob, { contentType: 'image/jpeg' })
    if (error) { showMessage('error', 'Gagal unggah foto: ' + error.message); return null }
    const { data } = supabase.storage.from('logistics-photos').getPublicUrl(path)
    return data.publicUrl
  }

  async function confirmBoxPhoto() {
    if (!selectedPlan || !boxPhotoUrl) return
    setSubmitting(true)
    const { error } = await supabase.from('logistics_delivery_plans').update({
      box_photo_url: boxPhotoUrl, box_confirmed_by: myEmployeeId, box_confirmed_at: new Date().toISOString(), status: 'closing',
    }).eq('id', selectedPlan.id).eq('status', 'departed')
    if (error) showMessage('error', 'Gagal: ' + error.message)
    else showMessage('success', 'Box/bak kosong dikonfirmasi. Silakan kembali ke garasi, lapor lagi begitu sudah sampai.')
    setBoxPhotoUrl('')
    await refresh()
    setSubmitting(false)
  }

  async function submitSelesaiKirim() {
    if (!selectedPlan || !garagePhotoUrl || needsRefuel === null) return
    setSubmitting(true)
    const { data, error } = await supabase.rpc('complete_logistics_delivery', {
      p_plan_id: selectedPlan.id, p_garage_photo_url: garagePhotoUrl, p_needs_refuel: needsRefuel,
    })
    if (error) { showMessage('error', 'Gagal menyelesaikan trip: ' + error.message); setSubmitting(false); return }
    const row = Array.isArray(data) ? data[0] : data
    const myShare = myEmployeeId === selectedPlan.driver_id ? row?.driver_earning : row?.helper_earning
    showMessage('success', `Trip selesai! Upah ritase Anda sebesar ${fmtRp(Number(myShare ?? 0))} sudah tercatat.`)
    setGaragePhotoUrl(''); setNeedsRefuel(null)
    setSelectedPlanId(null)
    await refresh()
    setSubmitting(false)
  }

  async function handleBerangkat() {
    if (!selectedPlan) return
    setSubmitting(true)
    const { error } = await supabase.from('logistics_delivery_plans').update({
      status: 'departed', departed_by: myEmployeeId, departed_at: new Date().toISOString(),
    }).eq('id', selectedPlan.id).eq('status', 'ready')
    if (error) showMessage('error', 'Gagal: ' + error.message)
    else showMessage('success', 'Perjalanan dimulai. Selamat jalan!')
    await refresh()
    setSubmitting(false)
  }

  // Gerbang per-langkah wizard -- dipisah dari canSubmitKirim (gerbang akhir) supaya tiap
  // langkah bisa divalidasi & dikonfirmasi sendiri sebelum lanjut ke langkah berikutnya.
  const canProceedStep1 = deliveryPhotoUrls.length > 0
  const canProceedStep2 = !!paymentMethod && (
    paymentMethod === 'cash' ? (!!paymentAmount && Number(paymentAmount) > 0) :
    paymentMethod === 'transfer' ? !!paymentPhotoUrl :
    paymentMethod === 'deposit' ? (!!paymentAmount && Number(paymentAmount) > 0) :
    paymentMethod === 'tempo' ? !!paymentDueDate : false
  )
  const canSubmitKirim = canProceedStep1 && canProceedStep2 &&
    (incidentType === 'tidak_ada' || (!!incidentPhotoUrl && incidentDescription.trim().length > 0))

  async function submitKirim() {
    if (!selectedStore || !canSubmitKirim) return
    setSubmitting(true)
    const { data, error } = await supabase.from('logistics_plan_stores').update({
      status: 'delivered',
      delivery_photo_urls: deliveryPhotoUrls,
      payment_method: paymentMethod || null,
      payment_amount: (paymentMethod === 'cash' || paymentMethod === 'deposit') ? Number(paymentAmount) : null,
      payment_photo_url: paymentMethod === 'transfer' ? paymentPhotoUrl : null,
      payment_due_date: paymentMethod === 'tempo' ? paymentDueDate : null,
      incident_type: incidentType,
      incident_photo_url: incidentType !== 'tidak_ada' ? incidentPhotoUrl : null,
      incident_description: incidentType !== 'tidak_ada' ? incidentDescription.trim() : null,
      resolved_by: myEmployeeId,
      resolved_at: new Date().toISOString(),
    }).eq('id', selectedStore.id).eq('status', 'pending').select('id')

    if (error) { showMessage('error', 'Gagal menyimpan: ' + error.message); setSubmitting(false); return }
    if (!data || data.length === 0) showMessage('error', 'Toko ini sudah lebih dulu diproses oleh rekan Anda.')
    else showMessage('success', `Toko "${selectedStore.logistics_stores?.name}" selesai dikirim.`)
    await clearTargetStore()
    resetKirimForm()
    await refresh()
    setSubmitting(false)
  }

  async function submitGagal() {
    if (!selectedStore || !failedReason.trim()) return
    setSubmitting(true)
    const { data, error } = await supabase.from('logistics_plan_stores').update({
      status: 'failed', failed_reason: failedReason.trim(), resolved_by: myEmployeeId, resolved_at: new Date().toISOString(),
    }).eq('id', selectedStore.id).eq('status', 'pending').select('id')
    if (error) { showMessage('error', 'Gagal menyimpan: ' + error.message); setSubmitting(false); return }
    if (!data || data.length === 0) showMessage('error', 'Toko ini sudah lebih dulu diproses oleh rekan Anda.')
    else showMessage('success', `Toko "${selectedStore.logistics_stores?.name}" ditandai gagal kirim.`)
    await clearTargetStore()
    setFailedReason('')
    await refresh()
    setSubmitting(false)
  }

  async function submitFinishEarly() {
    if (!selectedPlan || !finishReason.trim() || pendingStores.length === 0) return
    setFinishSaving(true)
    const { error } = await supabase.from('logistics_plan_stores').update({
      status: 'failed', failed_reason: finishReason.trim(), resolved_by: myEmployeeId, resolved_at: new Date().toISOString(),
    }).eq('plan_id', selectedPlan.id).eq('status', 'pending')
    if (error) { showMessage('error', 'Gagal menyimpan: ' + error.message); setFinishSaving(false); return }
    showMessage('success', `${pendingStores.length} toko yang belum terkirim ditandai Gagal Kirim.`)
    setShowFinishConfirm(false)
    setFinishReason('')
    await refresh()
    setFinishSaving(false)
  }

  function openEditHistory(ps: PlanStore) {
    setEditHistoryStore(ps)
    setEditPaymentMethod(ps.payment_method || '')
    setEditPaymentAmount(ps.payment_amount ? String(ps.payment_amount) : '')
    setEditPaymentDueDate(ps.payment_due_date || '')
  }

  const canSubmitEditHistory = !!editPaymentMethod && (
    editPaymentMethod === 'cash' || editPaymentMethod === 'deposit' ? (!!editPaymentAmount && Number(editPaymentAmount) > 0) :
    editPaymentMethod === 'tempo' ? !!editPaymentDueDate :
    editPaymentMethod === 'transfer' ? true : false
  )

  // Foto bukti transfer TIDAK diminta ulang di sini (fitur ini cuma untuk betulkan salah
  // ketik nominal/metode/tanggal, bukan mengulang seluruh alur foto) — kalau metode diubah
  // KE transfer padahal fotonya belum ada, tetap disimpan tanpa foto; kalau diubah DARI
  // transfer, foto lama dibiarkan tersimpan di baris (tidak ditampilkan lagi karena metode
  // sudah bukan transfer, tapi datanya tidak hilang kalau mau dikembalikan ke transfer lagi).
  async function submitEditHistory() {
    if (!editHistoryStore || !canSubmitEditHistory) return
    setEditSaving(true)
    const { error } = await supabase.from('logistics_plan_stores').update({
      payment_method: editPaymentMethod || null,
      payment_amount: (editPaymentMethod === 'cash' || editPaymentMethod === 'deposit') ? Number(editPaymentAmount) : null,
      payment_due_date: editPaymentMethod === 'tempo' ? editPaymentDueDate : null,
    }).eq('id', editHistoryStore.id).eq('status', 'delivered')
    if (error) showMessage('error', 'Gagal menyimpan perubahan: ' + error.message)
    else showMessage('success', 'Data pembayaran berhasil diperbarui.')
    setEditHistoryStore(null)
    await refresh()
    setEditSaving(false)
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Pengiriman Logistik</h1>
      <p className="text-sm text-slate-500 mb-6">Jalankan trip pengiriman Anda.</p>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm">Memuat...</div>
      ) : plans.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
          Tidak ada tugas pengiriman aktif untuk Anda saat ini.
        </div>
      ) : !selectedPlanId ? (
        <div className="space-y-3">
          {plans.map(p => (
            <button key={p.id} onClick={() => setSelectedPlanId(p.id)}
              className="w-full text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-blue-300 transition">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-bold text-slate-800">{p.vehicles?.name} — {p.delivery_routes?.name}</p>
                  <p className="text-xs text-slate-500">{new Date(p.plan_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-semibold whitespace-nowrap">{STATUS_LABEL[p.status]}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <button onClick={() => setSelectedPlanId(null)} className="text-sm text-blue-600 hover:underline mb-4">← Pilih Tugas Lain</button>

          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
            <p className="font-bold text-slate-800">{selectedPlan?.vehicles?.name} — {selectedPlan?.delivery_routes?.name}</p>
            <p className="text-xs text-slate-500">{planStores.length} toko dalam rencana ini</p>
          </div>

          {selectedPlan?.status === 'ready' && (
            <button onClick={handleBerangkat} disabled={submitting}
              className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg shadow-sm transition disabled:opacity-50">
              🚚 {submitting ? 'Memproses...' : 'Berangkat'}
            </button>
          )}

          {selectedPlan?.status === 'departed' && !allResolved && !selectedStore && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                <p className="text-sm font-bold text-slate-700">Pilih Toko ({pendingStores.length} tersisa)</p>
                <p className="text-xs text-slate-400 mt-0.5">Bebas pilih toko mana saja, tidak harus berurutan. Nomor cuma referensi urutan rencana awal.</p>
              </div>
              <div className="divide-y divide-slate-100">
                {pendingStores.map(ps => (
                  <button key={ps.id} onClick={() => selectTargetStore(ps.id)}
                    className="w-full text-left px-4 py-3 hover:bg-blue-50/50 transition flex items-center gap-3">
                    <span className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 shrink-0">{ps.sequence_order}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{ps.logistics_stores?.name}</p>
                      {ps.logistics_stores?.address && <p className="text-xs text-slate-400 truncate">{ps.logistics_stores.address}</p>}
                    </div>
                    <span className="text-slate-300">›</span>
                  </button>
                ))}
              </div>
              <div className="px-4 py-3 border-t border-slate-100">
                <button onClick={() => { setFinishReason(''); setShowFinishConfirm(true) }}
                  className="w-full py-2 text-sm font-medium text-slate-500 border border-dashed border-slate-300 rounded-lg hover:bg-slate-50 hover:text-slate-700 transition">
                  🏁 Selesai Tugas (masih ada {pendingStores.length} toko belum terkirim)
                </button>
              </div>
            </div>
          )}

          {showFinishConfirm && (
            <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
                <h3 className="font-semibold text-slate-800 mb-2">Akhiri Trip Lebih Awal?</h3>
                <p className="text-sm text-slate-600 mb-3">
                  Ada <strong>{pendingStores.length} toko</strong> yang belum terkirim:
                </p>
                <ul className="text-sm text-slate-600 list-disc list-inside mb-3 max-h-32 overflow-y-auto">
                  {pendingStores.map(ps => <li key={ps.id}>{ps.logistics_stores?.name}</li>)}
                </ul>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                  Toko-toko di atas akan otomatis ditandai <strong>Gagal Kirim</strong> dengan alasan yang Anda isi di bawah. Pastikan ini benar sebelum lanjut.
                </p>
                <input type="text" value={finishReason} onChange={e => setFinishReason(e.target.value)}
                  placeholder="Alasan (contoh: trip diakhiri, kehabisan waktu)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none mb-3" />
                <div className="flex gap-3">
                  <button onClick={() => setShowFinishConfirm(false)} className="flex-1 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Batal</button>
                  <button onClick={submitFinishEarly} disabled={!finishReason.trim() || finishSaving}
                    className="flex-1 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50">
                    {finishSaving ? 'Menyimpan...' : 'Ya, Lanjutkan'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {selectedPlan?.status === 'departed' && !allResolved && selectedStore && (
            <div className="bg-white rounded-xl border-2 border-blue-200 p-5">
              <button onClick={clearTargetStore} className="text-xs text-blue-600 hover:underline mb-2">← Pilih Toko Lain</button>
              <p className="text-xs text-slate-500 mb-1">Toko #{selectedStore.sequence_order} · {pendingStores.length} toko tersisa</p>
              <h2 className="text-lg font-bold text-slate-800 mb-1">{selectedStore.logistics_stores?.name}</h2>
              {selectedStore.logistics_stores?.address && <p className="text-sm text-slate-500 mb-2">{selectedStore.logistics_stores.address}</p>}
              {selectedStore.logistics_stores?.phone ? (
                <a href={toWaLink(selectedStore.logistics_stores.phone)} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mb-2 px-3 py-1.5 bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 text-xs font-semibold rounded-lg transition">
                  💬 Hubungi via WhatsApp — {selectedStore.logistics_stores.phone}
                </a>
              ) : (
                <p className="inline-flex items-center gap-1.5 mb-2 px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-400 text-xs font-medium rounded-lg">
                  Tidak ada nomor kontak
                </p>
              )}

              {!actionMode && (
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <button onClick={() => openAction('kirim')} className="py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition">Kirim</button>
                  <button onClick={() => openAction('gagal')} className="py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition">Gagal Kirim</button>
                </div>
              )}

              {actionMode === 'kirim' && (
                <div className="space-y-4 mt-2">
                  {/* Indikator langkah — supaya driver tahu lagi di tahap mana & masih berapa
                      langkah lagi, bukan cuma langsung tenggelam di 1 form panjang. */}
                  <div className="flex items-center gap-2">
                    {[1, 2, 3].map(n => (
                      <div key={n} className={`flex-1 h-1.5 rounded-full ${n <= kirimStep ? 'bg-blue-600' : 'bg-slate-100'}`} />
                    ))}
                  </div>

                  {kirimStep === 1 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">
                        Langkah 1 — Foto Bukti Kirim{deliveryPhotoUrls.length > 0 ? ` (${deliveryPhotoUrls.length} foto)` : ''}
                      </p>
                      {deliveryPhotoUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {deliveryPhotoUrls.map((url, idx) => (
                            <div key={idx} className="relative">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={`Bukti kirim ${idx + 1}`} className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
                              <button type="button" onClick={async () => {
                                  const updated = deliveryPhotoUrls.filter((_, i) => i !== idx)
                                  setDeliveryPhotoUrls(updated)
                                  await persistStorePhotoField('delivery_photo_urls', updated)
                                }}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-red-600 text-white rounded-full text-xs shadow">✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                      {deliveryPhotoUrls.length === 0 || addingDeliveryPhoto ? (
                        <LogisticsCameraCapture label="Foto Bukti Kirim" employeeName={myName}
                          onCaptured={async blob => {
                            const url = await uploadPhoto(blob, 'kirim')
                            if (url) {
                              const updated = [...deliveryPhotoUrls, url]
                              setDeliveryPhotoUrls(updated)
                              setAddingDeliveryPhoto(false)
                              await persistStorePhotoField('delivery_photo_urls', updated)
                            }
                          }}
                          onCancel={() => setAddingDeliveryPhoto(false)} />
                      ) : (
                        <button type="button" onClick={() => setAddingDeliveryPhoto(true)}
                          className="w-full py-2 border border-dashed border-slate-300 text-slate-500 text-sm font-medium rounded-lg hover:bg-slate-50 transition">
                          + Tambah Foto Lagi
                        </button>
                      )}
                      {showUnloadConfirm ? (
                        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <p className="text-xs text-blue-800 font-medium mb-2">
                            ✋ Yakin barang di toko ini sudah turun semua?
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => setShowUnloadConfirm(false)}
                              className="py-2 border border-slate-300 bg-white text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50">
                              Belum
                            </button>
                            <button type="button" onClick={() => { setKirimStep(2); setShowUnloadConfirm(false) }}
                              className="py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition">
                              Sudah, Lanjut →
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 pt-3">
                          <button onClick={() => setActionMode(null)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
                          <button onClick={() => setShowUnloadConfirm(true)} disabled={!canProceedStep1}
                            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                            Lanjut ke Langkah 2 →
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {kirimStep === 2 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Langkah 2 — Metode Pembayaran</p>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {(['cash', 'transfer', 'deposit', 'tempo'] as const).map(m => (
                          <button key={m} type="button" onClick={() => setPaymentMethod(m)}
                            className={`py-2 rounded-lg text-sm font-medium border transition ${paymentMethod === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                            {m === 'cash' ? 'Cash' : m === 'transfer' ? 'Transfer' : m === 'deposit' ? 'Deposit' : 'Tempo'}
                          </button>
                        ))}
                      </div>
                      {paymentMethod === 'cash' && (
                        <RupiahInput value={paymentAmount} onChange={setPaymentAmount} placeholder="Nominal cash diterima"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                      )}
                      {paymentMethod === 'deposit' && (
                        <RupiahInput value={paymentAmount} onChange={setPaymentAmount} placeholder="Nominal deposit"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                      )}
                      {paymentMethod === 'tempo' && (
                        <input type="date" value={paymentDueDate} onChange={e => setPaymentDueDate(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                      )}
                      {paymentMethod === 'transfer' && (
                        paymentPhotoUrl ? (
                          <div className="space-y-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={paymentPhotoUrl} alt="Bukti transfer" className="w-full rounded-lg aspect-[4/3] object-cover" />
                            <button onClick={async () => { setPaymentPhotoUrl(''); await persistStorePhotoField('payment_photo_url', null) }} className="text-xs text-blue-600 hover:underline">Ganti Foto</button>
                          </div>
                        ) : (
                          <LogisticsCameraCapture label="Foto Bukti Transfer" employeeName={myName}
                            onCaptured={async blob => {
                              const url = await uploadPhoto(blob, 'transfer')
                              if (url) { setPaymentPhotoUrl(url); await persistStorePhotoField('payment_photo_url', url) }
                            }} />
                        )
                      )}

                      {canProceedStep2 && (
                        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <p className="text-xs text-blue-800 font-medium mb-2">
                            ✋ Sebelum lanjut — sudah dikonfirmasi ke toko, barang yang diterima sudah benar & lengkap?
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => showMessage('error', 'Konfirmasi dulu ke toko sebelum lanjut ke Langkah 3.')}
                              className="py-2 border border-slate-300 bg-white text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50">
                              Belum
                            </button>
                            <button type="button" onClick={() => setKirimStep(3)}
                              className="py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition">
                              Ya, Lanjut →
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2 pt-3">
                        <button onClick={() => setKirimStep(1)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">← Kembali</button>
                        <button onClick={() => setActionMode(null)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
                      </div>
                    </div>
                  )}

                  {kirimStep === 3 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Langkah 3 — Kejadian</p>
                      <p className="text-xs text-slate-400 mb-2">Ada barang retur atau salah muat di toko ini?</p>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {(['tidak_ada', 'salah_muat', 'retur'] as const).map(k => (
                          <button key={k} type="button" onClick={() => setIncidentType(k)}
                            className={`py-2 rounded-lg text-xs font-medium border transition ${incidentType === k ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                            {k === 'tidak_ada' ? 'Tidak Ada' : k === 'salah_muat' ? 'Salah Muat' : 'Retur'}
                          </button>
                        ))}
                      </div>
                      {incidentType !== 'tidak_ada' && (
                        <div className="space-y-2">
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            Wajib foto dan tulis keterangan sebelum bisa lanjut.
                          </p>
                          {incidentPhotoUrl ? (
                            <div className="space-y-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={incidentPhotoUrl} alt="Foto kejadian" className="w-full rounded-lg aspect-[4/3] object-cover" />
                              <button onClick={async () => { setIncidentPhotoUrl(''); await persistStorePhotoField('incident_photo_url', null) }} className="text-xs text-blue-600 hover:underline">Ganti Foto</button>
                            </div>
                          ) : (
                            <LogisticsCameraCapture label="Foto Kejadian" employeeName={myName}
                              onCaptured={async blob => {
                                const url = await uploadPhoto(blob, 'kejadian')
                                if (url) { setIncidentPhotoUrl(url); await persistStorePhotoField('incident_photo_url', url) }
                              }} />
                          )}
                          <textarea value={incidentDescription} onChange={e => setIncidentDescription(e.target.value)}
                            placeholder="Keterangan kejadian..." rows={3}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
                        </div>
                      )}

                      <div className="flex gap-2 pt-3">
                        <button onClick={() => setKirimStep(2)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">← Kembali</button>
                        <button onClick={submitKirim} disabled={!canSubmitKirim || submitting}
                          className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                          {submitting ? 'Menyimpan...' : incidentType === 'tidak_ada' ? 'Pengiriman Selesai' : 'Kirim & Selesaikan'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {actionMode === 'gagal' && (
                <div className="space-y-3 mt-2">
                  <div className="grid grid-cols-2 gap-2">
                    {['Toko Tutup', 'Toko Tidak Memesan'].map(r => (
                      <button key={r} type="button" onClick={() => setFailedReason(r)}
                        className={`py-2 rounded-lg text-sm font-medium border transition ${failedReason === r ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                        {r}
                      </button>
                    ))}
                  </div>
                  <input type="text" value={failedReason} onChange={e => setFailedReason(e.target.value)} placeholder="Atau isi alasan lain..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => setActionMode(null)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
                    <button onClick={submitGagal} disabled={!failedReason.trim() || submitting}
                      className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                      {submitting ? 'Menyimpan...' : 'Konfirmasi Gagal Kirim'}
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}

          {selectedPlan?.status === 'departed' && allResolved && (
            <div className="bg-white rounded-xl border-2 border-blue-200 p-5">
              <h2 className="text-lg font-bold text-slate-800 mb-1">✓ Semua Toko Sudah Diproses</h2>
              <p className="text-sm text-slate-500 mb-4">Sebelum kembali ke garasi, foto dulu kondisi box/bak yang sudah kosong.</p>
              {boxPhotoUrl ? (
                <div className="space-y-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={boxPhotoUrl} alt="Box kosong" className="w-full rounded-lg aspect-[4/3] object-cover" />
                  <button onClick={() => setBoxPhotoUrl('')} className="text-xs text-blue-600 hover:underline">Ambil Ulang</button>
                  <button onClick={confirmBoxPhoto} disabled={submitting}
                    className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition disabled:opacity-50">
                    {submitting ? 'Memproses...' : 'Konfirmasi & Kembali ke Garasi'}
                  </button>
                </div>
              ) : (
                <LogisticsCameraCapture label="Foto Box/Bak Kosong" employeeName={myName}
                  onCaptured={async blob => { const url = await uploadPlanPhoto(blob, 'box'); if (url) setBoxPhotoUrl(url) }} />
              )}
            </div>
          )}

          {selectedPlan?.status === 'closing' && (() => {
            const boxConfirmedAt = selectedPlan.box_confirmed_at ? new Date(selectedPlan.box_confirmed_at).getTime() : null
            const msRemaining = boxConfirmedAt ? (boxConfirmedAt + garageGapMinutes * 60000) - nowTick : 0
            const canReportGarage = boxConfirmedAt !== null && msRemaining <= 0
            return (
              <div className="bg-white rounded-xl border-2 border-purple-200 p-5">
                <h2 className="text-lg font-bold text-slate-800 mb-1">Lapor Sampai Garasi</h2>
                {!canReportGarage ? (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                    Tunggu {Math.max(1, Math.ceil(msRemaining / 60000))} menit lagi sebelum bisa lapor sampai garasi (anti-kecurangan).
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Foto Amper Bensin</p>
                      {garagePhotoUrl ? (
                        <div className="space-y-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={garagePhotoUrl} alt="Amper bensin" className="w-full rounded-lg aspect-[4/3] object-cover" />
                          <button onClick={() => setGaragePhotoUrl('')} className="text-xs text-blue-600 hover:underline">Ganti Foto</button>
                        </div>
                      ) : (
                        <LogisticsCameraCapture label="Foto Amper Bensin" employeeName={myName}
                          onCaptured={async blob => { const url = await uploadPlanPhoto(blob, 'garasi'); if (url) setGaragePhotoUrl(url) }} />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Perlu Isi Bensin Besok?</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setNeedsRefuel(true)}
                          className={`py-2 rounded-lg text-sm font-medium border transition ${needsRefuel === true ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>Ya</button>
                        <button type="button" onClick={() => setNeedsRefuel(false)}
                          className={`py-2 rounded-lg text-sm font-medium border transition ${needsRefuel === false ? 'bg-slate-600 text-white border-slate-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>Tidak</button>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400">Upah ritase resmi tercatat begitu Anda menekan "Selesai Kirim" di bawah ini.</p>
                    <button onClick={submitSelesaiKirim} disabled={!garagePhotoUrl || needsRefuel === null || submitting}
                      className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg shadow-sm transition disabled:opacity-50">
                      {submitting ? 'Memproses...' : 'Selesai Kirim'}
                    </button>
                  </div>
                )}
              </div>
            )
          })()}

          {planStores.some(ps => ps.status !== 'pending') && (
            <div className="mt-6 bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-sm font-bold text-slate-700">Riwayat Toko</div>
              <div className="divide-y divide-slate-100">
                {planStores.filter(ps => ps.status !== 'pending').map(ps => (
                  <div key={ps.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-700 font-medium">{ps.logistics_stores?.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${ps.status === 'delivered' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          {ps.status === 'delivered' ? 'Terkirim' : 'Gagal'}
                        </span>
                        {ps.status === 'delivered' && (
                          <button onClick={() => openEditHistory(ps)} className="text-xs text-blue-600 hover:underline font-medium">Edit</button>
                        )}
                      </div>
                    </div>

                    {ps.status === 'failed' && ps.failed_reason && (
                      <p className="text-xs text-red-600 mt-1">Alasan: {ps.failed_reason}</p>
                    )}

                    {ps.status === 'delivered' && ps.payment_method && (
                      <p className="text-xs text-slate-500 mt-1">
                        {PAYMENT_LABEL[ps.payment_method]}
                        {ps.payment_amount ? ` — ${fmtRp(Number(ps.payment_amount))}` : ''}
                        {ps.payment_due_date ? ` — jatuh tempo ${new Date(ps.payment_due_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}` : ''}
                      </p>
                    )}
                    {ps.incident_type !== 'tidak_ada' && (
                      <p className="text-xs text-amber-600 mt-1">
                        {ps.incident_type === 'salah_muat' ? 'Salah Muat' : 'Retur'}{ps.incident_description ? `: ${ps.incident_description}` : ''}
                      </p>
                    )}

                    {((ps.delivery_photo_urls && ps.delivery_photo_urls.length > 0) || ps.payment_photo_url || ps.incident_photo_url) && (
                      <div className="flex gap-3 mt-2 flex-wrap">
                        {ps.delivery_photo_urls?.map((url, idx) => (
                          <button key={idx} type="button" onClick={() => openLightbox(url, `Bukti kirim ${idx + 1}`)} title={`Bukti Kirim ${idx + 1}`} className="flex flex-col items-center gap-1">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt={`Bukti kirim ${idx + 1}`} className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                            <span className="text-[10px] text-slate-500 font-medium">Bukti Kirim{ps.delivery_photo_urls!.length > 1 ? ` ${idx + 1}` : ''}</span>
                          </button>
                        ))}
                        {ps.payment_photo_url && (
                          <button type="button" onClick={() => openLightbox(ps.payment_photo_url!, 'Bukti transfer')} title="Bukti Transfer" className="flex flex-col items-center gap-1">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={ps.payment_photo_url} alt="Bukti transfer" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                            <span className="text-[10px] text-slate-500 font-medium">Bukti Transfer</span>
                          </button>
                        )}
                        {ps.incident_photo_url && (
                          <button type="button" onClick={() => openLightbox(ps.incident_photo_url!, 'Foto kejadian')} title="Foto Kejadian" className="flex flex-col items-center gap-1">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={ps.incident_photo_url} alt="Foto kejadian" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                            <span className="text-[10px] text-slate-500 font-medium">Foto Kejadian</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {editHistoryStore && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-slate-800 mb-1">Edit Pembayaran</h3>
            <p className="text-xs text-slate-500 mb-4">{editHistoryStore.logistics_stores?.name}</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {(['cash', 'transfer', 'deposit', 'tempo'] as const).map(m => (
                  <button key={m} type="button" onClick={() => setEditPaymentMethod(m)}
                    className={`py-2 rounded-lg text-sm font-medium border transition ${editPaymentMethod === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                    {PAYMENT_LABEL[m]}
                  </button>
                ))}
              </div>
              {(editPaymentMethod === 'cash' || editPaymentMethod === 'deposit') && (
                <RupiahInput value={editPaymentAmount} onChange={setEditPaymentAmount}
                  placeholder={editPaymentMethod === 'cash' ? 'Nominal cash diterima' : 'Nominal deposit'}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              )}
              {editPaymentMethod === 'tempo' && (
                <input type="date" value={editPaymentDueDate} onChange={e => setEditPaymentDueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              )}
              {editPaymentMethod === 'transfer' && (
                <p className="text-xs text-slate-400">Foto bukti transfer yang sudah diunggah tidak berubah — cuma metode/nominal/tanggalnya yang bisa dikoreksi di sini.</p>
              )}
            </div>
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={() => setEditHistoryStore(null)} className="flex-1 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Batal</button>
              <button type="button" onClick={submitEditHistory} disabled={!canSubmitEditHistory || editSaving}
                className="flex-1 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                {editSaving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
