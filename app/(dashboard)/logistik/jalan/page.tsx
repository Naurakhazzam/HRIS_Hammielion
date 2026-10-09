'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
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

// Jeda klik setelah tampilan tombol berganti -- lihat clickGuardKey.
const CLICK_GUARD_MS = 1000

const fmtRp = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

type PlanStore = {
  id: string
  store_id: string
  sequence_order: number
  status: string
  delivery_photo_urls: string[] | null
  payment_method: PaymentMethod | null
  invoice_amount: number | null
  payment_amount: number | null
  received_total: number | null
  payment_photo_url: string | null
  payment_due_date: string | null
  incident_type: 'tidak_ada' | 'salah_muat' | 'retur' | 'barang_lebih'
  incident_photo_url: string | null
  incident_description: string | null
  failed_reason: string | null
  fail_kind: 'kirim_besok' | 'gagal' | null
  failed_photo_url: string | null
  cut_total: number | null
  cut_status: 'menunggu' | 'disetujui' | 'ditolak' | null
  cut_decision_note: string | null
  cut_photo_url: string | null
  logistics_stores: { name: string; address: string | null; phone: string | null } | null
}

type PlanSupplierTask = {
  id: string
  route_id: string
  status: string
  notes: string | null
  proof_photo_url: string | null
  delivery_routes: { name: string } | null
}

// Beda dari PlanStore: tugas retur ditugaskan tim ke trip ini (migrasi 076), barangnya masih di
// toko konsumen -- baru dipegang fisik pas driver sampai di toko itu, dicatat satu-per-satu
// lewat logistics_store_return_items (lihat migration 058).
type PlanReturn = {
  id: string
  store_id: string
  status: 'diambil' | 'selesai'
  note: string | null
  final_photo_url: string | null
  final_location_note: string | null
  no_items_reason: string | null
  logistics_stores: { name: string; address: string | null } | null
}

type ReturnItem = {
  id: string
  return_id: string
  photo_url: string
  item_name: string
  reason: string
}

type ActionMode = null | 'kirim' | 'gagal'
type PaymentMethod = '' | 'cash' | 'transfer' | 'deposit' | 'tempo'

const PAYMENT_LABEL: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', deposit: 'Deposit (DP)', tempo: 'Tempo' }
const INCIDENT_LABEL: Record<string, string> = { tidak_ada: 'Tidak Ada', salah_muat: 'Salah Muat', retur: 'Retur', barang_lebih: 'Barang Lebih' }
// Label input "uang diterima" per metode -- tempo tidak punya (seluruh nota jadi piutang).
// Deposit = DP (bayar sebagian), sisanya otomatis jadi piutang lewat BalanceNote.
const RECEIVED_LABEL: Record<string, string> = { cash: 'Cash yang diterima', deposit: 'Uang DP / deposit yang diterima', transfer: 'Nominal yang ditransfer' }
const INCIDENT_TYPES = ['tidak_ada', 'salah_muat', 'retur', 'barang_lebih'] as const
type IncidentType = typeof INCIDENT_TYPES[number]

// Nota cabang (Laporan Muat) yang paketnya dibawa ke kunjungan toko ini -- nominalnya sudah
// diisi cabang, driver tidak mengetik ulang (migrasi 082/083).
type BranchNota = { loading_id: string; amount: number; origin: string }
// Surat jalan gudang yang dibawa kunjungan (dicatat kantor, migrasi 090).
type SjNote = { id: string; plan_store_id: string; note_number: string | null; amount: number; notes: string | null }

// Nota Gudang wajib, kecuali kunjungan ini cuma membawa nota cabang (driver centang "tidak ada
// barang gudang"). Uang diterima wajib diketik untuk cash/deposit/transfer -- satu angka untuk
// SEMUA nota, server yang membagi (nota terbesar dulu). Tempo selalu diterima 0.
function isPaymentValid(method: PaymentMethod, invoice: string, received: string, noGudang: boolean, branchCount: number) {
  if (!method) return false
  if (noGudang ? branchCount === 0 : !(Number(invoice) > 0)) return false
  return method === 'tempo' || Number(received) > 0
}

function receivedFor(method: PaymentMethod, received: string): number | null {
  if (!method) return null
  return method === 'tempo' ? 0 : Number(received)
}

// Selisih nota vs uang diterima -- dasar pencatatan hutang-piutang konsumen.
// Total semua nota kunjungan (Nota Gudang + nota cabang) -- dasar Kurang/Lebih bayar.
const visitNotaTotal = (invoice: string, noGudang: boolean, notas: BranchNota[]) =>
  (noGudang ? 0 : Number(invoice) || 0) + notas.reduce((s, n) => s + n.amount, 0)

const receivedLabel = (method: string, notas: BranchNota[]) =>
  notas.length > 0 ? `${RECEIVED_LABEL[method]} — total untuk semua nota` : RECEIVED_LABEL[method]

// Nota kunjungan: Nota Gudang diketik driver, nota cabang sudah terisi dari Laporan Muat.
function NotaInputs({ notas, noGudang, onNoGudang, invoice, onInvoice, sj = [] }: {
  notas: BranchNota[]; noGudang: boolean; onNoGudang: (v: boolean) => void; invoice: string; onInvoice: (v: string) => void
  sj?: SjNote[]
}) {
  const hasBranch = notas.length > 0
  // Kunjungan dari surat jalan (migrasi 090): Nota Gudang sudah diisi kantor, driver tidak mengetik.
  if (sj.length > 0) {
    return (
      <div className="mb-3 space-y-2">
        {sj.map(n => (
          <div key={n.id} className="flex items-center justify-between text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <span className="text-slate-700">📄 Nota Gudang{n.note_number ? ` ${n.note_number}` : ''}{n.notes ? ` · ${n.notes}` : ''}</span>
            <b className="text-slate-800">{fmtRp(Number(n.amount))}</b>
          </div>
        ))}
        {notas.map(n => (
          <div key={n.loading_id} className="flex items-center justify-between text-sm bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <span className="text-emerald-800">🧾 Nota {n.origin}</span>
            <b className="text-emerald-800">{fmtRp(n.amount)}</b>
          </div>
        ))}
        <p className="text-sm font-semibold text-slate-700">Total semua nota: {fmtRp(visitNotaTotal(invoice, false, notas))}</p>
      </div>
    )
  }
  return (
    <div className="mb-3 space-y-2">
      {!noGudang && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">{hasBranch ? 'Nota Gudang (Rp) *' : 'Nominal Sesuai Nota (Rp) *'}</label>
          <RupiahInput value={invoice} onChange={onInvoice} placeholder="Total di nota"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
      )}
      {hasBranch && (
        <>
          {notas.map(n => (
            <div key={n.loading_id} className="flex items-center justify-between text-sm bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <span className="text-emerald-800">🧾 Nota {n.origin}</span>
              <b className="text-emerald-800">{fmtRp(n.amount)}</b>
            </div>
          ))}
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={noGudang} onChange={e => onNoGudang(e.target.checked)} />
            Tidak ada barang gudang untuk toko ini
          </label>
          <p className="text-sm font-semibold text-slate-700">Total semua nota: {fmtRp(visitNotaTotal(invoice, noGudang, notas))}</p>
        </>
      )}
    </div>
  )
}

function BalanceNote({ invoice, received }: { invoice: number; received: number }) {
  if (!(invoice > 0)) return null
  const diff = invoice - received
  return (
    <p className={`text-xs rounded-lg px-3 py-2 border ${diff > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : diff < 0 ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-green-50 border-green-200 text-green-700'}`}>
      {diff > 0 ? `Sisa piutang konsumen: ${fmtRp(diff)}` : diff < 0 ? `Lebih bayar (jadi saldo konsumen): ${fmtRp(-diff)}` : 'Lunas sesuai nota.'}
    </p>
  )
}

// Potong nota (migrasi 092): nota dikurangi karena barang salah/rusak/kurang. Driver cuma
// menyebut barang & nominal; server membagi potongan ke nota terbesar dulu. Perlu disetujui
// Finance/Owner -- selama belum disetujui (atau ditolak) tetap dihitung kurang bayar.
type CutReason = 'salah_muat' | 'rusak' | 'kurang_jumlah' | 'harga_beda' | 'lainnya'
type CutGoods = 'dibawa_kembali' | 'tidak_ada'
type CutItem = { item_name: string; amount: string; reason: CutReason | ''; goods: CutGoods | '' }
type SavedCut = { id: string; plan_store_id: string; item_name: string; amount: number; reason: CutReason; goods: CutGoods }
const CUT_REASON_LABEL: Record<CutReason, string> = {
  salah_muat: 'Salah muat', rusak: 'Rusak / kedaluwarsa', kurang_jumlah: 'Kurang jumlah', harga_beda: 'Harga beda', lainnya: 'Lainnya',
}
const CUT_STATUS_LABEL: Record<string, string> = { menunggu: 'menunggu persetujuan Finance', disetujui: 'disetujui', ditolak: 'ditolak' }
const emptyCut = (): CutItem => ({ item_name: '', amount: '', reason: '', goods: '' })
const cutTotalOf = (items: CutItem[]) => items.reduce((s, i) => s + (Number(i.amount) || 0), 0)
const cutItemsValid = (items: CutItem[]) =>
  items.length > 0 && items.every(i => i.item_name.trim() && Number(i.amount) > 0 && i.reason && i.goods)
const cutPayload = (items: CutItem[]) =>
  items.map(i => ({ item_name: i.item_name.trim(), amount: Number(i.amount), reason: i.reason, goods: i.goods }))

function CutItemsEditor({ items, onChange }: { items: CutItem[]; onChange: (v: CutItem[]) => void }) {
  const set = (idx: number, patch: Partial<CutItem>) => onChange(items.map((it, i) => i === idx ? { ...it, ...patch } : it))
  return (
    <div className="space-y-2">
      {items.map((it, idx) => (
        <div key={idx} className="border border-rose-200 bg-rose-50/50 rounded-lg p-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-800">Barang {idx + 1}</span>
            {items.length > 1 && (
              <button type="button" onClick={() => onChange(items.filter((_, i) => i !== idx))} className="text-xs text-red-600 hover:underline">Hapus</button>
            )}
          </div>
          <input value={it.item_name} onChange={e => set(idx, { item_name: e.target.value })} placeholder="Nama produk"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          <RupiahInput value={it.amount} onChange={v => set(idx, { amount: v })} placeholder="Nominal potongan (Rp)"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          <select value={it.reason} onChange={e => set(idx, { reason: e.target.value as CutReason })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="">— Alasan potongan —</option>
            {(Object.keys(CUT_REASON_LABEL) as CutReason[]).map(r => <option key={r} value={r}>{CUT_REASON_LABEL[r]}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => set(idx, { goods: 'dibawa_kembali' })}
              className={`px-2 py-2 rounded-lg text-xs border text-left ${it.goods === 'dibawa_kembali' ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-300'}`}>
              <b>↩️ Dibawa kembali</b><span className="block opacity-80">Barangnya ikut driver ke gudang</span>
            </button>
            <button type="button" onClick={() => set(idx, { goods: 'tidak_ada' })}
              className={`px-2 py-2 rounded-lg text-xs border text-left ${it.goods === 'tidak_ada' ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-300'}`}>
              <b>🚫 Memang tidak ada</b><span className="block opacity-80">Mis. pesan 10, terkirim 9</span>
            </button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, emptyCut()])} className="text-xs text-blue-600 hover:underline font-medium">+ Tambah barang</button>
      <p className="text-sm font-semibold text-rose-800">Total potongan: {fmtRp(cutTotalOf(items))}</p>
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = {
  ready:'Siap Berangkat', departed: 'Sedang Jalan', closing: 'Menuju Garasi',
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
  const [supplierTasks, setSupplierTasks] = useState<PlanSupplierTask[]>([])
  const [selectedSupplierTaskId, setSelectedSupplierTaskId] = useState<string | null>(null)
  const [supplierTaskSubmitting, setSupplierTaskSubmitting] = useState(false)

  // Tugas Retur -- status 'diambil' = masih boleh ditambah barang (satu-per-satu) di layar
  // Jalankan Pengiriman; baru 'selesai' setelah driver lapor posisi akhir di Lapor Sampai Garasi.
  const [planReturns, setPlanReturns] = useState<PlanReturn[]>([])
  const [returnItemsByReturn, setReturnItemsByReturn] = useState<Record<string, ReturnItem[]>>({})
  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null)
  const [addingNewReturnItem, setAddingNewReturnItem] = useState(false)
  const [newItemPhotoUrl, setNewItemPhotoUrl] = useState('')
  const [newItemName, setNewItemName] = useState('')
  const [newItemReason, setNewItemReason] = useState('')
  const [returnItemSubmitting, setReturnItemSubmitting] = useState(false)
  const [deletingReturnItemId, setDeletingReturnItemId] = useState<string | null>(null)
  // "Toko tidak ada barang retur" -- foto toko + keterangan, retur langsung ditutup tanpa barang.
  const [reportingEmptyReturn, setReportingEmptyReturn] = useState(false)
  const [emptyReturnPhotoUrl, setEmptyReturnPhotoUrl] = useState('')
  const [emptyReturnReason, setEmptyReturnReason] = useState('')
  const [emptyReturnSubmitting, setEmptyReturnSubmitting] = useState(false)
  // Lapor posisi akhir barang (Lapor Sampai Garasi) -- per-retur karena 1 plan bisa punya lebih
  // dari 1 tugas retur aktif sekaligus (toko berbeda-beda).
  const [closingReturnPhotos, setClosingReturnPhotos] = useState<Record<string, string>>({})
  const [closingReturnNotes, setClosingReturnNotes] = useState<Record<string, string>>({})
  const [finishingReturnId, setFinishingReturnId] = useState<string | null>(null)
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
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentPhotoUrl, setPaymentPhotoUrl] = useState('')
  const [paymentDueDate, setPaymentDueDate] = useState('')
  // Kunjungan yang cuma membawa nota cabang (tidak ada barang gudang) -- Nota Gudang dikosongkan.
  const [noGudang, setNoGudang] = useState(false)
  const [branchNotas, setBranchNotas] = useState<Record<string, BranchNota[]>>({})
  const [visitSj, setVisitSj] = useState<Record<string, SjNote[]>>({})
  const [incidentType, setIncidentType] = useState<'tidak_ada' | 'salah_muat' | 'retur' | 'barang_lebih'>('tidak_ada')
  const [incidentPhotoUrl, setIncidentPhotoUrl] = useState('')
  const [incidentDescription, setIncidentDescription] = useState('')
  const [cutYes, setCutYes] = useState(false)
  const [cutItems, setCutItems] = useState<CutItem[]>([emptyCut()])
  const [cutPhotoUrl, setCutPhotoUrl] = useState('')
  const [visitCuts, setVisitCuts] = useState<Record<string, SavedCut[]>>({})

  // Form Gagal Kirim: Kirim Besok (toko tutup, barang kembali & dijadwalkan lagi) atau Gagal
  // (ditolak / batal pesan) -- wajib alasan + foto (migrasi 088).
  const [failedReason, setFailedReason] = useState('')
  const [failKind, setFailKind] = useState<'kirim_besok' | 'gagal' | ''>('')
  const [failedPhotoUrl, setFailedPhotoUrl] = useState('')

  // Edit nominal/metode bayar toko yang SUDAH terkirim — untuk perbaiki salah ketik tanpa
  // perlu ulang seluruh alur foto. Cuma boleh selama trip belum "Selesai Kirim" (completed).
  const [editHistoryStore, setEditHistoryStore] = useState<PlanStore | null>(null)
  // Tambah foto susulan ke toko yang SUDAH Terkirim -- driver kadang baru sadar ada foto yang
  // kelupaan padahal masih di lokasi toko itu. Beda dari editHistoryStore (cuma ganti data
  // pembayaran) -- ini nambah ke delivery_photo_urls, tidak menghapus/mengganti yang lama. RLS
  // sudah mengizinkan driver/kenek update baris tokonya sendiri terlepas dari status, jadi ini
  // murni nambah pintu di tampilan, bukan perubahan izin.
  const [addPhotoStore, setAddPhotoStore] = useState<PlanStore | null>(null)
  const [addPhotoSaving, setAddPhotoSaving] = useState(false)
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>('')
  const [editInvoiceAmount, setEditInvoiceAmount] = useState('')
  const [editPaymentAmount, setEditPaymentAmount] = useState('')
  const [editPaymentDueDate, setEditPaymentDueDate] = useState('')
  const [editNoGudang, setEditNoGudang] = useState(false)
  // Kejadian juga bisa dikoreksi dari Riwayat Toko -- kasus nyata: driver lupa isi kejadian
  // (atau kepencet "Pengiriman Selesai" karena double-tap) padahal ada retur/salah muat.
  const [editIncidentType, setEditIncidentType] = useState<IncidentType>('tidak_ada')
  const [editIncidentPhotoUrl, setEditIncidentPhotoUrl] = useState('')
  const [editIncidentDescription, setEditIncidentDescription] = useState('')
  const [editCutYes, setEditCutYes] = useState(false)
  const [editCutItems, setEditCutItems] = useState<CutItem[]>([emptyCut()])
  const [editCutPhotoUrl, setEditCutPhotoUrl] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Jeda klik: tiap kali layar/langkah berganti, tombol dikunci sebentar. Laporan driver:
  // double-tap di "Ya, Lanjut" ikut menekan "Pengiriman Selesai" di langkah berikutnya (posisi
  // tombolnya sejajar), jadi toko langsung selesai tanpa sempat isi kejadian.
  const [unlockedGuardKey, setUnlockedGuardKey] = useState('')
  // Ref (bukan state) supaya tap kedua yang datang sebelum re-render tetap tertahan.
  const submitLockRef = useRef(false)

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
  const [refuelAmount, setRefuelAmount] = useState('')
  const [nowTick, setNowTick] = useState(Date.now())
  const [garageGapMinutes, setGarageGapMinutes] = useState(GARAGE_GAP_MINUTES_DEFAULT)

  // Pengingat "Jemput Toko Pusat" -- muncul otomatis begitu driver buka rencana yang Siap
  // Berangkat DAN ada paket titipan Toko Pusat yang masih menunggu diambil (siapa pun tokonya,
  // bukan cuma yang kebetulan sudah ada di rencana ini -- lihat diskusi fitur: toko tujuannya
  // bisa saja cuma ada di Toko Pusat, tidak ada di rencana Gudang sama sekali). Sifatnya
  // pengingat (bisa ditutup), bukan penghalang -- ada tab permanen "Jemput Toko Pusat" buat
  // jaga-jaga kalau pop-up ini kelewat/ke-close tidak sengaja.
  // Laporan Muat cabang ke toko di trip ini yang belum ditandai Selesai -- paketnya belum bisa
  // diambil di sistem (kasus Yulia Poultry 9 Okt). Pengingat, bukan penghalang (migrasi 091).
  const [unfinishedLoadings, setUnfinishedLoadings] = useState<{ loading_id: string; store_name: string; origin_name: string; package_count: number }[]>([])
  const [showCentralReminder, setShowCentralReminder] = useState(false)
  const [centralPendingCount, setCentralPendingCount] = useState(0)
  const [reminderDismissedFor, setReminderDismissedFor] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])

  const selectedPlan = plans.find(p => p.id === selectedPlanId) || null
  const pendingStores = planStores.filter(ps => ps.status === 'pending').sort((a, b) => a.sequence_order - b.sequence_order)
  const selectedStore = pendingStores.find(ps => ps.id === selectedStoreId) || null
  const selectedNotas = selectedStore ? (branchNotas[selectedStore.id] ?? []) : []
  const editNotas = editHistoryStore ? (branchNotas[editHistoryStore.id] ?? []) : []
  const pendingSupplierTasks = supplierTasks.filter(t => t.status === 'pending')
  const selectedSupplierTask = pendingSupplierTasks.find(t => t.id === selectedSupplierTaskId) || null
  // Belum 'selesai' = masih boleh ditambah barang & masih wajib dilaporkan posisi akhirnya di
  // Lapor Sampai Garasi -- sengaja TIDAK ikut hitungan allResolved (lihat catatan di migration
  // 058: proses ambil retur jalan independen dari toko/belanja, baru jadi syarat wajib di
  // tahap penutupan trip, bareng foto amper bensin).
  const activeReturns = planReturns.filter(r => r.status === 'diambil')
  const selectedReturn = activeReturns.find(r => r.id === selectedReturnId) || null
  // planReturns ikut dihitung sbg "ada tugas" -- trip yang isinya cuma ambil retur (tanpa toko
  // kirim/belanja) tetap harus bisa lanjut ke foto box & Lapor Sampai Garasi.
  const allResolved = (planStores.length > 0 || supplierTasks.length > 0 || planReturns.length > 0) && pendingStores.length === 0 && pendingSupplierTasks.length === 0
  const returnsWithoutItems = activeReturns.filter(r => (returnItemsByReturn[r.id]?.length || 0) === 0)

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedPlanId) { fetchPlanStores(selectedPlanId); fetchSupplierTasks(selectedPlanId); fetchPlanReturns(selectedPlanId) }
  }, [selectedPlanId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function checkCentralPending() {
      if (!selectedPlan || selectedPlan.status !== 'ready') { setShowCentralReminder(false); return }
      const { count } = await supabase
        .from('logistics_central_loading_packages')
        .select('id, logistics_central_loadings!inner(status)', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('logistics_central_loadings.status', 'selesai')
        .eq('logistics_central_loadings.delivery_method', 'driver')
      const n = count || 0
      setCentralPendingCount(n)
      if (n > 0 && reminderDismissedFor !== selectedPlan.id) setShowCentralReminder(true)
    }
    checkCentralPending()
  }, [selectedPlanId, selectedPlan?.status]) // eslint-disable-line react-hooks/exhaustive-deps

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
        payment_method, invoice_amount, payment_amount, received_total, payment_photo_url, payment_due_date,
        incident_type, incident_photo_url, incident_description, failed_reason, fail_kind, failed_photo_url,
        cut_total, cut_status, cut_decision_note, cut_photo_url,
        logistics_stores(name, address, phone)`)
      .eq('plan_id', planId).order('sequence_order')
    const rows = (data as unknown as PlanStore[]) || []
    setPlanStores(rows)

    // Nota cabang per kunjungan: dari paket Laporan Muat yang diambil ke kunjungan itu.
    const map: Record<string, BranchNota[]> = {}
    if (rows.length > 0) {
      const { data: pkgs } = await supabase.from('logistics_central_loading_packages')
        .select('plan_store_id, loading_id, logistics_central_loadings(nota_amount, nota_payment_method, nota_plan_store_id, origin:branches!logistics_central_loadings_origin_branch_id_fkey(name))')
        .in('plan_store_id', rows.map(r => r.id)).eq('status', 'diambil')
      type PkgRow = { plan_store_id: string; loading_id: string; logistics_central_loadings: { nota_amount: number | null; nota_payment_method: string | null; nota_plan_store_id: string | null; origin: { name: string } | null } | null }
      for (const p of (pkgs as unknown as PkgRow[]) || []) {
        const l = p.logistics_central_loadings
        const amount = l?.nota_amount
        if (amount == null) continue
        // Nota yang sudah ditagih di kunjungan/driver lain tidak ditagih lagi (migrasi 085).
        if (l?.nota_payment_method && l.nota_plan_store_id !== p.plan_store_id) continue
        const list = map[p.plan_store_id] ??= []
        if (!list.some(n => n.loading_id === p.loading_id)) {
          list.push({ loading_id: p.loading_id, amount: Number(amount), origin: p.logistics_central_loadings?.origin?.name ?? 'Cabang' })
        }
      }
    }
    setBranchNotas(map)

    const sjMap: Record<string, SjNote[]> = {}
    if (rows.length > 0) {
      const { data: sjData } = await supabase.from('logistics_delivery_notes')
        .select('id, plan_store_id, note_number, amount, notes').in('plan_store_id', rows.map(r => r.id)).order('created_at')
      for (const n of (sjData as SjNote[]) || []) (sjMap[n.plan_store_id] ??= []).push(n)
    }
    setVisitSj(sjMap)

    const cutMap: Record<string, SavedCut[]> = {}
    const cutIds = rows.filter(r => Number(r.cut_total) > 0).map(r => r.id)
    if (cutIds.length > 0) {
      const { data: cutData } = await supabase.from('logistics_visit_cuts')
        .select('id, plan_store_id, item_name, amount, reason, goods').in('plan_store_id', cutIds).order('created_at')
      for (const c of (cutData as SavedCut[]) || []) (cutMap[c.plan_store_id] ??= []).push(c)
    }
    setVisitCuts(cutMap)

    const { data: unf } = await supabase.rpc('get_unfinished_loadings_for_plan', { p_plan_id: planId })
    setUnfinishedLoadings((unf as { loading_id: string; store_name: string; origin_name: string; package_count: number }[]) || [])
  }

  async function fetchSupplierTasks(planId: string) {
    const { data } = await supabase.from('logistics_plan_supplier_tasks')
      .select('id, route_id, status, notes, proof_photo_url, delivery_routes(name)')
      .eq('plan_id', planId).order('created_at')
    setSupplierTasks((data as unknown as PlanSupplierTask[]) || [])
  }

  async function fetchPlanReturns(planId: string) {
    const { data } = await supabase.from('logistics_store_returns')
      .select('id, store_id, status, note, final_photo_url, final_location_note, no_items_reason, logistics_stores(name, address)')
      .eq('plan_id', planId).order('claimed_at')
    const returns = (data as unknown as PlanReturn[]) || []
    setPlanReturns(returns)
    if (returns.length === 0) { setReturnItemsByReturn({}); return }
    const { data: items } = await supabase.from('logistics_store_return_items')
      .select('id, return_id, photo_url, item_name, reason')
      .in('return_id', returns.map(r => r.id)).order('captured_at')
    const grouped: Record<string, ReturnItem[]> = {}
    ;(items as ReturnItem[] || []).forEach(it => {
      if (!grouped[it.return_id]) grouped[it.return_id] = []
      grouped[it.return_id].push(it)
    })
    setReturnItemsByReturn(grouped)
  }

  async function refresh() {
    if (myEmployeeId) await fetchPlans(myEmployeeId)
    if (selectedPlanId) { await fetchPlanStores(selectedPlanId); await fetchSupplierTasks(selectedPlanId); await fetchPlanReturns(selectedPlanId) }
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
    setInvoiceAmount(store?.invoice_amount != null ? String(store.invoice_amount) : '')
    setPaymentAmount(store?.received_total != null ? String(store.received_total) : store?.payment_amount != null ? String(store.payment_amount) : '')
    setPaymentPhotoUrl(store?.payment_photo_url || ''); setPaymentDueDate(store?.payment_due_date || '')
    setNoGudang(false)
    setIncidentType(store?.incident_type || 'tidak_ada')
    setIncidentPhotoUrl(store?.incident_photo_url || ''); setIncidentDescription(store?.incident_description || '')
    setCutYes(false); setCutItems([emptyCut()]); setCutPhotoUrl(store?.cut_photo_url || '')
  }

  function openAction(mode: ActionMode) {
    resetKirimForm(mode === 'kirim' ? selectedStore : null)
    setFailedReason(''); setFailKind(''); setFailedPhotoUrl('')
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
  async function persistStorePhotoField(field: 'delivery_photo_urls' | 'payment_photo_url' | 'incident_photo_url' | 'cut_photo_url', value: string[] | string | null) {
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

  // Sama seperti uploadPhoto di atas, tapi untuk toko yang sudah Terkirim (bukan selectedStore
  // yang lagi diproses) -- dipakai oleh form "+ Foto" di Riwayat Toko.
  async function uploadHistoryPhoto(storeId: string, blob: Blob): Promise<string | null> {
    if (!selectedPlan) return null
    const path = `${selectedPlan.id}/${storeId}-tambahan-${Date.now()}.jpg`
    const { error } = await supabase.storage.from('logistics-photos').upload(path, blob, { contentType: 'image/jpeg' })
    if (error) { showMessage('error', 'Gagal unggah foto: ' + error.message); return null }
    const { data } = supabase.storage.from('logistics-photos').getPublicUrl(path)
    return data.publicUrl
  }

  function openAddHistoryPhoto(ps: PlanStore) {
    setAddPhotoStore(ps)
  }

  async function handleAddHistoryPhoto(blob: Blob) {
    if (!addPhotoStore) return
    const url = await uploadHistoryPhoto(addPhotoStore.id, blob)
    if (!url) return
    const updated = [...(addPhotoStore.delivery_photo_urls || []), url]
    setAddPhotoSaving(true)
    const { error } = await supabase.from('logistics_plan_stores').update({ delivery_photo_urls: updated }).eq('id', addPhotoStore.id)
    setAddPhotoSaving(false)
    if (error) { showMessage('error', 'Foto sudah diunggah tapi gagal disimpan: ' + error.message); return }
    setAddPhotoStore({ ...addPhotoStore, delivery_photo_urls: updated })
    setPlanStores(prev => prev.map(p => p.id === addPhotoStore.id ? { ...p, delivery_photo_urls: updated } : p))
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

  // Tugas Belanja Supplier langsung ditandai selesai begitu foto surat jalan/nota berhasil
  // diunggah -- tidak ada langkah "konfirmasi" terpisah, supaya tidak ada state belum-tersimpan
  // yang bisa hilang kalau tidak sengaja pencet tombol kembali (sama seperti alasan foto Bukti
  // Kirim langsung tersimpan begitu diambil). Upah ritase-nya juga otomatis tercatat lewat RPC
  // ini (rate lookup by kendaraan + rute Belanja, sama persis polanya dengan penyelesaian trip
  // pengiriman biasa) -- bukan diinput manual lagi lewat Catat Trip Harian.
  async function submitSupplierTaskDone(task: PlanSupplierTask, photoUrl: string) {
    setSupplierTaskSubmitting(true)
    const { data, error } = await supabase.rpc('complete_supplier_task', { p_task_id: task.id, p_proof_photo_url: photoUrl })
    if (error) { showMessage('error', 'Gagal menyimpan: ' + error.message); setSupplierTaskSubmitting(false); return }
    const row = Array.isArray(data) ? data[0] : data
    const myShare = myEmployeeId === selectedPlan?.driver_id ? row?.driver_earning : row?.helper_earning
    showMessage('success', `Belanja "${task.delivery_routes?.name}" selesai dicatat. Upah ritase Anda sebesar ${fmtRp(Number(myShare ?? 0))} sudah tercatat.`)
    setSelectedSupplierTaskId(null)
    await refresh()
    setSupplierTaskSubmitting(false)
  }

  function resetReturnForms() {
    setAddingNewReturnItem(false)
    setNewItemPhotoUrl(''); setNewItemName(''); setNewItemReason('')
    setReportingEmptyReturn(false)
    setEmptyReturnPhotoUrl(''); setEmptyReturnReason('')
  }

  function openReturnTask(id: string) {
    setSelectedStoreId(null)
    setSelectedSupplierTaskId(null)
    setSelectedReturnId(id)
    resetReturnForms()
  }

  function clearReturnSelection() {
    setSelectedReturnId(null)
    resetReturnForms()
  }

  async function deleteReturnItem(it: ReturnItem) {
    if (!confirm(`Hapus barang "${it.item_name}"?`)) return
    setDeletingReturnItemId(it.id)
    const { error } = await supabase.rpc('delete_store_return_item', { p_item_id: it.id })
    setDeletingReturnItemId(null)
    if (error) { showMessage('error', 'Gagal menghapus barang: ' + error.message); return }
    showMessage('success', `Barang "${it.item_name}" dihapus.`)
    if (selectedPlanId) await fetchPlanReturns(selectedPlanId)
  }

  async function submitEmptyReturn() {
    if (!selectedReturn || !emptyReturnPhotoUrl || !emptyReturnReason.trim()) return
    setEmptyReturnSubmitting(true)
    const { error } = await supabase.rpc('finish_store_return_empty', {
      p_return_id: selectedReturn.id, p_photo_url: emptyReturnPhotoUrl, p_reason: emptyReturnReason.trim(),
    })
    setEmptyReturnSubmitting(false)
    if (error) { showMessage('error', 'Gagal menyimpan: ' + error.message); return }
    showMessage('success', `Retur "${selectedReturn.logistics_stores?.name}" selesai — toko tidak ada barang retur.`)
    clearReturnSelection()
    if (selectedPlanId) await fetchPlanReturns(selectedPlanId)
  }

  async function submitNewReturnItem() {
    if (!selectedReturn || !newItemPhotoUrl || !newItemName.trim() || !newItemReason.trim()) return
    setReturnItemSubmitting(true)
    const { error } = await supabase.rpc('add_store_return_item', {
      p_return_id: selectedReturn.id, p_photo_url: newItemPhotoUrl, p_item_name: newItemName.trim(), p_reason: newItemReason.trim(),
    })
    if (error) { showMessage('error', 'Gagal menyimpan barang: ' + error.message); setReturnItemSubmitting(false); return }
    showMessage('success', `Barang "${newItemName.trim()}" berhasil dicatat.`)
    setAddingNewReturnItem(false)
    setNewItemPhotoUrl(''); setNewItemName(''); setNewItemReason('')
    if (selectedPlanId) await fetchPlanReturns(selectedPlanId)
    setReturnItemSubmitting(false)
  }

  // Dipanggil dari layar Lapor Sampai Garasi -- wajib sebelum "Selesai Kirim" bisa ditekan
  // (lihat canSubmitSelesaiKirim). RPC sendiri menolak kalau belum ada barang yang dicatat sama
  // sekali untuk retur ini.
  async function submitFinishReturn(ret: PlanReturn) {
    const photo = closingReturnPhotos[ret.id]
    const note = closingReturnNotes[ret.id]
    if (!photo || !note?.trim()) return
    setFinishingReturnId(ret.id)
    const { error } = await supabase.rpc('finish_store_return', {
      p_return_id: ret.id, p_final_photo_url: photo, p_final_location_note: note.trim(),
    })
    if (error) { showMessage('error', 'Gagal melaporkan retur: ' + error.message); setFinishingReturnId(null); return }
    showMessage('success', `Retur "${ret.logistics_stores?.name}" berhasil dilaporkan selesai.`)
    if (selectedPlanId) await fetchPlanReturns(selectedPlanId)
    setFinishingReturnId(null)
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

  const canSubmitSelesaiKirim = !!garagePhotoUrl && needsRefuel !== null && (!needsRefuel || (!!refuelAmount && Number(refuelAmount) > 0)) && activeReturns.length === 0

  async function submitSelesaiKirim() {
    if (!selectedPlan || !canSubmitSelesaiKirim) return
    setSubmitting(true)
    const { data, error } = await supabase.rpc('complete_logistics_delivery', {
      p_plan_id: selectedPlan.id, p_garage_photo_url: garagePhotoUrl, p_needs_refuel: needsRefuel,
      p_refuel_amount: needsRefuel ? Number(refuelAmount) : null,
    })
    if (error) { showMessage('error', 'Gagal menyelesaikan trip: ' + error.message); setSubmitting(false); return }
    const row = Array.isArray(data) ? data[0] : data
    const myShare = myEmployeeId === selectedPlan.driver_id ? row?.driver_earning : row?.helper_earning
    showMessage('success', `Trip selesai! Upah ritase Anda sebesar ${fmtRp(Number(myShare ?? 0))} sudah tercatat.`)
    setGaragePhotoUrl(''); setNeedsRefuel(null); setRefuelAmount('')
    setSelectedPlanId(null)
    await refresh()
    setSubmitting(false)
  }

  async function handleBerangkat() {
    if (!selectedPlan) return
    if (unfinishedLoadings.length > 0) {
      const list = unfinishedLoadings.map(u => `• ${u.store_name} (dari ${u.origin_name})`).join('\n')
      if (!confirm(`⚠️ Laporan Muat cabang ini BELUM ditandai Selesai:\n${list}\n\nPaketnya belum bisa diambil di aplikasi. Minta cabang menekan "Tandai Selesai" lalu ambil di Jemput Barang Cabang sebelum berangkat.\n\nTetap berangkat sekarang?`)) return
    }
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
  const canProceedStep2 = isPaymentValid(paymentMethod, invoiceAmount, paymentAmount, noGudang, selectedNotas.length) && (
    paymentMethod === 'transfer' ? !!paymentPhotoUrl :
    paymentMethod === 'tempo' ? !!paymentDueDate : true
  )
  const cutOverNota = cutYes && cutTotalOf(cutItems) > visitNotaTotal(invoiceAmount, noGudang, selectedNotas)
  const canSubmitKirim = canProceedStep1 && canProceedStep2 &&
    (incidentType === 'tidak_ada' || (!!incidentPhotoUrl && incidentDescription.trim().length > 0)) &&
    (!cutYes || (cutItemsValid(cutItems) && !!cutPhotoUrl && !cutOverNota))

  // Kunci tombol 1 detik setiap kali tampilan tombol berganti (pindah langkah, kotak konfirmasi
  // muncul/hilang, pilih toko, buka modal) -- tap kedua dari double-tap jadi tidak "tembus".
  // Terkunci begitu kuncinya berubah (di render yang sama, tanpa jeda), baru dibuka timer.
  const clickGuardKey = [kirimStep, showUnloadConfirm, actionMode, selectedStoreId, canProceedStep2, editHistoryStore?.id, showFinishConfirm].join('|')
  const clickLocked = clickGuardKey !== unlockedGuardKey
  useEffect(() => {
    const t = setTimeout(() => setUnlockedGuardKey(clickGuardKey), CLICK_GUARD_MS)
    return () => clearTimeout(t)
  }, [clickGuardKey])

  async function submitKirim() {
    if (!selectedStore || !canSubmitKirim || clickLocked || submitLockRef.current) return
    submitLockRef.current = true
    setSubmitting(true)
    // Server yang menyimpan & membagi uang diterima ke Nota Gudang + nota cabang (migrasi 083).
    const { error } = await supabase.rpc('submit_plan_store_delivery', {
      p_plan_store_id: selectedStore.id,
      p_photo_urls: deliveryPhotoUrls,
      p_method: paymentMethod,
      p_gudang_invoice: noGudang ? 0 : Number(invoiceAmount),
      p_received: receivedFor(paymentMethod, paymentAmount),
      p_payment_photo_url: paymentMethod === 'transfer' ? paymentPhotoUrl : null,
      p_due_date: paymentMethod === 'tempo' ? paymentDueDate : null,
      p_incident_type: incidentType,
      p_incident_photo_url: incidentType !== 'tidak_ada' ? incidentPhotoUrl : null,
      p_incident_description: incidentType !== 'tidak_ada' ? incidentDescription.trim() : null,
    })

    // "Sudah diproses rekan" tetap lanjut bersih-bersih seperti sukses (tokonya memang sudah beres).
    const alreadyDone = !!error && /sudah lebih dulu diproses/.test(error.message)
    if (error && !alreadyDone) { showMessage('error', 'Gagal menyimpan: ' + error.message); setSubmitting(false); submitLockRef.current = false; return }
    let cutError: string | null = null
    if (!alreadyDone && cutYes) {
      const { error: cErr } = await supabase.rpc('set_visit_cuts', {
        p_plan_store_id: selectedStore.id, p_items: cutPayload(cutItems), p_photo_url: cutPhotoUrl,
      })
      if (cErr) cutError = cErr.message
    }
    if (alreadyDone) showMessage('error', 'Toko ini sudah lebih dulu diproses oleh rekan Anda.')
    else if (cutError) showMessage('error', `Pengiriman tersimpan, tapi POTONG NOTA gagal disimpan: ${cutError}. Isi ulang lewat tombol Edit di Riwayat Toko.`)
    else showMessage('success', `Toko "${selectedStore.logistics_stores?.name}" selesai dikirim.${cutYes ? ' Potong nota menunggu persetujuan Finance.' : ''}`)
    await clearTargetStore()
    resetKirimForm()
    await refresh()
    setSubmitting(false)
    submitLockRef.current = false
  }

  async function submitGagal() {
    if (!selectedStore || !failKind || !failedReason.trim() || !failedPhotoUrl || clickLocked || submitLockRef.current) return
    submitLockRef.current = true
    setSubmitting(true)
    const { error } = await supabase.rpc('fail_plan_store', {
      p_plan_store_id: selectedStore.id, p_kind: failKind, p_reason: failedReason.trim(), p_photo_url: failedPhotoUrl,
    })
    const alreadyDone = !!error && /sudah lebih dulu diproses/.test(error.message)
    if (error && !alreadyDone) { showMessage('error', 'Gagal menyimpan: ' + error.message); setSubmitting(false); submitLockRef.current = false; return }
    if (alreadyDone) showMessage('error', 'Toko ini sudah lebih dulu diproses oleh rekan Anda.')
    else showMessage('success', failKind === 'kirim_besok'
      ? `Toko "${selectedStore.logistics_stores?.name}" ditandai Kirim Besok — barang dibawa kembali.`
      : `Toko "${selectedStore.logistics_stores?.name}" ditandai Gagal.`)
    await clearTargetStore()
    setFailedReason(''); setFailKind(''); setFailedPhotoUrl('')
    await refresh()
    setSubmitting(false)
    submitLockRef.current = false
  }

  async function submitFinishEarly() {
    if (!selectedPlan || !finishReason.trim() || pendingStores.length === 0) return
    setFinishSaving(true)
    // Toko yang tidak sempat didatangi = Kirim Besok (barang dibawa kembali & dijadwalkan lagi).
    const { error } = await supabase.from('logistics_plan_stores').update({
      status: 'failed', fail_kind: 'kirim_besok', failed_reason: finishReason.trim(), resolved_by: myEmployeeId, resolved_at: new Date().toISOString(),
    }).eq('plan_id', selectedPlan.id).eq('status', 'pending')
    if (error) { showMessage('error', 'Gagal menyimpan: ' + error.message); setFinishSaving(false); return }
    showMessage('success', `${pendingStores.length} toko yang belum terkirim ditandai Kirim Besok.`)
    setShowFinishConfirm(false)
    setFinishReason('')
    await refresh()
    setFinishSaving(false)
  }

  function openEditHistory(ps: PlanStore) {
    setEditHistoryStore(ps)
    setEditPaymentMethod(ps.payment_method || '')
    const hasBranch = (branchNotas[ps.id] ?? []).length > 0
    setEditNoGudang(hasBranch && Number(ps.invoice_amount) === 0)
    setEditInvoiceAmount(ps.invoice_amount ? String(ps.invoice_amount) : '')
    // Angka asli yang diketik driver; data lama (sebelum migrasi 083) cuma punya payment_amount.
    const received = ps.received_total ?? ps.payment_amount
    setEditPaymentAmount(received ? String(received) : '')
    setEditPaymentDueDate(ps.payment_due_date || '')
    setEditIncidentType(ps.incident_type || 'tidak_ada')
    setEditIncidentPhotoUrl(ps.incident_photo_url || '')
    setEditIncidentDescription(ps.incident_description || '')
    const saved = visitCuts[ps.id] ?? []
    setEditCutYes(saved.length > 0)
    setEditCutItems(saved.length > 0 ? saved.map(c => ({ item_name: c.item_name, amount: String(c.amount), reason: c.reason, goods: c.goods })) : [emptyCut()])
    setEditCutPhotoUrl(ps.cut_photo_url || '')
  }

  // Potongan yang sudah diputuskan Finance tidak bisa diubah driver lagi (server juga menolak).
  const editCutLocked = !!editHistoryStore && (editHistoryStore.cut_status === 'disetujui' || editHistoryStore.cut_status === 'ditolak')
  const editCutOverNota = editCutYes && cutTotalOf(editCutItems) > visitNotaTotal(editInvoiceAmount, editNoGudang, editNotas)
  const canSubmitEditHistory = isPaymentValid(editPaymentMethod, editInvoiceAmount, editPaymentAmount, editNoGudang, editNotas.length) &&
    (editPaymentMethod !== 'tempo' || !!editPaymentDueDate) &&
    (editIncidentType === 'tidak_ada' || (!!editIncidentPhotoUrl && editIncidentDescription.trim().length > 0)) &&
    (editCutLocked || !editCutYes || (cutItemsValid(editCutItems) && !!editCutPhotoUrl && !editCutOverNota))

  // Foto bukti transfer TIDAK diminta ulang di sini (fitur ini cuma untuk betulkan salah
  // ketik nominal/metode/tanggal, bukan mengulang seluruh alur foto) — kalau metode diubah
  // KE transfer padahal fotonya belum ada, tetap disimpan tanpa foto; kalau diubah DARI
  // transfer, foto lama dibiarkan tersimpan di baris (tidak ditampilkan lagi karena metode
  // sudah bukan transfer, tapi datanya tidak hilang kalau mau dikembalikan ke transfer lagi).
  // Kejadian yang diubah KE "Tidak Ada" mengosongkan foto & keterangannya (sama seperti submitKirim).
  async function submitEditHistory() {
    if (!editHistoryStore || !canSubmitEditHistory || clickLocked) return
    setEditSaving(true)
    const { error } = await supabase.rpc('update_plan_store_payment', {
      p_plan_store_id: editHistoryStore.id,
      p_method: editPaymentMethod,
      p_gudang_invoice: editNoGudang ? 0 : Number(editInvoiceAmount),
      p_received: receivedFor(editPaymentMethod, editPaymentAmount),
      p_due_date: editPaymentMethod === 'tempo' ? editPaymentDueDate : null,
      p_incident_type: editIncidentType,
      p_incident_photo_url: editIncidentType !== 'tidak_ada' ? editIncidentPhotoUrl : null,
      p_incident_description: editIncidentType !== 'tidak_ada' ? editIncidentDescription.trim() : null,
    })
    let cutError: string | null = null
    const hadCuts = (visitCuts[editHistoryStore.id] ?? []).length > 0
    if (!error && !editCutLocked && (editCutYes || hadCuts)) {
      const { error: cErr } = await supabase.rpc('set_visit_cuts', {
        p_plan_store_id: editHistoryStore.id, p_items: editCutYes ? cutPayload(editCutItems) : [], p_photo_url: editCutYes ? editCutPhotoUrl : null,
      })
      if (cErr) cutError = cErr.message
    }
    if (error) showMessage('error', 'Gagal menyimpan perubahan: ' + error.message)
    else if (cutError) showMessage('error', 'Pembayaran tersimpan, tapi potong nota gagal: ' + cutError)
    else showMessage('success', 'Data toko berhasil diperbarui.')
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

      {loading && plans.length === 0 ? (
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
            <p className="text-xs text-slate-500">
              {planStores.length} toko dalam rencana ini
              {supplierTasks.length > 0 && ` · ${supplierTasks.length} belanja`}
              {planReturns.length > 0 && ` · ${planReturns.length} ambil retur`}
            </p>
          </div>

          {unfinishedLoadings.length > 0 && selectedPlan && ['ready', 'departed'].includes(selectedPlan.status) && (
            <div className="mb-4 bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm text-amber-800">
              <p className="font-semibold">⚠️ Ada barang cabang yang belum ditandai Selesai oleh cabang:</p>
              <ul className="mt-1 list-disc ml-5">
                {unfinishedLoadings.map(u => (
                  <li key={u.loading_id}>{u.store_name} — dari {u.origin_name} ({u.package_count} paket)</li>
                ))}
              </ul>
              <p className="text-xs mt-1">Minta cabang menekan &quot;Tandai Selesai&quot;, lalu ambil paketnya di <b>Jemput Barang Cabang</b>.</p>
            </div>
          )}

          {selectedPlan?.status === 'ready' && (
            <button onClick={handleBerangkat} disabled={submitting}
              className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg shadow-sm transition disabled:opacity-50">
              🚚 {submitting ? 'Memproses...' : 'Berangkat'}
            </button>
          )}

          {selectedPlan?.status === 'departed' && !allResolved && !selectedStore && !selectedSupplierTask && (
            <div className="space-y-4">
              {pendingStores.length > 0 && (
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
                </div>
              )}

              {pendingSupplierTasks.length > 0 && (
                <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
                  <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
                    <p className="text-sm font-bold text-amber-800">🛒 Belanja Supplier ({pendingSupplierTasks.length} tersisa)</p>
                    <p className="text-xs text-amber-600 mt-0.5">Bebas pilih kapan saja, boleh sebelum atau sesudah kirim ke toko.</p>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {pendingSupplierTasks.map(t => (
                      <button key={t.id} onClick={() => setSelectedSupplierTaskId(t.id)}
                        className="w-full text-left px-4 py-3 hover:bg-amber-50/50 transition flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{t.delivery_routes?.name}</p>
                          {t.notes && <p className="text-xs text-slate-400 truncate">{t.notes}</p>}
                        </div>
                        <span className="text-slate-300">›</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {pendingStores.length > 0 && (
                <button onClick={() => { setFinishReason(''); setShowFinishConfirm(true) }}
                  className="w-full py-2 text-sm font-medium text-slate-500 border border-dashed border-slate-300 rounded-lg bg-white hover:bg-slate-50 hover:text-slate-700 transition">
                  🏁 Selesai Tugas (masih ada {pendingStores.length} toko belum terkirim)
                </button>
              )}
            </div>
          )}

          {selectedPlan?.status === 'departed' && !allResolved && selectedSupplierTask && (
            <div className="bg-white rounded-xl border-2 border-amber-300 p-5">
              <button onClick={() => setSelectedSupplierTaskId(null)} className="text-xs text-blue-600 hover:underline mb-2">← Pilih Tugas Lain</button>
              <h2 className="text-lg font-bold text-slate-800 mb-1">🛒 {selectedSupplierTask.delivery_routes?.name}</h2>
              {selectedSupplierTask.notes && <p className="text-sm text-slate-500 mb-3">{selectedSupplierTask.notes}</p>}
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Wajib Foto Surat Jalan / Nota</p>
              <p className="text-xs text-slate-400 mb-2">Begitu foto berhasil diambil, tugas ini langsung tercatat selesai.</p>
              <LogisticsCameraCapture label="Foto Surat Jalan / Nota" employeeName={myName}
                onCaptured={async blob => {
                  const url = await uploadPlanPhoto(blob, `supplier-${selectedSupplierTask.id}`)
                  if (url) await submitSupplierTaskDone(selectedSupplierTask, url)
                }} />
              {supplierTaskSubmitting && <p className="text-xs text-slate-400 mt-2">Menyimpan...</p>}
            </div>
          )}

          {/* Tugas Retur sengaja TIDAK dibatasi !allResolved -- proses ambil barangnya jalan
              independen dari toko/belanja (lihat catatan activeReturns di atas), jadi tetap
              harus terlihat & bisa dikerjakan meski semua toko/belanja sudah kelar. */}
          {selectedPlan?.status === 'departed' && !selectedStore && !selectedSupplierTask && !selectedReturn && activeReturns.length > 0 && (
            <div className="bg-white rounded-xl border border-purple-200 overflow-hidden mt-4">
              <div className="px-4 py-3 bg-purple-50 border-b border-purple-100">
                <p className="text-sm font-bold text-purple-800">↩️ Tugas Retur ({activeReturns.length})</p>
                <p className="text-xs text-purple-600 mt-0.5">Ambil barang retur pas Anda di toko ini, catat satu-per-satu.</p>
              </div>
              <div className="divide-y divide-slate-100">
                {activeReturns.map(r => (
                  <button key={r.id} onClick={() => openReturnTask(r.id)}
                    className="w-full text-left px-4 py-3 hover:bg-purple-50/50 transition flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{r.logistics_stores?.name}</p>
                      {r.note && <p className="text-xs text-slate-500 truncate">{r.note}</p>}
                      <p className="text-xs text-slate-400 truncate">{returnItemsByReturn[r.id]?.length || 0} barang sudah dicatat</p>
                    </div>
                    <span className="text-slate-300">›</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Juga dibuka di tahap 'closing' -- driver yang lupa mencatat barang sebelum foto box
              harus tetap bisa mencatatnya, karena finish_store_return menolak retur tanpa barang. */}
          {(selectedPlan?.status === 'departed' || selectedPlan?.status === 'closing') && selectedReturn && (
            <div className="bg-white rounded-xl border-2 border-purple-300 p-5 mt-4">
              <button onClick={clearReturnSelection} className="text-xs text-blue-600 hover:underline mb-2">← Pilih Tugas Lain</button>
              <h2 className="text-lg font-bold text-slate-800 mb-1">↩️ Ambil Retur — {selectedReturn.logistics_stores?.name}</h2>
              {selectedReturn.logistics_stores?.address && <p className="text-sm text-slate-500 mb-2">{selectedReturn.logistics_stores.address}</p>}
              {selectedReturn.note && (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3">Catatan kantor: {selectedReturn.note}</p>
              )}

              <p className="text-xs text-purple-800 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 mb-3">
                Foto <strong>setiap barang retur satu-satu</strong>. Toko ini <strong>bukan kiriman</strong> — tidak perlu tekan Kirim.
              </p>

              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">
                Barang Retur ({returnItemsByReturn[selectedReturn.id]?.length || 0})
              </p>
              {(returnItemsByReturn[selectedReturn.id]?.length || 0) > 0 && (
                <div className="space-y-2 mb-3">
                  {returnItemsByReturn[selectedReturn.id].map(it => (
                    <div key={it.id} className="flex items-center gap-3 border border-slate-200 rounded-lg p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.photo_url} alt={it.item_name} onClick={() => openLightbox(it.photo_url, it.item_name)}
                        className="w-14 h-14 object-cover rounded-lg border border-slate-200 shrink-0 cursor-zoom-in" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{it.item_name}</p>
                        <p className="text-xs text-slate-500 truncate">{it.reason}</p>
                      </div>
                      <button onClick={() => deleteReturnItem(it)} disabled={deletingReturnItemId === it.id}
                        className="px-2.5 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 shrink-0 disabled:opacity-50">
                        {deletingReturnItemId === it.id ? '...' : 'Hapus'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {reportingEmptyReturn ? (
                <div className="space-y-3 border-t border-slate-100 pt-3 mt-1">
                  <p className="text-sm font-semibold text-slate-700">Toko Tidak Ada Barang Retur</p>
                  <p className="text-xs text-slate-500">Foto tokonya, lalu tulis kata pemilik/penjaga toko.</p>
                  {emptyReturnPhotoUrl ? (
                    <div className="space-y-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={emptyReturnPhotoUrl} alt="Foto toko" className="w-full rounded-lg aspect-[4/3] object-cover" />
                      <button onClick={() => setEmptyReturnPhotoUrl('')} className="text-xs text-blue-600 hover:underline">Ganti Foto</button>
                    </div>
                  ) : (
                    <LogisticsCameraCapture label="Foto Toko" employeeName={myName}
                      onCaptured={async blob => { const url = await uploadPlanPhoto(blob, `retur-${selectedReturn.id}-kosong`); if (url) setEmptyReturnPhotoUrl(url) }}
                      onCancel={() => setReportingEmptyReturn(false)} />
                  )}
                  <input type="text" value={emptyReturnReason} onChange={e => setEmptyReturnReason(e.target.value)}
                    placeholder="Contoh: kata pemilik toko barang retur tidak ada"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
                  <div className="flex gap-2">
                    <button onClick={() => { setReportingEmptyReturn(false); setEmptyReturnPhotoUrl(''); setEmptyReturnReason('') }}
                      className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
                    <button onClick={submitEmptyReturn} disabled={!emptyReturnPhotoUrl || !emptyReturnReason.trim() || emptyReturnSubmitting}
                      className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                      {emptyReturnSubmitting ? 'Menyimpan...' : 'Simpan'}
                    </button>
                  </div>
                </div>
              ) : !addingNewReturnItem ? (
                <div className="space-y-2">
                  <button onClick={() => setAddingNewReturnItem(true)}
                    className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg transition">
                    📷 + Tambah Barang Retur
                  </button>
                  {(returnItemsByReturn[selectedReturn.id]?.length || 0) === 0 ? (
                    <button onClick={() => setReportingEmptyReturn(true)}
                      className="w-full py-2 border border-slate-300 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition">
                      Toko tidak ada barang retur
                    </button>
                  ) : (
                    <>
                      <button onClick={clearReturnSelection}
                        className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition">
                        ✓ Sudah Semua, Kembali
                      </button>
                      <p className="text-xs text-slate-400 text-center">Barang retur dibawa ke mobil. Posisi akhirnya dilaporkan nanti di Lapor Sampai Garasi.</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-3 border-t border-slate-100 pt-3 mt-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase">Barang Baru</p>
                  {newItemPhotoUrl ? (
                    <div className="space-y-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={newItemPhotoUrl} alt="Foto barang retur" className="w-full rounded-lg aspect-[4/3] object-cover" />
                      <button onClick={() => setNewItemPhotoUrl('')} className="text-xs text-blue-600 hover:underline">Ganti Foto</button>
                      <input type="text" value={newItemName} onChange={e => setNewItemName(e.target.value)} placeholder="Nama barang"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
                      <input type="text" value={newItemReason} onChange={e => setNewItemReason(e.target.value)} placeholder="Alasan retur"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
                      <div className="flex gap-2">
                        <button onClick={() => { setAddingNewReturnItem(false); setNewItemPhotoUrl(''); setNewItemName(''); setNewItemReason('') }}
                          className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
                        <button onClick={submitNewReturnItem} disabled={!newItemName.trim() || !newItemReason.trim() || returnItemSubmitting}
                          className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                          {returnItemSubmitting ? 'Menyimpan...' : 'Simpan Barang'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <LogisticsCameraCapture label="Foto Barang Retur" employeeName={myName}
                      onCaptured={async blob => { const url = await uploadPlanPhoto(blob, `retur-${selectedReturn.id}-item`); if (url) setNewItemPhotoUrl(url) }}
                      onCancel={() => setAddingNewReturnItem(false)} />
                  )}
                </div>
              )}
            </div>
          )}

          {showCentralReminder && selectedPlan && (
            <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
                <h3 className="font-semibold text-slate-800 mb-2">📦 Ada Titipan di Cabang Toko</h3>
                <p className="text-sm text-slate-600 mb-4">
                  Ada <strong>{centralPendingCount} paket</strong> barang di cabang toko (Toko Pusat/Toko Depan/Markas/Raja) yang masih menunggu diambil driver — bisa saja bukan buat toko di rencana ini, cek dulu sebelum berangkat.
                </p>
                <div className="flex gap-3">
                  <button onClick={() => { setShowCentralReminder(false); setReminderDismissedFor(selectedPlan.id) }}
                    className="flex-1 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">
                    Nanti Saja
                  </button>
                  <Link href="/logistik/jemput-toko-pusat"
                    className="flex-1 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold text-center">
                    Lihat & Ambil →
                  </Link>
                </div>
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
                  Toko-toko di atas akan otomatis ditandai <strong>Kirim Besok</strong> (barang dibawa kembali &amp; dijadwalkan lagi) dengan alasan yang Anda isi di bawah. Pastikan ini benar sebelum lanjut.
                </p>
                <input type="text" value={finishReason} onChange={e => setFinishReason(e.target.value)}
                  placeholder="Alasan (contoh: trip diakhiri, kehabisan waktu)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none mb-3" />
                <div className="flex gap-3">
                  <button onClick={() => setShowFinishConfirm(false)} className="flex-1 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Batal</button>
                  <button onClick={submitFinishEarly} disabled={!finishReason.trim() || finishSaving || clickLocked}
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
                  <button onClick={() => openAction('kirim')} disabled={clickLocked} className="py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">Kirim</button>
                  <button onClick={() => openAction('gagal')} disabled={clickLocked} className="py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">Tidak Terkirim</button>
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
                            <button type="button" onClick={() => { setKirimStep(2); setShowUnloadConfirm(false) }} disabled={clickLocked}
                              className="py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                              Sudah, Lanjut →
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 pt-3">
                          <button onClick={() => setActionMode(null)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
                          <button onClick={() => setShowUnloadConfirm(true)} disabled={!canProceedStep1 || clickLocked}
                            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                            Lanjut ke Langkah 2 →
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {kirimStep === 2 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Langkah 2 — Pembayaran</p>
                      <NotaInputs notas={selectedNotas} noGudang={noGudang} onNoGudang={setNoGudang} invoice={invoiceAmount} onInvoice={setInvoiceAmount}
                        sj={selectedStore ? visitSj[selectedStore.id] : []} />
                      <label className="block text-xs font-medium text-slate-600 mb-1">Metode Pembayaran *</label>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {(['cash', 'transfer', 'deposit', 'tempo'] as const).map(m => (
                          <button key={m} type="button" onClick={() => setPaymentMethod(m)}
                            className={`py-2 rounded-lg text-sm font-medium border transition ${paymentMethod === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                            {PAYMENT_LABEL[m]}
                          </button>
                        ))}
                      </div>
                      {paymentMethod && paymentMethod !== 'tempo' && (
                        <div className="mb-3">
                          <label className="block text-xs font-medium text-slate-600 mb-1">{receivedLabel(paymentMethod, selectedNotas)} (Rp) *</label>
                          <RupiahInput value={paymentAmount} onChange={setPaymentAmount} placeholder={RECEIVED_LABEL[paymentMethod]}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                      )}
                      {paymentMethod === 'tempo' && (
                        <div className="mb-3">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal Jatuh Tempo *</label>
                          <input type="date" value={paymentDueDate} onChange={e => setPaymentDueDate(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                      )}
                      {paymentMethod && (
                        <div className="mb-3"><BalanceNote invoice={visitNotaTotal(invoiceAmount, noGudang, selectedNotas)} received={receivedFor(paymentMethod, paymentAmount) || 0} /></div>
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
                            <button type="button" onClick={() => setKirimStep(3)} disabled={clickLocked}
                              className="py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
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
                      <p className="text-xs text-slate-400 mb-2">Ada barang retur, salah muat, atau barang lebih di toko ini?</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                        {(['tidak_ada', 'salah_muat', 'retur', 'barang_lebih'] as const).map(k => (
                          <button key={k} type="button" onClick={() => setIncidentType(k)}
                            className={`py-2 rounded-lg text-xs font-medium border transition ${incidentType === k ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                            {INCIDENT_LABEL[k]}
                          </button>
                        ))}
                      </div>
                      {incidentType === 'retur' && activeReturns.some(r => r.store_id === selectedStore.store_id) && (
                        <p className="text-xs text-purple-800 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 mb-3">
                          Toko ini punya <strong>Tugas Retur</strong> dari kantor. Barang returnya dicatat di kartu <strong>↩️ Tugas Retur</strong> (satu-satu), bukan di sini.
                        </p>
                      )}
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

                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <p className="text-xs font-semibold text-slate-600 mb-1">Apakah ini POTONG NOTA?</p>
                        <p className="text-xs text-slate-400 mb-2">Toko membayar kurang dari nota karena barang salah / rusak / kurang / harga beda.</p>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <button type="button" onClick={() => setCutYes(false)}
                            className={`py-2 rounded-lg text-xs font-medium border ${!cutYes ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300'}`}>Tidak</button>
                          <button type="button" onClick={() => setCutYes(true)}
                            className={`py-2 rounded-lg text-xs font-medium border ${cutYes ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-300'}`}>✂️ Ya, potong nota</button>
                        </div>
                        {cutYes && (
                          <div className="space-y-2">
                            <CutItemsEditor items={cutItems} onChange={setCutItems} />
                            {cutOverNota && <p className="text-xs text-red-600">Total potongan melebihi total nota.</p>}
                            {cutPhotoUrl ? (
                              <div className="space-y-2">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={cutPhotoUrl} alt="Foto potong nota" className="w-full rounded-lg aspect-[4/3] object-cover" />
                                <button onClick={async () => { setCutPhotoUrl(''); await persistStorePhotoField('cut_photo_url', null) }} className="text-xs text-blue-600 hover:underline">Ganti Foto</button>
                              </div>
                            ) : (
                              <LogisticsCameraCapture label="Foto Barang / Nota yang Dipotong *" employeeName={myName}
                                onCaptured={async blob => {
                                  const url = await uploadPhoto(blob, 'potong')
                                  if (url) { setCutPhotoUrl(url); await persistStorePhotoField('cut_photo_url', url) }
                                }} />
                            )}
                            <p className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                              Potongan menunggu persetujuan Finance. Selama belum disetujui, tetap dihitung kurang bayar.
                              {cutItems.some(i => i.goods === 'dibawa_kembali') && ' Barang yang dibawa kembali diserahkan ke Gudang (Penerimaan Retur).'}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2 pt-3">
                        <button onClick={() => setKirimStep(2)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">← Kembali</button>
                        <button onClick={submitKirim} disabled={!canSubmitKirim || submitting || clickLocked}
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
                  <p className="text-xs font-semibold text-slate-600">Kenapa tidak terkirim?</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => { setFailKind('kirim_besok'); setFailedReason('') }}
                      className={`text-left px-3 py-2 rounded-lg text-sm border transition ${failKind === 'kirim_besok' ? 'bg-amber-50 border-amber-500 ring-2 ring-amber-300' : 'bg-white border-slate-300'}`}>
                      <span className="font-semibold">📅 Kirim Besok</span>
                      <span className="block text-xs text-slate-500">Toko tutup / tidak ada orang. Barang dibawa kembali.</span>
                    </button>
                    <button type="button" onClick={() => { setFailKind('gagal'); setFailedReason('') }}
                      className={`text-left px-3 py-2 rounded-lg text-sm border transition ${failKind === 'gagal' ? 'bg-red-50 border-red-500 ring-2 ring-red-300' : 'bg-white border-slate-300'}`}>
                      <span className="font-semibold">❌ Gagal</span>
                      <span className="block text-xs text-slate-500">Toko menolak / batal pesan. Tidak dikirim lagi.</span>
                    </button>
                  </div>
                  {failKind && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {(failKind === 'kirim_besok' ? ['Toko Tutup', 'Tidak Ada Orang'] : ['Toko Menolak Barang', 'Batal Pesan']).map(r => (
                          <button key={r} type="button" onClick={() => setFailedReason(r)}
                            className={`py-2 rounded-lg text-sm font-medium border transition ${failedReason === r ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                            {r}
                          </button>
                        ))}
                      </div>
                      <input type="text" value={failedReason} onChange={e => setFailedReason(e.target.value)} placeholder="Atau isi alasan lain..."
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                      {failedPhotoUrl ? (
                        <div className="space-y-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={failedPhotoUrl} alt="Foto toko" className="w-full rounded-lg aspect-[4/3] object-cover" />
                          <button type="button" onClick={() => setFailedPhotoUrl('')} className="text-xs text-blue-600 hover:underline">Ganti Foto</button>
                        </div>
                      ) : (
                        <LogisticsCameraCapture label="Foto Toko (wajib)" employeeName={myName}
                          onCaptured={async blob => { const url = await uploadPhoto(blob, 'gagal'); if (url) setFailedPhotoUrl(url) }} />
                      )}
                    </>
                  )}
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => setActionMode(null)} className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Batal</button>
                    <button onClick={submitGagal} disabled={!failKind || !failedReason.trim() || !failedPhotoUrl || submitting || clickLocked}
                      className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                      {submitting ? 'Menyimpan...'
                        : !failKind ? 'Pilih Kirim Besok / Gagal'
                        : !failedReason.trim() ? 'Isi alasan dulu'
                        : !failedPhotoUrl ? 'Foto toko dulu'
                        : failKind === 'kirim_besok' ? 'Konfirmasi Kirim Besok' : 'Konfirmasi Gagal'}
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
              {returnsWithoutItems.length > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                  ⚠ Retur di {returnsWithoutItems.map(r => r.logistics_stores?.name).join(', ')} belum ada barang yang dicatat. Buka Tugas Retur di bawah: catat barangnya, atau pilih &quot;Toko tidak ada barang retur&quot;.
                </p>
              )}
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

          {selectedPlan?.status === 'closing' && !selectedReturn && (() => {
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
                    {activeReturns.length > 0 && (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-amber-700 uppercase">⚠ Selesaikan Barang Retur Dulu</p>
                        {activeReturns.map(r => (returnItemsByReturn[r.id]?.length || 0) === 0 ? (
                          <div key={r.id} className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-2">
                            <p className="text-sm font-semibold text-slate-800">{r.logistics_stores?.name}</p>
                            <p className="text-xs text-red-700">Belum ada barang retur yang dicatat. Catat barangnya, atau pilih &quot;Toko tidak ada barang retur&quot;.</p>
                            <button onClick={() => openReturnTask(r.id)}
                              className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg transition">
                              Buka Tugas Retur
                            </button>
                          </div>
                        ) : (
                          <div key={r.id} className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
                            <p className="text-sm font-semibold text-slate-800">{r.logistics_stores?.name}</p>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs text-slate-500">{returnItemsByReturn[r.id]?.length || 0} barang tercatat</p>
                              <button onClick={() => openReturnTask(r.id)} className="text-xs font-medium text-purple-700 hover:underline shrink-0">
                                Lihat / Ubah Barang
                              </button>
                            </div>
                            <p className="text-xs text-slate-600">Foto barang retur di tempat Anda menaruhnya, lalu tulis tempatnya.</p>
                            {closingReturnPhotos[r.id] ? (
                              <div className="space-y-2">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={closingReturnPhotos[r.id]} alt="Posisi akhir barang" className="w-full rounded-lg aspect-[4/3] object-cover" />
                                <button onClick={() => setClosingReturnPhotos(prev => ({ ...prev, [r.id]: '' }))} className="text-xs text-blue-600 hover:underline">Ganti Foto</button>
                              </div>
                            ) : (
                              <LogisticsCameraCapture label="Foto Posisi Akhir Barang" employeeName={myName}
                                onCaptured={async blob => {
                                  const url = await uploadPlanPhoto(blob, `retur-final-${r.id}`)
                                  if (url) setClosingReturnPhotos(prev => ({ ...prev, [r.id]: url }))
                                }} />
                            )}
                            <input type="text" value={closingReturnNotes[r.id] || ''}
                              onChange={e => setClosingReturnNotes(prev => ({ ...prev, [r.id]: e.target.value }))}
                              placeholder="Barang ditaruh di mana? (misal: di dalam mobil / rak retur gudang)"
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none" />
                            <button onClick={() => submitFinishReturn(r)}
                              disabled={!closingReturnPhotos[r.id] || !closingReturnNotes[r.id]?.trim() || finishingReturnId === r.id}
                              className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                              {finishingReturnId === r.id ? 'Menyimpan...' : 'Tandai Selesai'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
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
                        <button type="button" onClick={() => { setNeedsRefuel(false); setRefuelAmount('') }}
                          className={`py-2 rounded-lg text-sm font-medium border transition ${needsRefuel === false ? 'bg-slate-600 text-white border-slate-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>Tidak</button>
                      </div>
                      {needsRefuel === true && (
                        <div className="mt-2">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Kira-kira Butuh Berapa? (Rp)</label>
                          <RupiahInput value={refuelAmount} onChange={setRefuelAmount}
                            placeholder="Contoh: 150000"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none" />
                          <p className="text-[11px] text-slate-400 mt-1">Supaya admin bisa siapkan uangnya dari pagi.</p>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">Upah ritase resmi tercatat begitu Anda menekan "Selesai Kirim" di bawah ini.</p>
                    <button onClick={submitSelesaiKirim} disabled={!canSubmitSelesaiKirim || submitting}
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
                          <>
                            <button onClick={() => openAddHistoryPhoto(ps)} className="text-xs text-blue-600 hover:underline font-medium">+ Foto</button>
                            <button onClick={() => openEditHistory(ps)} className="text-xs text-blue-600 hover:underline font-medium">Edit</button>
                          </>
                        )}
                      </div>
                    </div>

                    {ps.status === 'failed' && ps.failed_reason && (
                      <p className={`text-xs mt-1 ${ps.fail_kind === 'kirim_besok' ? 'text-amber-700' : 'text-red-600'}`}>
                        {ps.fail_kind === 'kirim_besok' ? '📅 Kirim Besok' : ps.fail_kind === 'gagal' ? '❌ Gagal' : 'Alasan'}: {ps.failed_reason}
                        {ps.failed_photo_url && <> · <button type="button" onClick={() => openLightbox(ps.failed_photo_url!, 'Foto toko')} className="underline">foto</button></>}
                      </p>
                    )}

                    {ps.status === 'delivered' && ps.payment_method && (
                      <p className="text-xs text-slate-500 mt-1">
                        {PAYMENT_LABEL[ps.payment_method]}
                        {ps.invoice_amount ? ` — nota gudang ${fmtRp(Number(ps.invoice_amount))}` : ''}
                        {(branchNotas[ps.id] ?? []).map(n => ` — nota ${n.origin} ${fmtRp(n.amount)}`).join('')}
                        {(ps.received_total ?? ps.payment_amount) ? ` — diterima ${fmtRp(Number(ps.received_total ?? ps.payment_amount))}` : ''}
                        {ps.payment_due_date ? ` — jatuh tempo ${new Date(ps.payment_due_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}` : ''}
                        {ps.invoice_amount == null && <span className="text-amber-600"> — nominal nota belum diisi</span>}
                      </p>
                    )}
                    {ps.incident_type !== 'tidak_ada' && (
                      <p className="text-xs text-amber-600 mt-1">
                        {INCIDENT_LABEL[ps.incident_type]}{ps.incident_description ? `: ${ps.incident_description}` : ''}
                      </p>
                    )}
                    {Number(ps.cut_total) > 0 && (
                      <p className={`text-xs mt-1 ${ps.cut_status === 'ditolak' ? 'text-red-600' : ps.cut_status === 'disetujui' ? 'text-green-700' : 'text-rose-700'}`}>
                        ✂️ Potong nota {fmtRp(Number(ps.cut_total))} — {CUT_STATUS_LABEL[ps.cut_status ?? 'menunggu']}
                        {ps.cut_decision_note ? ` (${ps.cut_decision_note})` : ''}
                        {(visitCuts[ps.id] ?? []).map(c => ` · ${c.item_name} ${fmtRp(Number(c.amount))}${c.goods === 'dibawa_kembali' ? ' ↩️' : ''}`).join('')}
                        {ps.cut_photo_url && <> · <button type="button" onClick={() => openLightbox(ps.cut_photo_url!, 'Foto potong nota')} className="underline">foto</button></>}
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

          {planReturns.some(r => r.status === 'selesai') && (
            <div className="mt-6 bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-sm font-bold text-slate-700">Riwayat Retur</div>
              <div className="divide-y divide-slate-100">
                {planReturns.filter(r => r.status === 'selesai').map(r => (
                  <div key={r.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-700 font-medium">{r.logistics_stores?.name}</span>
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Selesai</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {r.no_items_reason
                        ? `Tidak ada barang retur — ${r.no_items_reason}`
                        : `${returnItemsByReturn[r.id]?.length || 0} barang${r.final_location_note ? ` — disimpan di: ${r.final_location_note}` : ''}`}
                    </p>
                    <div className="flex gap-3 mt-2 flex-wrap">
                      {returnItemsByReturn[r.id]?.map(it => (
                        <button key={it.id} type="button" onClick={() => openLightbox(it.photo_url, it.item_name)} title={it.item_name} className="flex flex-col items-center gap-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={it.photo_url} alt={it.item_name} className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                          <span className="text-[10px] text-slate-500 font-medium truncate max-w-[56px]">{it.item_name}</span>
                        </button>
                      ))}
                      {r.final_photo_url && (
                        <button type="button" onClick={() => openLightbox(r.final_photo_url!, r.no_items_reason ? 'Foto toko' : 'Posisi akhir barang')} title={r.no_items_reason ? 'Foto Toko' : 'Posisi Akhir'} className="flex flex-col items-center gap-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.final_photo_url} alt={r.no_items_reason ? 'Foto toko' : 'Posisi akhir barang'} className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                          <span className="text-[10px] text-slate-500 font-medium">{r.no_items_reason ? 'Foto Toko' : 'Posisi Akhir'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {addPhotoStore && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-slate-800 mb-1">Tambah Foto</h3>
            <p className="text-xs text-slate-500 mb-4">{addPhotoStore.logistics_stores?.name} — foto lama tidak dihapus, ini cuma nambah.</p>
            {addPhotoStore.delivery_photo_urls && addPhotoStore.delivery_photo_urls.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {addPhotoStore.delivery_photo_urls.map((url, idx) => (
                  <button key={idx} type="button" onClick={() => openLightbox(url, `Bukti kirim ${idx + 1}`)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Bukti kirim ${idx + 1}`} className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                  </button>
                ))}
              </div>
            )}
            {/* key berganti tiap foto baru masuk -- memaksa komponen kamera remount & balik ke
                keadaan awal (idle), supaya bisa langsung motret foto berikutnya lagi kalau perlu,
                bukan mentok di layar pratinjau foto yang baru saja diambil. */}
            <LogisticsCameraCapture key={addPhotoStore.delivery_photo_urls?.length ?? 0}
              label="Foto Tambahan" employeeName={myName} onCaptured={handleAddHistoryPhoto} />
            {addPhotoSaving && <p className="text-xs text-slate-400 mt-2">Menyimpan...</p>}
            <button type="button" onClick={() => setAddPhotoStore(null)}
              className="w-full mt-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">
              Selesai
            </button>
          </div>
        </div>
      )}

      {editHistoryStore && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-slate-800 mb-1">Edit Data Toko</h3>
            <p className="text-xs text-slate-500 mb-4">{editHistoryStore.logistics_stores?.name}</p>
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase">Pembayaran</p>
              <NotaInputs notas={editNotas} noGudang={editNoGudang} onNoGudang={setEditNoGudang} invoice={editInvoiceAmount} onInvoice={setEditInvoiceAmount}
                sj={visitSj[editHistoryStore.id]} />
              <div className="grid grid-cols-2 gap-2">
                {(['cash', 'transfer', 'deposit', 'tempo'] as const).map(m => (
                  <button key={m} type="button" onClick={() => setEditPaymentMethod(m)}
                    className={`py-2 rounded-lg text-sm font-medium border transition ${editPaymentMethod === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                    {PAYMENT_LABEL[m]}
                  </button>
                ))}
              </div>
              {editPaymentMethod && editPaymentMethod !== 'tempo' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{receivedLabel(editPaymentMethod, editNotas)} (Rp) *</label>
                  <RupiahInput value={editPaymentAmount} onChange={setEditPaymentAmount} placeholder={RECEIVED_LABEL[editPaymentMethod]}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              )}
              {editPaymentMethod === 'tempo' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal Jatuh Tempo *</label>
                  <input type="date" value={editPaymentDueDate} onChange={e => setEditPaymentDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              )}
              {editPaymentMethod && <BalanceNote invoice={visitNotaTotal(editInvoiceAmount, editNoGudang, editNotas)} received={receivedFor(editPaymentMethod, editPaymentAmount) || 0} />}
              {editPaymentMethod === 'transfer' && (
                <p className="text-xs text-slate-400">Foto bukti transfer yang sudah diunggah tidak berubah — cuma metode/nominal/tanggalnya yang bisa dikoreksi di sini.</p>
              )}

              <p className="text-xs font-semibold text-slate-500 uppercase pt-2 border-t border-slate-100">Kejadian</p>
              <div className="grid grid-cols-2 gap-2">
                {INCIDENT_TYPES.map(k => (
                  <button key={k} type="button" onClick={() => setEditIncidentType(k)}
                    className={`py-2 rounded-lg text-xs font-medium border transition ${editIncidentType === k ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                    {INCIDENT_LABEL[k]}
                  </button>
                ))}
              </div>
              {editIncidentType !== 'tidak_ada' && (
                <div className="space-y-2">
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Wajib foto dan tulis keterangan.</p>
                  {editIncidentPhotoUrl ? (
                    <div className="space-y-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={editIncidentPhotoUrl} alt="Foto kejadian" className="w-full rounded-lg aspect-[4/3] object-cover" />
                      <button type="button" onClick={() => setEditIncidentPhotoUrl('')} className="text-xs text-blue-600 hover:underline">Ganti Foto</button>
                    </div>
                  ) : (
                    <LogisticsCameraCapture label="Foto Kejadian" employeeName={myName}
                      onCaptured={async blob => {
                        const url = await uploadHistoryPhoto(editHistoryStore.id, blob)
                        if (url) setEditIncidentPhotoUrl(url)
                      }} />
                  )}
                  <textarea value={editIncidentDescription} onChange={e => setEditIncidentDescription(e.target.value)}
                    placeholder="Keterangan kejadian..." rows={3}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
                </div>
              )}

              <p className="text-xs font-semibold text-slate-500 uppercase pt-2 border-t border-slate-100">Potong Nota</p>
              {editCutLocked ? (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  Potongan {fmtRp(Number(editHistoryStore.cut_total))} sudah {CUT_STATUS_LABEL[editHistoryStore.cut_status!]} Finance — tidak bisa diubah lagi.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setEditCutYes(false)}
                      className={`py-2 rounded-lg text-xs font-medium border ${!editCutYes ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300'}`}>Tidak ada</button>
                    <button type="button" onClick={() => setEditCutYes(true)}
                      className={`py-2 rounded-lg text-xs font-medium border ${editCutYes ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-300'}`}>✂️ Ya, potong nota</button>
                  </div>
                  {editCutYes && (
                    <div className="space-y-2">
                      <CutItemsEditor items={editCutItems} onChange={setEditCutItems} />
                      {editCutOverNota && <p className="text-xs text-red-600">Total potongan melebihi total nota.</p>}
                      {editCutPhotoUrl ? (
                        <div className="space-y-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={editCutPhotoUrl} alt="Foto potong nota" className="w-full rounded-lg aspect-[4/3] object-cover" />
                          <button type="button" onClick={() => setEditCutPhotoUrl('')} className="text-xs text-blue-600 hover:underline">Ganti Foto</button>
                        </div>
                      ) : (
                        <LogisticsCameraCapture label="Foto Barang / Nota yang Dipotong *" employeeName={myName}
                          onCaptured={async blob => {
                            const url = await uploadHistoryPhoto(editHistoryStore.id, blob)
                            if (url) setEditCutPhotoUrl(url)
                          }} />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={() => setEditHistoryStore(null)} className="flex-1 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Batal</button>
              <button type="button" onClick={submitEditHistory} disabled={!canSubmitEditHistory || editSaving || clickLocked}
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
