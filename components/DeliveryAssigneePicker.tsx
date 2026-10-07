'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

// Calon pengantar kiriman (Laporan Muat jalur antar sendiri, jemput/antar Order Grooming):
// karyawan aktif 4 cabang toko yang punya akun aplikasi -- lintas cabang boleh. Sumbernya RPC
// list_store_delivery_candidates (migrasi 068), bukan query employees langsung, karena RLS
// employees tidak membuka karyawan cabang lain.
export type DeliveryCandidate = { id: string; full_name: string; branch_id: string; branch_name: string }

export async function fetchDeliveryCandidates(supabase: SupabaseClient): Promise<DeliveryCandidate[]> {
  const { data } = await supabase.rpc('list_store_delivery_candidates')
  return (data as DeliveryCandidate[]) || []
}

const labelOf = (c: DeliveryCandidate) => `${c.full_name} — ${c.branch_name}`

type Props = {
  candidates: DeliveryCandidate[]
  value: string
  onChange: (employeeId: string) => void
  excludeId?: string | null
  placeholder?: string
}

/** Kolom ketik-cari pengantar; menampilkan nama + cabang. `value` = employee id ('' = belum valid).
 *  Daftar saran dirender sendiri (bukan <datalist>) -- saran <datalist> tidak muncul di banyak
 *  browser HP Android / browser dalam aplikasi, jadi karyawan mengetik nama tapi tidak ada apa-apa. */
export default function DeliveryAssigneePicker({ candidates, value, onChange, excludeId, placeholder }: Props) {
  const options = candidates.filter(c => c.id !== excludeId)
  const selected = options.find(c => c.id === value)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)

  const q = text.trim().toLowerCase()
  const matches = (q ? options.filter(c => labelOf(c).toLowerCase().includes(q)) : options).slice(0, 12)

  function pick(c: DeliveryCandidate) {
    onChange(c.id)
    setText('')
    setOpen(false)
  }

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2 border border-green-300 bg-green-50 rounded-lg">
        <p className="text-sm text-green-800">✓ <b>{selected.full_name}</b> <span className="text-xs">({selected.branch_name})</span></p>
        <button type="button" onClick={() => { onChange(''); setOpen(true) }} className="text-xs text-blue-600 shrink-0">Ganti</button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input type="text" value={text} onChange={e => { setText(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? 'Ketik nama pengantar...'}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg divide-y divide-slate-100">
          {candidates.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">Daftar karyawan belum termuat — muat ulang halaman.</p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">Tidak ada nama yang cocok.</p>
          ) : matches.map(c => (
            // onMouseDown (bukan onClick) supaya terpilih sebelum input kehilangan fokus.
            <button key={c.id} type="button" onMouseDown={e => { e.preventDefault(); pick(c) }}
              className="w-full text-left px-3 py-2 hover:bg-blue-50">
              <span className="text-sm text-slate-800">{c.full_name}</span>
              <span className="text-xs text-slate-500"> — {c.branch_name}</span>
            </button>
          ))}
        </div>
      )}
      {!open && text.trim() && <p className="text-xs text-red-600 mt-1">Pilih nama dari daftar.</p>}
    </div>
  )
}
