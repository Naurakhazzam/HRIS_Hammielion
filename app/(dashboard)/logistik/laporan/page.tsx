'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { localDateStr } from '@/lib/date'
import RupiahInput from '@/components/RupiahInput'
import { usePhotoLightbox } from '@/components/PhotoLightbox'

type Plan = {
  id: string
  plan_date: string
  status: string
  box_photo_url: string | null
  garage_photo_url: string | null
  needs_refuel: boolean | null
  current_target_store_id: string | null
  vehicles: { name: string; plate_number: string | null } | null
  delivery_routes: { name: string } | null
  driver: { full_name: string } | null
  helper: { full_name: string } | null
}

const PLAN_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ready: { label: 'Siap Berangkat', className: 'bg-slate-100 text-slate-600' },
  departed: { label: 'Sedang Berjalan', className: 'bg-blue-100 text-blue-700' },
  closing: { label: 'Menuju Garasi', className: 'bg-purple-100 text-purple-700' },
  completed: { label: 'Selesai', className: 'bg-green-100 text-green-700' },
}

type PlanStore = {
  id: string
  plan_id: string
  sequence_order: number
  status: string
  delivery_photo_urls: string[] | null
  payment_method: string | null
  payment_amount: number | null
  payment_photo_url: string | null
  payment_due_date: string | null
  incident_type: string
  incident_photo_url: string | null
  incident_description: string | null
  failed_reason: string | null
  resolved_at: string | null
  office_verified_amount: number | null
  office_verified_by: string | null
  office_verified_at: string | null
  logistics_stores: { name: string } | null
}

const PAYMENT_LABEL: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', deposit: 'Deposit', tempo: 'Tempo' }

const fmtJam = (ts: string) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

const fmtRp = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

export default function LaporanPengirimanPage() {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()
  const [loading, setLoading] = useState(true)
  const [canView, setCanView] = useState(false)
  // Verifikasi kas fisik cuma untuk tim kantor (Owner/HR/Finance) -- beda dari canView, karena
  // Kepala Gudang boleh LIHAT laporan tapi bukan yang pegang/hitung uang setoran driver.
  const [canVerify, setCanVerify] = useState(false)
  const [filterMonth, setFilterMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [plans, setPlans] = useState<Plan[]>([])
  const [storesByPlan, setStoresByPlan] = useState<Record<string, PlanStore[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [verifyAmount, setVerifyAmount] = useState('')
  const [verifySaving, setVerifySaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [year, month] = filterMonth.split('-').map(Number)
    const startDate = `${filterMonth}-01`
    const endDate = localDateStr(new Date(year, month, 0))

    const { data: planData } = await supabase
      .from('logistics_delivery_plans')
      .select(`
        id, plan_date, status, box_photo_url, garage_photo_url, needs_refuel, current_target_store_id,
        vehicles(name, plate_number),
        delivery_routes(name),
        driver:employees!logistics_delivery_plans_driver_id_fkey(full_name),
        helper:employees!logistics_delivery_plans_helper_id_fkey(full_name)
      `)
      // Dulu cuma status 'completed' -- trip yang MASIH BERJALAN jadi sama sekali tidak
      // terlihat di sini (cuma ada Dashboard Pengiriman yang menampilkan angka ringkas, tanpa
      // rincian per-toko/foto/pembayaran). Sekarang ikutkan semua status kecuali draft (masih
      // disusun, belum "Siap Kirim") dan cancelled (dibatalkan, tidak ada progres kirim nyata).
      .in('status', ['ready', 'departed', 'closing', 'completed'])
      .gte('plan_date', startDate).lte('plan_date', endDate)
      .order('plan_date', { ascending: false })
    const list = (planData as unknown as Plan[]) || []
    setPlans(list)

    if (list.length > 0) {
      const { data: storeData } = await supabase.from('logistics_plan_stores')
        .select(`id, plan_id, sequence_order, status, delivery_photo_urls,
          payment_method, payment_amount, payment_photo_url, payment_due_date,
          incident_type, incident_photo_url, incident_description, failed_reason, resolved_at,
          office_verified_amount, office_verified_by, office_verified_at,
          logistics_stores(name)`)
        .in('plan_id', list.map(p => p.id)).order('sequence_order')
      const grouped: Record<string, PlanStore[]> = {}
      ;(storeData as unknown as PlanStore[] || []).forEach(s => {
        if (!grouped[s.plan_id]) grouped[s.plan_id] = []
        grouped[s.plan_id].push(s)
      })
      setStoresByPlan(grouped)
    } else {
      setStoresByPlan({})
    }
    setLoading(false)
  }, [filterMonth, supabase])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: userData } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
        if (userData) {
          if (['owner', 'hr', 'finance'].includes(userData.role)) { setCanView(true); setCanVerify(true) }
          else if (userData.employee_id) {
            const { data: emp } = await supabase.from('employees').select('positions(name)').eq('id', userData.employee_id).single()
            setCanView((emp as any)?.positions?.name === 'Kepala Gudang')
          }
        }
      }
    }
    init()
  }, [supabase])

  useEffect(() => { fetchData() }, [fetchData])

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  function openVerify(s: PlanStore) {
    setVerifyingId(s.id)
    setVerifyAmount(s.office_verified_amount != null ? String(s.office_verified_amount) : (s.payment_amount != null ? String(s.payment_amount) : ''))
  }

  async function submitVerify(storeId: string) {
    const amt = parseFloat(verifyAmount)
    if (isNaN(amt) || amt < 0) { showMessage('error', 'Nominal tidak valid.'); return }
    setVerifySaving(true)
    const { error } = await supabase.rpc('verify_cash_payment', { p_plan_store_id: storeId, p_verified_amount: amt })
    if (error) showMessage('error', 'Gagal verifikasi: ' + error.message)
    else { showMessage('success', 'Verifikasi kas berhasil disimpan.'); setVerifyingId(null); await fetchData() }
    setVerifySaving(false)
  }

  const allStores = Object.values(storesByPlan).flat()
  const cashStores = allStores.filter(s => s.payment_method === 'cash')
  const totalCash = cashStores.reduce((sum, s) => sum + Number(s.payment_amount || 0), 0)
  const totalTransfer = allStores.filter(s => s.payment_method === 'transfer').length
  const totalDeposit = allStores.filter(s => s.payment_method === 'deposit').reduce((sum, s) => sum + Number(s.payment_amount || 0), 0)
  const totalTempo = allStores.filter(s => s.payment_method === 'tempo').length
  const totalIncident = allStores.filter(s => s.incident_type !== 'tidak_ada').length
  const totalFailed = allStores.filter(s => s.status === 'failed').length
  // Deposit juga uang tunai fisik yang diterima driver (beda dari transfer yang cuma bukti foto),
  // jadi sama-sama butuh verifikasi kantor -- bukan cuma cash.
  const verifiableStores = allStores.filter(s => s.payment_method === 'cash' || s.payment_method === 'deposit')
  const verifiedCashStores = verifiableStores.filter(s => s.office_verified_amount != null)
  const unverifiedCashCount = verifiableStores.length - verifiedCashStores.length
  const totalSelisihKas = verifiedCashStores.reduce((sum, s) => sum + (Number(s.office_verified_amount) - Number(s.payment_amount || 0)), 0)

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) }
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Laporan Pengiriman</h1>
        <p className="text-sm text-slate-500">Rincian tiap trip (yang sedang berjalan maupun yang sudah selesai): mobil, toko yang dikirim, metode bayar, dan foto buktinya.</p>
      </div>

      {message && (
        <div className={`p-4 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {!canView ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
          Halaman ini khusus tim manajemen (Owner/HR/Finance/Kepala Gudang).
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
            <label className="block text-xs text-slate-500 mb-1">Periode</label>
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="w-full sm:w-64 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
              {monthOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
              <p className="text-[11px] text-slate-500 uppercase mb-1">Total Cash</p>
              <p className="text-sm font-bold text-green-600">{fmtRp(totalCash)}</p>
            </div>
            <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
              <p className="text-[11px] text-slate-500 uppercase mb-1">Total Deposit</p>
              <p className="text-sm font-bold text-blue-600">{fmtRp(totalDeposit)}</p>
            </div>
            <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
              <p className="text-[11px] text-slate-500 uppercase mb-1">Toko Transfer</p>
              <p className="text-sm font-bold text-slate-700">{totalTransfer} toko</p>
            </div>
            <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
              <p className="text-[11px] text-slate-500 uppercase mb-1">Toko Tempo</p>
              <p className="text-sm font-bold text-amber-600">{totalTempo} toko</p>
            </div>
            <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
              <p className="text-[11px] text-slate-500 uppercase mb-1">Kejadian</p>
              <p className="text-sm font-bold text-red-500">{totalIncident} toko</p>
            </div>
            <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
              <p className="text-[11px] text-slate-500 uppercase mb-1">Gagal Kirim</p>
              <p className="text-sm font-bold text-red-500">{totalFailed} toko</p>
            </div>
            {canVerify && (
              <>
                <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
                  <p className="text-[11px] text-slate-500 uppercase mb-1">Cash/Deposit Belum Diverifikasi</p>
                  <p className={`text-sm font-bold ${unverifiedCashCount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{unverifiedCashCount} toko</p>
                </div>
                <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
                  <p className="text-[11px] text-slate-500 uppercase mb-1">Selisih Kas (Terverifikasi)</p>
                  <p className={`text-sm font-bold ${totalSelisihKas === 0 ? 'text-slate-400' : totalSelisihKas < 0 ? 'text-red-600' : 'text-blue-600'}`}>{fmtRp(totalSelisihKas)}</p>
                </div>
              </>
            )}
          </div>

          {loading ? (
            <div className="text-center py-12 text-slate-500 text-sm">Memuat...</div>
          ) : plans.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">Belum ada trip selesai di periode ini.</div>
          ) : (
            <div className="space-y-3">
              {plans.map(p => {
                const stores = storesByPlan[p.id] || []
                const isOpen = expanded.has(p.id)
                return (
                  <div key={p.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button onClick={() => toggleExpand(p.id)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition text-left">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-slate-800 text-sm">{p.vehicles?.name} — {p.delivery_routes?.name}</p>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${(PLAN_STATUS_LABEL[p.status] ?? PLAN_STATUS_LABEL.ready).className}`}>
                            {(PLAN_STATUS_LABEL[p.status] ?? PLAN_STATUS_LABEL.ready).label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">{new Date(p.plan_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} · {p.driver?.full_name}{p.helper?.full_name ? ` / ${p.helper.full_name}` : ''} · {stores.length} toko</p>
                      </div>
                      <span className="text-xs text-blue-600 font-medium shrink-0">{isOpen ? 'Tutup ▲' : 'Rincian ▼'}</span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-slate-100 divide-y divide-slate-50">
                        {(p.box_photo_url || p.garage_photo_url) && (
                          <div className="px-4 py-2.5">
                            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Penutupan Trip{p.needs_refuel ? ' — ⛽ Perlu Isi Bensin' : ''}</p>
                            <div className="flex gap-3">
                              {p.box_photo_url && (
                                <button type="button" onClick={() => openLightbox(p.box_photo_url!, 'Foto box kosong')} title="Foto Box Kosong" className="flex flex-col items-center gap-1">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={p.box_photo_url} alt="Foto box kosong" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                                  <span className="text-[10px] text-slate-500 font-medium">Box Kosong</span>
                                </button>
                              )}
                              {p.garage_photo_url && (
                                <button type="button" onClick={() => openLightbox(p.garage_photo_url!, 'Foto amper bensin')} title="Foto Amper Bensin" className="flex flex-col items-center gap-1">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={p.garage_photo_url} alt="Foto amper bensin" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                                  <span className="text-[10px] text-slate-500 font-medium">Amper Bensin</span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        {stores.map((s, i) => (
                          <div key={s.id} className="px-4 py-2.5 text-sm">
                            <div className="flex items-center gap-3">
                              <span className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 shrink-0">{i + 1}</span>
                              <span className="flex-1 text-slate-700">{s.logistics_stores?.name}</span>
                              {s.resolved_at && (
                                <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">
                                  🕐 {s.status === 'delivered' ? 'Terkirim jam ' : 'jam '}{fmtJam(s.resolved_at)}
                                </span>
                              )}
                              {s.status === 'failed' ? (
                                <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-600 font-medium">Gagal: {s.failed_reason}</span>
                              ) : s.status === 'pending' ? (
                                s.id === p.current_target_store_id ? (
                                  <span className="text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium animate-pulse">🚗 Sedang dalam perjalanan menuju toko ini</span>
                                ) : (
                                  <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">Belum Diproses</span>
                                )
                              ) : (
                                <>
                                  {s.payment_method && (
                                    <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                                      {PAYMENT_LABEL[s.payment_method]}{s.payment_amount ? ` — ${fmtRp(Number(s.payment_amount))}` : ''}{s.payment_due_date ? ` — jatuh tempo ${new Date(s.payment_due_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}` : ''}
                                    </span>
                                  )}
                                  {s.incident_type !== 'tidak_ada' && (
                                    <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                                      {s.incident_type === 'salah_muat' ? 'Salah Muat' : 'Retur'}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                            {s.incident_description && (
                              <p className="text-xs text-amber-600 mt-1 ml-8">{s.incident_description}</p>
                            )}
                            {((s.delivery_photo_urls && s.delivery_photo_urls.length > 0) || s.payment_photo_url || s.incident_photo_url) && (
                              <div className="flex gap-3 mt-2 ml-8 flex-wrap">
                                {s.delivery_photo_urls?.map((url, idx) => (
                                  <button key={idx} type="button" onClick={() => openLightbox(url, `Bukti kirim ${idx + 1}`)} title={`Bukti Kirim ${idx + 1}`} className="flex flex-col items-center gap-1">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt={`Bukti kirim ${idx + 1}`} className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                                    <span className="text-[10px] text-slate-500 font-medium">Bukti Kirim{s.delivery_photo_urls!.length > 1 ? ` ${idx + 1}` : ''}</span>
                                  </button>
                                ))}
                                {s.payment_photo_url && (
                                  <button type="button" onClick={() => openLightbox(s.payment_photo_url!, 'Bukti transfer')} title="Bukti Transfer" className="flex flex-col items-center gap-1">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={s.payment_photo_url} alt="Bukti transfer" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                                    <span className="text-[10px] text-slate-500 font-medium">Bukti Transfer</span>
                                  </button>
                                )}
                                {s.incident_photo_url && (
                                  <button type="button" onClick={() => openLightbox(s.incident_photo_url!, 'Foto kejadian')} title="Foto Kejadian" className="flex flex-col items-center gap-1">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={s.incident_photo_url} alt="Foto kejadian" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                                    <span className="text-[10px] text-slate-500 font-medium">Foto Kejadian</span>
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Validasi kas fisik — nominal yang ditulis driver belum tentu sama
                                dengan yang benar-benar diserahkan ke kantor. Berlaku untuk cash
                                DAN deposit (sama-sama uang tunai fisik, beda dari transfer yang
                                cuma bukti foto), cuma bisa diisi Owner/HR/Finance (canVerify). */}
                            {(s.payment_method === 'cash' || s.payment_method === 'deposit') && canVerify && (
                              <div className="mt-2 ml-8">
                                {verifyingId === s.id ? (
                                  <div className="flex items-center gap-2">
                                    <RupiahInput value={verifyAmount} onChange={setVerifyAmount}
                                      placeholder="Nominal diterima kantor"
                                      className="w-40 px-2 py-1 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none" />
                                    <button onClick={() => submitVerify(s.id)} disabled={verifySaving}
                                      className="px-2 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded transition disabled:opacity-50">
                                      {verifySaving ? 'Menyimpan...' : 'Simpan'}
                                    </button>
                                    <button onClick={() => setVerifyingId(null)} className="text-xs text-slate-500 hover:underline">Batal</button>
                                  </div>
                                ) : s.office_verified_amount != null ? (
                                  (() => {
                                    const selisih = Number(s.office_verified_amount) - Number(s.payment_amount || 0)
                                    return (
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                                          Diterima kantor: {fmtRp(Number(s.office_verified_amount))}
                                        </span>
                                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${selisih === 0 ? 'bg-green-100 text-green-700' : selisih < 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                                          {selisih === 0 ? '✓ Cocok' : selisih < 0 ? `Kurang ${fmtRp(Math.abs(selisih))}` : `Lebih ${fmtRp(selisih)}`}
                                        </span>
                                        <button onClick={() => openVerify(s)} className="text-xs text-blue-600 hover:underline">Ubah</button>
                                      </div>
                                    )
                                  })()
                                ) : (
                                  <button onClick={() => openVerify(s)}
                                    className="text-xs px-2.5 py-1 border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg font-medium transition">
                                    ⚠ Verifikasi Kas Diterima
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
