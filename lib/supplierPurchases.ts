// Perhitungan sisa utang supplier — dipakai bareng oleh halaman Pembelian & Utang Supplier
// dan mode "Bayar ke Supplier" di Input Kas Keluar, supaya rumusnya selalu sinkron.
// (Lihat histori bug: sebelum unrequested dihitung, tombol bayar bisa dipencet berkali-kali
// sebelum verifikasi dan menghasilkan pembayaran ganda yang lebih besar dari tagihan.)

export type SupplierPaymentRow = { source_id: string; amount: number; status: string }

export function paidApprovedFor(purchaseId: string, payments: SupplierPaymentRow[]) {
  return payments
    .filter(p => p.source_id === purchaseId && p.status === 'approved')
    .reduce((s, p) => s + Number(p.amount), 0)
}

export function paidPendingFor(purchaseId: string, payments: SupplierPaymentRow[]) {
  return payments
    .filter(p => p.source_id === purchaseId && p.status === 'pending')
    .reduce((s, p) => s + Number(p.amount), 0)
}

// Sisa utang sungguhan (yang sudah disetujui finance saja yang mengurangi)
export function remainingFor(totalAmount: number, purchaseId: string, payments: SupplierPaymentRow[]) {
  return Number(totalAmount) - paidApprovedFor(purchaseId, payments)
}

// Bagian yang belum diajukan sama sekali (belum ada di approved maupun pending)
// — inilah batas maksimal nominal yang boleh diajukan lewat "Bayar/Cicil"
export function unrequestedFor(totalAmount: number, purchaseId: string, payments: SupplierPaymentRow[]) {
  return Number(totalAmount) - paidApprovedFor(purchaseId, payments) - paidPendingFor(purchaseId, payments)
}
