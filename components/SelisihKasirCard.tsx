'use client'

// Kartu "Selisih Kasir" di Dashboard Saya (Laporan Kasir Tahap 2, migrasi 097). Menampilkan
// selisih final laporan kasir yang SAYA tutup bulan ini (sudah diverifikasi finance) dan
// potongan gaji yang dihasilkan: max(0, minus − plus), plus hanya menutup minus.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { localDateStr } from '@/lib/date'
import { fmtRp } from '@/lib/cashierReport'

type Row = { id: string; report_date: string; shift: number; final_diff: number | null; status: string; posted: boolean }

export default function SelisihKasirCard({ employeeId }: { employeeId: string }) {
  const supabase = createClient()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [deduction, setDeduction] = useState(0)
  const [needFix, setNeedFix] = useState(0)

  useEffect(() => {
    let cancelled = false
    const now = new Date()
    const from = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1))
    const to = localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    Promise.all([
      supabase.from('cashier_reports').select('id, report_date, shift, final_diff, status, posted')
        .eq('reported_by', employeeId).gte('report_date', from).lte('report_date', to).order('report_date'),
      supabase.from('cashier_reports').select('id', { count: 'exact', head: true })
        .eq('reported_by', employeeId).eq('status', 'rejected'),
      supabase.from('cashier_loss_entries').select('amount')
        .eq('employee_id', employeeId).eq('period_month', now.getMonth() + 1).eq('period_year', now.getFullYear()),
    ]).then(([rep, rej, loss]) => {
      if (cancelled) return
      setRows((rep.data as Row[]) || [])
      setNeedFix(rej.count ?? 0)
      setDeduction(Math.max(0, ((loss.data as { amount: number }[]) || []).reduce((s, e) => s + Number(e.amount), 0)))
    })
    return () => { cancelled = true }
  }, [supabase, employeeId])

  if (rows === null) return null
  const verified = rows.filter(r => r.status === 'approved' && r.posted && r.final_diff != null)
  if (rows.length === 0 && needFix === 0 && deduction === 0) return null

  const minus = verified.filter(r => Number(r.final_diff) < 0).reduce((s, r) => s - Number(r.final_diff), 0)
  const plus = verified.filter(r => Number(r.final_diff) > 0).reduce((s, r) => s + Number(r.final_diff), 0)
  const waiting = rows.filter(r => r.status === 'pending' || r.status === 'revisi').length
  const monthLabel = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-800">🧾 Selisih Kasir — {monthLabel}</h3>
        <Link href="/laporan-kasir" className="text-xs text-blue-600 hover:underline">Laporan Kasir →</Link>
      </div>
      {needFix > 0 && (
        <p className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">⚠️ {needFix} laporan Anda ditolak finance — buka Laporan Kasir dan perbaiki.</p>
      )}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-red-50 rounded-lg p-2">
          <p className="text-[11px] text-slate-500">Minus</p>
          <p className="font-bold text-red-600 text-sm">{fmtRp(minus)}</p>
        </div>
        <div className="bg-green-50 rounded-lg p-2">
          <p className="text-[11px] text-slate-500">Plus</p>
          <p className="font-bold text-green-700 text-sm">{fmtRp(plus)}</p>
        </div>
        <div className="bg-slate-100 rounded-lg p-2">
          <p className="text-[11px] text-slate-500">Potongan gaji</p>
          <p className="font-bold text-slate-800 text-sm">{fmtRp(deduction)}</p>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        Dari {verified.length} laporan yang sudah diverifikasi finance{waiting > 0 ? ` (${waiting} masih menunggu)` : ''}. Plus hanya mengurangi minus — kelebihannya tidak dibayarkan. Potongan termasuk minus kas yang dicatat manual oleh kantor.
      </p>
    </div>
  )
}
