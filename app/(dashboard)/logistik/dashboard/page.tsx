'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type ActivePlan = {
  id: string
  plan_date: string
  status: string
  vehicles: { name: string; plate_number: string | null } | null
  delivery_routes: { name: string } | null
  driver: { full_name: string } | null
  helper: { full_name: string } | null
}

type StoreCount = { total: number; delivered: number; failed: number; pending: number }

type RefuelPlan = {
  id: string
  plan_date: string
  refuel_amount: number | null
  vehicles: { name: string; plate_number: string | null } | null
}

const fmtRp = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ready: { label: 'Siap Berangkat', className: 'bg-slate-100 text-slate-600' },
  departed: { label: 'Sedang Jalan', className: 'bg-blue-100 text-blue-700' },
  closing: { label: 'Menuju Garasi', className: 'bg-purple-100 text-purple-700' },
}

const REFRESH_MS = 20000

export default function LogistikDashboardPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [garageGapActive, setGarageGapActive] = useState<boolean | null>(null)
  const [garageGapSaving, setGarageGapSaving] = useState(false)
  const [plans, setPlans] = useState<ActivePlan[]>([])
  const [counts, setCounts] = useState<Record<string, StoreCount>>({})
  const [refuelPlans, setRefuelPlans] = useState<RefuelPlan[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const fetchAll = useCallback(async () => {
    const { data: planData } = await supabase
      .from('logistics_delivery_plans')
      .select(`
        id, plan_date, status,
        vehicles(name, plate_number),
        delivery_routes(name),
        driver:employees!logistics_delivery_plans_driver_id_fkey(full_name),
        helper:employees!logistics_delivery_plans_helper_id_fkey(full_name)
      `)
      .in('status', ['ready', 'departed', 'closing'])
      .order('plan_date', { ascending: false })
    const activePlans = (planData as unknown as ActivePlan[]) || []
    setPlans(activePlans)

    if (activePlans.length > 0) {
      const { data: storeRows } = await supabase.from('logistics_plan_stores')
        .select('plan_id, status').in('plan_id', activePlans.map(p => p.id))
      const next: Record<string, StoreCount> = {}
      ;(storeRows || []).forEach((r: any) => {
        if (!next[r.plan_id]) next[r.plan_id] = { total: 0, delivered: 0, failed: 0, pending: 0 }
        next[r.plan_id].total++
        if (r.status === 'delivered') next[r.plan_id].delivered++
        else if (r.status === 'failed') next[r.plan_id].failed++
        else next[r.plan_id].pending++
      })
      setCounts(next)
    } else {
      setCounts({})
    }

    const { data: refuelData } = await supabase.from('logistics_delivery_plans')
      .select('id, plan_date, refuel_amount, vehicles(name, plate_number)')
      .eq('needs_refuel', true)
      .order('plan_date', { ascending: false })
      .limit(20)
    setRefuelPlans((refuelData as unknown as RefuelPlan[]) || [])
  }, [supabase])

  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: userData } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
        if (userData) {
          if (['owner', 'hr', 'finance'].includes(userData.role)) setCanManage(true)
          else if (userData.employee_id) {
            const { data: emp } = await supabase.from('employees').select('positions(name)').eq('id', userData.employee_id).single()
            setCanManage((emp as any)?.positions?.name === 'Kepala Gudang')
          }
          setIsOwner(userData.role === 'owner')
        }
      }
      const { data: settings } = await supabase.from('logistics_settings').select('garage_gap_active').eq('id', true).maybeSingle()
      setGarageGapActive(settings?.garage_gap_active ?? true)
      await fetchAll()
      setLoading(false)
    }
    init()
    const t = setInterval(fetchAll, REFRESH_MS)
    return () => clearInterval(t)
  }, [fetchAll, supabase])

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  async function dismissRefuel(id: string) {
    const { error } = await supabase.from('logistics_delivery_plans').update({ needs_refuel: false }).eq('id', id)
    if (error) showMessage('error', 'Gagal: ' + error.message)
    else fetchAll()
  }

  async function toggleGarageGap() {
    if (garageGapActive === null) return
    const next = !garageGapActive
    setGarageGapSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('logistics_settings')
      .update({ garage_gap_active: next, updated_by: user?.id, updated_at: new Date().toISOString() })
      .eq('id', true)
    if (error) showMessage('error', 'Gagal mengubah pengaturan: ' + error.message)
    else {
      setGarageGapActive(next)
      showMessage('success', next
        ? 'Pengaman 30 menit AKTIF — driver harus menunggu 30 menit sejak foto box kosong sebelum bisa lapor sampai garasi.'
        : 'Pengaman 30 menit DIMATIKAN — driver bisa langsung lapor sampai garasi tanpa jeda. Ingat nyalakan lagi setelah selesai testing.')
    }
    setGarageGapSaving(false)
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Dashboard Pengiriman</h1>
          <p className="text-sm text-slate-500">Progres pengiriman yang sedang berjalan hari ini. Halaman ini otomatis diperbarui tiap 20 detik.</p>
        </div>
        <Link href="/logistik/laporan" className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
          📋 Lihat Laporan
        </Link>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {isOwner && garageGapActive !== null && (
        <div className={`mb-6 rounded-xl border p-4 flex items-center justify-between gap-4 ${garageGapActive ? 'bg-white border-slate-200' : 'bg-amber-50 border-amber-300'}`}>
          <div>
            <p className="text-sm font-semibold text-slate-800">⏱️ Pengaman 30 Menit Lapor Garasi</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {garageGapActive
                ? 'Aktif — driver wajib menunggu 30 menit sejak foto box kosong sebelum bisa lapor sampai garasi (anti-kecurangan).'
                : '⚠ Nonaktif — driver bisa langsung lapor sampai garasi tanpa jeda. Cuma untuk keperluan testing, jangan lupa nyalakan lagi.'}
            </p>
          </div>
          <button onClick={toggleGarageGap} disabled={garageGapSaving}
            className={`shrink-0 relative w-14 h-8 rounded-full transition disabled:opacity-50 ${garageGapActive ? 'bg-green-600' : 'bg-slate-300'}`}
            aria-label="Toggle pengaman 30 menit">
            <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${garageGapActive ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>
      )}

      {!loading && !canManage && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-6">
          Halaman ini khusus tim manajemen (Owner/HR/Finance/Kepala Gudang).
        </div>
      )}

      {refuelPlans.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-bold text-amber-800 mb-2">⛽ Perlu Isi Bensin</p>
          <div className="space-y-1.5">
            {refuelPlans.map(p => (
              <div key={p.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-sm">
                <span className="text-slate-700">
                  {p.vehicles?.name} {p.vehicles?.plate_number ? `(${p.vehicles.plate_number})` : ''} — {new Date(p.plan_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                  {p.refuel_amount != null && <span className="font-semibold text-amber-700"> · {fmtRp(Number(p.refuel_amount))}</span>}
                </span>
                {canManage && (
                  <button onClick={() => dismissRefuel(p.id)} className="text-xs text-blue-600 hover:underline font-medium">Sudah Diisi</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm">Memuat...</div>
      ) : plans.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
          Tidak ada pengiriman yang sedang berjalan saat ini.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map(p => {
            const c = counts[p.id] || { total: 0, delivered: 0, failed: 0, pending: 0 }
            const pct = c.total > 0 ? Math.round(((c.delivered + c.failed) / c.total) * 100) : 0
            const cfg = STATUS_LABEL[p.status] ?? STATUS_LABEL.ready
            return (
              <div key={p.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-bold text-slate-800">{p.vehicles?.name}</p>
                    <p className="text-xs text-slate-500">{p.delivery_routes?.name}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold whitespace-nowrap ${cfg.className}`}>{cfg.label}</span>
                </div>
                <p className="text-xs text-slate-500 mb-3">{p.driver?.full_name}{p.helper?.full_name ? ` / ${p.helper.full_name}` : ''}</p>
                {c.total > 0 ? (
                  <>
                    <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
                      <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span className="text-green-600 font-medium">{c.delivered} Terkirim</span>
                      {c.failed > 0 && <span className="text-red-500 font-medium">{c.failed} Gagal</span>}
                      <span>{c.pending} Sisa</span>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-400">Belum ada toko / belum berangkat.</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
