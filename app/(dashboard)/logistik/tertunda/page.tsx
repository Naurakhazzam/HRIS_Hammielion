'use client'

// Tab "Tertunda" (Tahap 4, migrasi 088): kiriman yang ditandai Kirim Besok dan belum terkirim.
//   * Kunjungan driver (barang gudang): tertutup otomatis begitu toko itu menerima kiriman
//     berikutnya, atau ditutup manual Owner/Kepala Gudang.
//   * Laporan Muat cabang: paketnya sudah kembali ke daftar Jemput Barang; tertutup otomatis saat
//     akhirnya terkirim, atau dibatalkan (= Gagal).
// Lewat 3 hari -> merah (Owner juga dapat angka peringatan di menu).

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { usePhotoLightbox } from '@/components/PhotoLightbox'

type NameRel = { full_name: string } | null
type Visit = {
  id: string
  failed_reason: string | null
  failed_photo_url: string | null
  resolved_at: string
  invoice_amount: number | null
  logistics_stores: { name: string; address: string | null; phone: string | null } | null
  plan: { plan_date: string; driver: NameRel } | null
}
type Loading = {
  id: string
  postponed_at: string
  postpone_count: number
  last_postpone_reason: string | null
  nota_amount: number | null
  logistics_stores: { name: string; address: string | null } | null
  origin: { name: string } | null
  packages: { count: number }[]
}

const LIMIT_MS = 3 * 24 * 3600 * 1000
const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID')
const fmtDT = (s: string) => new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
function age(s: string, now: number) {
  const h = Math.floor((now - new Date(s).getTime()) / 3600000)
  return h >= 24 ? `${Math.floor(h / 24)} hari ${h % 24} jam` : `${h} jam`
}

export default function TertundaPage() {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()
  const [access, setAccess] = useState<'none' | 'view' | 'manage' | null>(null)
  const [loading, setLoading] = useState(true)
  const [visits, setVisits] = useState<Visit[]>([])
  const [loadings, setLoadings] = useState<Loading[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [now] = useState(() => Date.now())

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setAccess('none'); return }
      const { data: u } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      let position = ''
      if (u?.employee_id) {
        const { data: emp } = await supabase.from('employees').select('positions(name)').eq('id', u.employee_id).single()
        const pos = emp?.positions as { name: string } | { name: string }[] | null | undefined
        position = (Array.isArray(pos) ? pos[0]?.name : pos?.name) ?? ''
      }
      if (u?.role === 'owner' || position === 'Kepala Gudang') setAccess('manage')
      else if (u?.role === 'hr' || u?.role === 'finance') setAccess('view')
      else setAccess('none')
    }
    init()
  }, [supabase])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [vRes, lRes] = await Promise.all([
      supabase.from('logistics_plan_stores')
        .select(`id, failed_reason, failed_photo_url, resolved_at, invoice_amount,
          logistics_stores(name, address, phone),
          plan:logistics_delivery_plans!logistics_plan_stores_plan_id_fkey(plan_date, driver:employees!logistics_delivery_plans_driver_id_fkey(full_name))`)
        .eq('fail_kind', 'kirim_besok').is('postpone_closed_at', null)
        .order('resolved_at', { ascending: true }),
      supabase.from('logistics_central_loadings')
        .select(`id, postponed_at, postpone_count, last_postpone_reason, nota_amount,
          logistics_stores(name, address),
          origin:branches!logistics_central_loadings_origin_branch_id_fkey(name),
          packages:logistics_central_loading_packages(count)`)
        .eq('status', 'selesai').not('postponed_at', 'is', null)
        .order('postponed_at', { ascending: true }),
    ])
    const err = vRes.error || lRes.error
    if (err) { showMessage('error', 'Gagal memuat: ' + err.message); setLoading(false); return }
    setVisits((vRes.data as unknown as Visit[]) || [])
    setLoadings((lRes.data as unknown as Loading[]) || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    async function run() { if (access === 'view' || access === 'manage') await fetchAll() }
    run()
  }, [access, fetchAll])

  async function closeVisit(v: Visit) {
    const note = window.prompt(`Tutup kiriman tertunda ke ${v.logistics_stores?.name}? Tulis keterangan (mis. sudah dikirim lewat trip lain / toko batal):`)
    if (note === null) return
    if (note.trim().length < 3) { showMessage('error', 'Keterangan wajib diisi (minimal 3 huruf).'); return }
    const { error } = await supabase.rpc('close_postponed_visit', { p_plan_store_id: v.id, p_note: note.trim() })
    if (error) { showMessage('error', error.message); return }
    showMessage('success', 'Kiriman tertunda ditutup.')
    window.dispatchEvent(new Event('kirim-barang-badge-refresh'))
    await fetchAll()
  }

  async function cancelLoading(l: Loading) {
    const reason = window.prompt(`Batalkan kiriman cabang ke ${l.logistics_stores?.name} (dianggap Gagal, tidak dikirim lagi)? Alasan:`)
    if (reason === null) return
    if (reason.trim().length < 3) { showMessage('error', 'Alasan wajib diisi (minimal 3 huruf).'); return }
    const { error } = await supabase.rpc('cancel_postponed_loading', { p_loading_id: l.id, p_reason: reason.trim() })
    if (error) { showMessage('error', error.message); return }
    showMessage('success', 'Kiriman cabang dibatalkan.')
    window.dispatchEvent(new Event('kirim-barang-badge-refresh'))
    await fetchAll()
  }

  if (access === null) return <div className="text-center py-12 text-slate-500">Memuat...</div>
  if (access === 'none') {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <p className="text-slate-600">Halaman Tertunda untuk Owner, Kepala Gudang, HR & Finance.</p>
      </div>
    )
  }

  const overdue = (s: string) => now - new Date(s).getTime() > LIMIT_MS
  const overdueCount = visits.filter(v => overdue(v.resolved_at)).length + loadings.filter(l => overdue(l.postponed_at)).length

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Kiriman Tertunda</h1>
        <p className="text-sm text-slate-500">Toko yang ditandai <b>Kirim Besok</b> oleh driver dan belum terkirim. Lewat 3 hari ditandai merah.</p>
      </div>

      {message && (
        <div className={`p-4 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {overdueCount > 0 && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 font-medium">
          ⚠️ {overdueCount} kiriman tertunda lebih dari 3 hari — segera jadwalkan ulang atau tutup.
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-slate-500 text-sm">Memuat...</div>
      ) : (
        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-slate-700">🚚 Barang Gudang ({visits.length})</h2>
              <Link href="/logistik/rencana" className="text-xs text-blue-600 hover:underline">Buat / ubah Rencana Pengiriman →</Link>
            </div>
            <p className="text-xs text-slate-500 mb-2">Masukkan toko ini ke Rencana Pengiriman berikutnya. Tertutup otomatis begitu toko menerima kiriman lagi.</p>
            {visits.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500">Tidak ada.</div>
            ) : visits.map(v => {
              const late = overdue(v.resolved_at)
              return (
                <div key={v.id} className={`bg-white rounded-xl border p-4 mb-2 ${late ? 'border-red-300' : 'border-slate-200'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-800">{v.logistics_stores?.name ?? '-'}</p>
                      {v.logistics_stores?.address && <p className="text-xs text-slate-500">{v.logistics_stores.address}</p>}
                      <p className="text-xs text-slate-500">Driver {v.plan?.driver?.full_name ?? '-'} · {fmtDT(v.resolved_at)}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-semibold ${late ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      ⏱ {age(v.resolved_at, now)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 mt-2">📅 {v.failed_reason ?? '-'}
                    {v.failed_photo_url && <> · <button onClick={() => openLightbox(v.failed_photo_url!, 'Foto toko')} className="text-blue-600 underline text-xs">foto</button></>}
                  </p>
                  {access === 'manage' && (
                    <button onClick={() => closeVisit(v)} className="mt-2 text-xs px-3 py-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50">
                      Tutup (sudah ditangani)
                    </button>
                  )}
                </div>
              )
            })}
          </section>

          <section>
            <h2 className="text-sm font-bold text-slate-700 mb-2">🏪 Barang Cabang / Laporan Muat ({loadings.length})</h2>
            <p className="text-xs text-slate-500 mb-2">Paketnya sudah kembali ke daftar Jemput Barang Cabang. Tertutup otomatis saat akhirnya terkirim.</p>
            {loadings.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500">Tidak ada.</div>
            ) : loadings.map(l => {
              const late = overdue(l.postponed_at)
              return (
                <div key={l.id} className={`bg-white rounded-xl border p-4 mb-2 ${late ? 'border-red-300' : 'border-slate-200'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-800">{l.logistics_stores?.name ?? '-'}</p>
                      <p className="text-xs text-slate-500">
                        Dari {l.origin?.name ?? '-'} · {l.packages?.[0]?.count ?? 0} paket
                        {l.nota_amount != null ? ` · nota ${fmtRp(l.nota_amount)}` : ''} · ditunda {l.postpone_count}×
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-semibold ${late ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      ⏱ {age(l.postponed_at, now)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 mt-2">📅 {l.last_postpone_reason ?? '-'}</p>
                  {access === 'manage' && (
                    <button onClick={() => cancelLoading(l)} className="mt-2 text-xs px-3 py-1.5 border border-red-300 text-red-700 rounded-lg bg-white hover:bg-red-50">
                      Batalkan kiriman (Gagal)
                    </button>
                  )}
                </div>
              )
            })}
          </section>
        </div>
      )}
    </div>
  )
}
