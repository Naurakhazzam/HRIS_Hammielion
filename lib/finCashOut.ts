// Aturan edit/hapus baris fin_cash_out — dipakai bareng oleh Kas Keluar ("10 Input Terakhir" /
// "Perlu Direvisi", cuma punya sendiri) dan Riwayat Kas Keluar (semua cabang/bulan, admin),
// supaya aturan siapa-boleh-apa tidak diam-diam beda antara dua halaman yang menyentuh tabel
// yang sama. Riwayat sempat ketinggalan saat pengecualian pembayaran supplier & alur revisi
// ditambahkan ke Kas Keluar — sekarang satu sumber kebenaran.

import type { createClient } from '@/lib/supabase/client'
import { unrequestedFor } from './supplierPurchases'

type SupabaseClient = ReturnType<typeof createClient>

export type CashOutEditable = { status: string; source_table: string | null }

// Entri otomatis (payroll/driver/kasbon/dll) tidak boleh diedit manual — kecuali pembayaran
// supplier, sengaja dibuka supaya nominal salah ketik (mis. kasus FRONTERA: tercatat Rp131jt
// padahal maksudnya Rp50jt) bisa diperbaiki dari sini, bukan lewat database.
export function canEditCashOut(r: CashOutEditable): boolean {
  if (r.status !== 'pending' && r.status !== 'rejected') return false
  if (r.source_table && r.source_table !== 'supplier_purchases') return false
  return true
}

// Beda dari canEditCashOut: hapus pembayaran supplier TIDAK diizinkan sama sekali (RLS
// fin_cash_out_delete_admin mensyaratkan source_table IS NULL) — supaya jejak pembayaran
// tidak bisa hilang, cuma bisa diperbaiki nominalnya.
export function canDeleteCashOut(r: CashOutEditable): boolean {
  if (r.status !== 'pending' && r.status !== 'rejected') return false
  if (r.source_table) return false
  return true
}

export type CashOutEditFields = {
  id: string
  branch_id: string
  transaction_date: string
  category: string
  amount: number
  description: string | null
  account_id: string
  originalStatus: string
  sourceTable: string | null
  sourceId: string | null
}

export async function saveCashOutEdit(
  supabase: SupabaseClient,
  f: CashOutEditFields,
  formatRupiah: (n: number) => string
): Promise<{ ok: true; wasRejected: boolean } | { ok: false; error: string }> {
  // Entri pembayaran supplier: nominal baru tidak boleh melebihi sisa utang yang bisa
  // diajukan (dicek ulang ke database saat ini, bukan pakai data lama di layar).
  if (f.sourceTable === 'supplier_purchases' && f.sourceId) {
    const [{ data: purchase }, { data: otherPayments }] = await Promise.all([
      supabase.from('supplier_purchases').select('total_amount').eq('id', f.sourceId).single(),
      supabase.from('fin_cash_out').select('source_id, amount, status').eq('source_table', 'supplier_purchases').eq('source_id', f.sourceId).neq('id', f.id),
    ])
    if (purchase) {
      const maxAllowed = unrequestedFor(purchase.total_amount, f.sourceId, otherPayments || [])
      if (f.amount > maxAllowed) {
        return { ok: false, error: `Nominal melebihi sisa utang yang bisa diajukan untuk tagihan ini (${formatRupiah(maxAllowed)}).` }
      }
    }
  }

  const wasRejected = f.originalStatus === 'rejected'
  const { error } = await supabase.from('fin_cash_out')
    .update({
      branch_id: f.branch_id,
      transaction_date: f.transaction_date,
      category: f.category,
      amount: f.amount,
      description: f.description,
      account_id: f.account_id,
      ...(wasRejected ? { status: 'revisi', rejection_reason: null, verified_by: null, verified_at: null } : {}),
    })
    .eq('id', f.id)

  if (error) return { ok: false, error: error.message }
  return { ok: true, wasRejected }
}
