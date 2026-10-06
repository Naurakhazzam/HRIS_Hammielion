'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import LogisticsCameraCapture from '@/components/LogisticsCameraCapture'
import { usePhotoLightbox } from '@/components/PhotoLightbox'

type ReturnRow = {
  id: string
  note: string | null
  final_photo_url: string | null
  final_location_note: string | null
  received_by: string | null
  received_at: string | null
  received_photo_url: string | null
  recipient_branch_id: string | null
  no_items_reason: string | null
  logistics_stores: { name: string } | null
  branches: { name: string } | null
  finisher: { full_name: string } | null
  receiver: { full_name: string } | null
}

type ReturnItem = { id: string; return_id: string; photo_url: string; item_name: string; reason: string }

const fmtDateTime = (s: string) => new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function PenerimaanReturPage() {
  const supabase = createClient()
  const { openLightbox } = usePhotoLightbox()

  const [loading, setLoading] = useState(true)
  const [canView, setCanView] = useState(false)
  const [myName, setMyName] = useState('')
  // Dipakai utk gerbang tombol "Terima" di sisi tampilan -- cuma pelengkap, proteksi sungguhan
  // tetap di RPC receive_store_return (cek cabang vs recipient_branch_id, atau Owner).
  const [isOwner, setIsOwner] = useState(false)
  const [myBranchId, setMyBranchId] = useState<string | null>(null)

  const [pending, setPending] = useState<ReturnRow[]>([])
  const [history, setHistory] = useState<ReturnRow[]>([])
  const [itemsByReturn, setItemsByReturn] = useState<Record<string, ReturnItem[]>>({})
  const [receivingId, setReceivingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  const fetchReturns = useCallback(async () => {
    const { data } = await supabase.from('logistics_store_returns')
      .select(`
        id, note, final_photo_url, final_location_note, received_by, received_at, received_photo_url, recipient_branch_id, no_items_reason,
        logistics_stores(name), branches(name),
        finisher:employees!logistics_store_returns_finished_by_fkey(full_name),
        receiver:employees!logistics_store_returns_received_by_fkey(full_name)
      `)
      .eq('status', 'selesai')
      .order('finished_at', { ascending: false })
    const rows = (data as unknown as ReturnRow[]) || []
    // Retur "toko tidak ada barang" tidak ada yang diserahterimakan -- langsung masuk riwayat.
    setPending(rows.filter(r => !r.received_at && !r.no_items_reason))
    setHistory(rows.filter(r => r.received_at || r.no_items_reason))

    if (rows.length > 0) {
      const { data: items } = await supabase.from('logistics_store_return_items')
        .select('id, return_id, photo_url, item_name, reason')
        .in('return_id', rows.map(r => r.id)).order('captured_at')
      const grouped: Record<string, ReturnItem[]> = {}
      ;(items as ReturnItem[] || []).forEach(it => {
        if (!grouped[it.return_id]) grouped[it.return_id] = []
        grouped[it.return_id].push(it)
      })
      setItemsByReturn(grouped)
    } else {
      setItemsByReturn({})
    }
  }, [supabase])

  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: userData } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
        if (userData) {
          if (userData.role === 'owner') { setIsOwner(true); setCanView(true) }
          else if (userData.employee_id) {
            const { data: emp } = await supabase.from('employees')
              .select('full_name, branch_id, positions(name), branches(name)')
              .eq('id', userData.employee_id).single()
            setMyName((emp as any)?.full_name || '')
            setMyBranchId((emp as any)?.branch_id || null)
            const posName = (emp as any)?.positions?.name
            const branchName = (emp as any)?.branches?.name
            setCanView(posName === 'Kepala Gudang' || branchName === 'Toko Pusat')
          }
        }
      }
      await fetchReturns()
      setLoading(false)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function uploadReceiptPhoto(returnId: string, blob: Blob): Promise<string | null> {
    const path = `${returnId}/penerimaan-${Date.now()}.jpg`
    const { error } = await supabase.storage.from('logistics-photos').upload(path, blob, { contentType: 'image/jpeg' })
    if (error) { showMessage('error', 'Gagal unggah foto: ' + error.message); return null }
    const { data } = supabase.storage.from('logistics-photos').getPublicUrl(path)
    return data.publicUrl
  }

  async function handleReceive(r: ReturnRow, blob: Blob) {
    setReceivingId(r.id)
    const url = await uploadReceiptPhoto(r.id, blob)
    if (!url) { setReceivingId(null); return }
    const { error } = await supabase.rpc('receive_store_return', { p_return_id: r.id, p_photo_url: url })
    setReceivingId(null)
    if (error) { showMessage('error', 'Gagal konfirmasi penerimaan: ' + error.message); return }
    showMessage('success', `Retur "${r.logistics_stores?.name}" berhasil ditandai diterima.`)
    await fetchReturns()
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Penerimaan Retur</h1>
      <p className="text-sm text-slate-500 mb-6">Konfirmasi barang retur yang sudah diantar driver sampai ke cabang tujuan.</p>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {!canView ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
          Halaman ini khusus Kepala Gudang, Owner, atau Team Toko Pusat.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <p className="text-sm font-bold text-slate-700">📥 Menunggu Diterima ({pending.length})</p>
            </div>
            {pending.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">Tidak ada retur yang menunggu diterima saat ini.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {pending.map(r => {
                  const items = itemsByReturn[r.id] || []
                  const canReceive = isOwner || (!!myBranchId && myBranchId === r.recipient_branch_id)
                  return (
                    <div key={r.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-800">{r.logistics_stores?.name}</p>
                        <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">untuk {r.branches?.name ?? '-'}</span>
                      </div>
                      {r.note && <p className="text-xs text-slate-500 mt-0.5">Catatan: {r.note}</p>}
                      {r.finisher?.full_name && <p className="text-xs text-slate-400 mt-0.5">Diantar oleh {r.finisher.full_name}</p>}
                      {r.final_location_note && <p className="text-xs text-slate-500 mt-1">Posisi menurut driver: {r.final_location_note}</p>}

                      {(items.length > 0 || r.final_photo_url) && (
                        <div className="flex gap-3 mt-2 flex-wrap">
                          {items.map(it => (
                            <button key={it.id} type="button" onClick={() => openLightbox(it.photo_url, it.item_name)} title={`${it.item_name} — ${it.reason}`} className="flex flex-col items-center gap-1">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={it.photo_url} alt={it.item_name} className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                              <span className="text-[10px] text-slate-500 font-medium truncate max-w-[56px]">{it.item_name}</span>
                            </button>
                          ))}
                          {r.final_photo_url && (
                            <button type="button" onClick={() => openLightbox(r.final_photo_url!, 'Posisi akhir barang')} title="Posisi Akhir (Driver)" className="flex flex-col items-center gap-1">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={r.final_photo_url} alt="Posisi akhir barang" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                              <span className="text-[10px] text-slate-500 font-medium">Posisi Akhir</span>
                            </button>
                          )}
                        </div>
                      )}

                      <div className="mt-3">
                        {canReceive ? (
                          <LogisticsCameraCapture label="Foto Terima Barang" employeeName={myName}
                            onCaptured={blob => handleReceive(r, blob)} />
                        ) : (
                          <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                            Cuma karyawan di cabang {r.branches?.name ?? '-'} atau Owner yang bisa konfirmasi terima barang ini.
                          </p>
                        )}
                        {receivingId === r.id && <p className="text-xs text-slate-400 mt-1">Menyimpan...</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {history.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                <p className="text-sm font-bold text-slate-700">✓ Riwayat ({history.length})</p>
              </div>
              <div className="divide-y divide-slate-100">
                {history.map(r => (
                  <div key={r.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-sm font-medium text-slate-700">{r.logistics_stores?.name}</p>
                      {r.no_items_reason ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">Tidak ada barang</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 font-medium">untuk {r.branches?.name ?? '-'}</span>
                      )}
                    </div>
                    {r.no_items_reason ? (
                      <p className="text-xs text-slate-500 mt-0.5">
                        Kata driver ({r.finisher?.full_name ?? '-'}): {r.no_items_reason}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400 mt-0.5">
                        Diterima {r.receiver?.full_name ?? '-'}{r.received_at ? ` · ${fmtDateTime(r.received_at)}` : ''}
                      </p>
                    )}
                    {r.no_items_reason && r.final_photo_url && (
                      <button type="button" onClick={() => openLightbox(r.final_photo_url!, 'Foto toko')} className="mt-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.final_photo_url} alt="Foto toko" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                      </button>
                    )}
                    {r.received_photo_url && (
                      <button type="button" onClick={() => openLightbox(r.received_photo_url!, 'Foto terima barang')} className="mt-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.received_photo_url} alt="Foto terima barang" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
