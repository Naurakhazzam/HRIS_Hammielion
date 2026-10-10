import { createClient } from '@/lib/supabase/client'
import { resizeImage } from '@/lib/meeting'

type Supabase = ReturnType<typeof createClient>

// Laporan Kasir (settlement shift) -- lihat docs/RENCANA-LAPORAN-KASIR.md & migrasi 096.
export type CashierReportPayment = { id: string; method_label: string; amount: number; sort_order: number; account_id: string | null }
export type CashierReportExpense = { id: string; description: string; amount: number; sort_order: number }
export type CashierReport = {
  id: string
  branch_id: string
  branch_name: string
  report_date: string
  shift: number
  reported_by: string
  reporter_name: string
  photo_paths: string[]
  cash_amount: number
  piutang_amount: number
  cash_diff: number
  notes: string | null
  status: 'pending' | 'approved' | 'rejected' | 'revisi'
  rejection_reason: string | null
  verified_by: string | null
  verifier_name: string | null
  verified_at: string | null
  // Diisi finance saat verifikasi (migrasi 097).
  cash_received: number | null
  titipan_amount: number
  titipan_note: string | null
  titipan_store_id: string | null
  titipan_payment_id: string | null
  cash_account_id: string | null
  final_diff: number | null
  posted: boolean
  created_at: string
  updated_at: string
  payments: CashierReportPayment[]
  expenses: CashierReportExpense[]
}

export const CASHIER_REPORT_STATUS: Record<CashierReport['status'], { label: string; cls: string }> = {
  pending: { label: 'Menunggu Verifikasi', cls: 'bg-yellow-100 text-yellow-800' },
  revisi: { label: 'Sudah Diperbaiki', cls: 'bg-blue-100 text-blue-800' },
  approved: { label: 'Disetujui', cls: 'bg-green-100 text-green-800' },
  rejected: { label: 'Ditolak', cls: 'bg-red-100 text-red-800' },
}

// Saran nama metode non-tunai (kasir tetap boleh mengetik nama lain).
export const PAYMENT_METHOD_SUGGESTIONS = ['QRIS', 'Trf BCA', 'Trf Mandiri', 'Trf BRI', 'Debit', 'Kartu Kredit']

export const fmtRp = (v: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)

export function reportNonCashTotal(r: Pick<CashierReport, 'payments'>) {
  return r.payments.reduce((s, p) => s + Number(p.amount), 0)
}
export function reportExpenseTotal(r: Pick<CashierReport, 'expenses'>) {
  return r.expenses.reduce((s, e) => s + Number(e.amount), 0)
}
// Total omzet = Cash + Non-tunai + Piutang (sama dengan OMZET di struk settlement).
export function reportOmzet(r: Pick<CashierReport, 'cash_amount' | 'piutang_amount' | 'payments'>) {
  return Number(r.cash_amount) + Number(r.piutang_amount) + reportNonCashTotal(r)
}
// Uang cash yang harus disetor = Cash − Pengeluaran ± Selisih kasir.
export function reportCashToDeposit(r: Pick<CashierReport, 'cash_amount' | 'cash_diff' | 'expenses'>) {
  return Number(r.cash_amount) - reportExpenseTotal(r) + Number(r.cash_diff)
}

export async function uploadCashierReportPhotos(supabase: Supabase, branchId: string, files: File[]): Promise<string[]> {
  const paths: string[] = []
  for (const f of files) {
    const blob = await resizeImage(f, 2000)
    const path = `cashier_reports/${branchId}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`
    const { error } = await supabase.storage.from('documents').upload(path, blob, { contentType: blob.type || 'image/jpeg' })
    if (error) throw new Error('Gagal unggah foto: ' + error.message)
    paths.push(path)
  }
  return paths
}

export async function signCashierReportPhotos(supabase: Supabase, paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths))
  if (unique.length === 0) return {}
  const { data } = await supabase.storage.from('documents').createSignedUrls(unique, 3600)
  const map: Record<string, string> = {}
  ;(data || []).forEach(d => { if (d.path && d.signedUrl) map[d.path] = d.signedUrl })
  return map
}
