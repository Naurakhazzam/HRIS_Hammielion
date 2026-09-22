'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import RupiahInput from '@/components/RupiahInput'
import LogisticsCameraCapture from '@/components/LogisticsCameraCapture'
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

const GARAGE_GAP_MINUTES = 30

const fmtRp = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

type PlanStore = {
  id: string
  store_id: string
  sequence_order: number
  status: string
  logistics_stores: { name: string; address: string | null; phone: string | null } | null
}

type ActionMode = null | 'kirim' | 'gagal' | 'tunda'
type PaymentMethod = '' | 'cash' | 'transfer' | 'deposit' | 'tempo'

const STATUS_LABEL: Record<string, string> = {
  ready: 'Siap Berangkat', departed: 'Sedang Jalan', closing: 'Menuju Garasi',
}

export default function JalanPengirimanPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [myName, setMyName] = useState('')
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [planStores, setPlanStores] = useState<PlanStore[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [actionMode, setActionMode] = useState<ActionMode>(null)

  // Form Kirim
  const [deliveryPhotoUrl, setDeliveryPhotoUrl] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentPhotoUrl, setPaymentPhotoUrl] = useState('')
  const [paymentDueDate, setPaymentDueDate] = useState('')
  const [incidentType, setIncidentType] = useState<'tidak_ada' | 'salah_muat' | 'retur'>('tidak_ada')
  const [incidentPhotoUrl, setIncidentPhotoUrl] = useState('')
  const [incidentDescription, setIncidentDescription] = useState('')

  // Form Gagal Kirim
  const [failedReason, setFailedReason] = useState('')

  // Penutupan trip (box kosong -> jeda 30 menit -> lapor garasi)
  const [boxPhotoUrl, setBoxPhotoUrl] = useState('')
  const [garagePhotoUrl, setGaragePhotoUrl] = useState('')
  const [needsRefuel, setNeedsRefuel] = useState<boolean | null>(null)
  const [nowTick, setNowTick] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])

  const selectedPlan = plans.find(p => p.id === selectedPlanId) || null
  const pendingStores = planStores.filter(ps => ps.status === 'pending').sort((a, b) => a.sequence_order - b.sequence_order)
  const activeStore = pendingStores[0] || null
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
      .select('id, store_id, sequence_order, status, logistics_stores(name, address, phone)')
      .eq('plan_id', planId).order('sequence_order')
    setPlanStores((data as unknown as PlanStore[]) || [])
  }

  async function refresh() {
    if (myEmployeeId) await fetchPlans(myEmployeeId)
    if (selectedPlanId) await fetchPlanStores(selectedPlanId)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 6000)
  }

  function resetKirimForm() {
    setDeliveryPhotoUrl(''); setPaymentMethod(''); setPaymentAmount('')
    setPaymentPhotoUrl(''); setPaymentDueDate('')
    setIncidentType('tidak_ada'); setIncidentPhotoUrl(''); setIncidentDescription('')
  }

  function openAction(mode: ActionMode) {
    resetKirimForm()
    setFailedReason('')
    setActionMode(mode)
  }

  async function uploadPhoto(blob: Blob, tag: string): Promise<string | null> {
    if (!selectedPlan || !activeStore) return null
    const path = `${selectedPlan.id}/${activeStore.id}-${tag}-${Date.now()}.jpg`
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

  const canSubmitKirim = !!deliveryPhotoUrl && !!paymentMethod && (
    paymentMethod === 'cash' ? (!!paymentAmount && Number(paymentAmount) > 0) :
    paymentMethod === 'transfer' ? !!paymentPhotoUrl :
    paymentMethod === 'deposit' ? (!!paymentAmount && Number(paymentAmount) > 0) :
    paymentMethod === 'tempo' ? !!paymentDueDate : false
  ) && (incidentType === 'tidak_ada' || (!!incidentPhotoUrl && incidentDescription.trim().length > 0))

  async function submitKirim() {
    if (!activeStore || !canSubmitKirim) return
    setSubmitting(true)
    const { data, error } = await supabase.from('logistics_plan_stores').update({
      status: 'delivered',
      delivery_photo_url: deliveryPhotoUrl,
      payment_method: paymentMethod || null,
      payment_amount: (paymentMethod === 'cash' || paymentMethod === 'deposit') ? Number(paymentAmount) : null,
      payment_photo_url: paymentMethod === 'transfer' ? paymentPhotoUrl : null,
      payment_due_date: paymentMethod === 'tempo' ? paymentDueDate : null,
      incident_type: incidentType,
      incident_photo_url: incidentType !== 'tidak_ada' ? incidentPhotoUrl : null,
      incident_description: incidentType !== 'tidak_ada' ? incidentDescription.trim() : null,
      resolved_by: myEmployeeId,
      resolved_at: new Date().toISOString(),
    }).eq('id', activeStore.id).eq('status', 'pending').select('id')

    if (error) { showMessage('error', 'Gagal menyimpan: ' + error.message); setSubmitting(false); return }
    if (!data || data.length === 0) showMessage('error', 'Toko ini sudah lebih dulu diproses oleh rekan Anda.')
    else showMessage('success', `Toko "${activeStore.logistics_stores?.name}" selesai dikirim.`)
    setActionMode(null)
    resetKirimForm()
    await refresh()
    setSubmitting(false)
  }

  async function submitGagal() {
    if (!activeStore || !failedReason.trim()) return
    setSubmitting(true)
    const { data, error } = await supabase.from('logistics_plan_stores').update({
      status: 'failed', failed_reason: failedReason.trim(), resolved_by: myEmployeeId, resolved_at: new Date().toISOString(),
    }).eq('id', activeStore.id).eq('status', 'pending').select('id')
    if (error) { showMessage('error', 'Gagal menyimpan: ' + error.message); setSubmitting(false); return }
    if (!data || data.length === 0) showMessage('error', 'Toko ini sudah lebih dulu diproses oleh rekan Anda.')
    else showMessage('success', `Toko "${activeStore.logistics_stores?.name}" ditandai gagal kirim.`)
    setActionMode(null)
    setFailedReason('')
    await refresh()
    setSubmitting(false)
  }

  async function submitTunda() {
    if (!activeStore) return
    setSubmitting(true)
    const { error } = await supabase.rpc('tunda_toko', { p_plan_store_id: activeStore.id })
    if (error) showMessage('error', 'Gagal menunda: ' + error.message)
    else showMessage('success', `Toko "${activeStore.logistics_stores?.name}" ditunda, akan muncul lagi setelah toko berikutnya.`)
    setActionMode(null)
    await refresh()
    setSubmitting(false)
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

          {selectedPlan?.status === 'departed' && !allResolved && activeStore && (
            <div className="bg-white rounded-xl border-2 border-blue-200 p-5">
              <p className="text-xs text-slate-500 mb-1">Toko Aktif ({planStores.findIndex(ps => ps.id === activeStore.id) + 1} dari {planStores.length})</p>
              <h2 className="text-lg font-bold text-slate-800 mb-1">{activeStore.logistics_stores?.name}</h2>
              {activeStore.logistics_stores?.address && <p className="text-sm text-slate-500 mb-2">{activeStore.logistics_stores.address}</p>}
              {activeStore.logistics_stores?.phone ? (
                <a href={toWaLink(activeStore.logistics_stores.phone)} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mb-2 px-3 py-1.5 bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 text-xs font-semibold rounded-lg transition">
                  💬 Hubungi via WhatsApp — {activeStore.logistics_stores.phone}
                </a>
              ) : (
                <p className="inline-flex items-center gap-1.5 mb-2 px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-400 text-xs font-medium rounded-lg">
                  Tidak ada nomor kontak
                </p>
              )}

              {!actionMode && (
                <div className="grid grid-cols-3 gap-2 mt-4">
                  <button onClick={() => openAction('kirim')} className="py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition">Kirim</button>
                  <button onClick={() => openAction('gagal')} className="py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition">Gagal Kirim</button>
                  <button onClick={() => openAction('tunda')} className="py-2.5 border border-amber-300 text-amber-700 hover:bg-amber-50 text-sm font-semibold rounded-lg transition">Tunda</button>
                </div>
              )}

              {actionMode === 'kirim' && (
                <div className="space-y-4 mt-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-2">1. Foto Bukti Kirim</p>
                    {deliveryPhotoUrl ? (
                      <div className="space-y-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={deliveryPhotoUrl} alt="Bukti kirim" className="w-full rounded-lg aspect-[4/3] object-cover" />
                        <button onClick={() => setDeliveryPhotoUrl('')} className="text-xs text-blue-600 hover:underline">Ganti Foto</button>
                      </div>
                    ) : (
                      <LogisticsCameraCapture label="Foto Bukti Kirim" employeeName={myName}
                        onCaptured={async blob => { const url = await uploadPhoto(blob, 'kirim'); if (url) setDeliveryPhotoUrl(url) }} />
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-2">2. Metode Pembayaran</p>
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
                          <button onClick={() => setPaymentPhotoUrl('')} className="text-xs text-blue-600 hover:underline">Ganti Foto</button>
                        </div>
                      ) : (
                        <LogisticsCameraCapture label="Foto Bukti Transfer" employeeName={myName}
                          onCaptured={async blob => { const url = await uploadPhoto(blob, 'transfer'); if (url) setPaymentPhotoUrl(url) }} />
                      )
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-2">3. Kejadian</p>
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
                        {incidentPhotoUrl ? (
                          <div className="space-y-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={incidentPhotoUrl} alt="Foto kejadian" className="w-full rounded-lg aspect-[4/3] object-cover" />
                            <button onClick={() => setIncidentPhotoUrl('')} className="text-xs text-blue-600 hover:underline">Ganti Foto</button>
                          </div>
                        ) : (
                          <LogisticsCameraCapture label="Foto Kejadian" employeeName={myName}
                            onCaptured={async blob => { const url = await uploadPhoto(blob, 'kejadian'); if (url) setIncidentPhotoUrl(url) }} />
                        )}
                        <textarea value={incidentDescription} onChange={e => setIncidentDescription(e.target.value)}
                          placeholder="Keterangan kejadian..." rows={3}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button onClick={() => setActionMode(null)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
                    <button onClick={submitKirim} disabled={!canSubmitKirim || submitting}
                      className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                      {submitting ? 'Menyimpan...' : 'Toko Selesai'}
                    </button>
                  </div>
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

              {actionMode === 'tunda' && (
                <div className="space-y-3 mt-2">
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                    Toko ini akan ditunda — muncul lagi setelah toko berikutnya selesai diproses.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setActionMode(null)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
                    <button onClick={submitTunda} disabled={submitting}
                      className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                      {submitting ? 'Memproses...' : 'Ya, Tunda'}
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
            const msRemaining = boxConfirmedAt ? (boxConfirmedAt + GARAGE_GAP_MINUTES * 60000) - nowTick : 0
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
                  <div key={ps.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                    <span className="text-slate-700">{ps.logistics_stores?.name}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${ps.status === 'delivered' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {ps.status === 'delivered' ? 'Terkirim' : 'Gagal'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
