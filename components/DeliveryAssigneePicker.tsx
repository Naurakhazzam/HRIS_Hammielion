'use client'

import { useId, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

// Calon pengantar kiriman (Laporan Muat jalur antar sendiri): karyawan aktif 4 cabang toko yang
// punya akun aplikasi -- lintas cabang boleh. Sumbernya RPC list_store_delivery_candidates
// (migrasi 068), bukan query employees langsung, karena RLS employees tidak membuka karyawan
// cabang lain.
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

/** Kolom ketik-cari pengantar; menampilkan nama + cabang. `value` = employee id ('' = belum valid). */
export default function DeliveryAssigneePicker({ candidates, value, onChange, excludeId, placeholder }: Props) {
  const listId = useId()
  const options = candidates.filter(c => c.id !== excludeId)
  const selected = options.find(c => c.id === value)
  const [text, setText] = useState(selected ? labelOf(selected) : '')

  function handleText(v: string) {
    setText(v)
    const norm = v.trim().toLowerCase()
    const exact = options.find(c => labelOf(c).toLowerCase() === norm)
      // Ketik nama saja juga diterima kalau cuma ada 1 orang dengan nama itu.
      ?? (() => { const byName = options.filter(c => c.full_name.toLowerCase() === norm); return byName.length === 1 ? byName[0] : undefined })()
    onChange(exact?.id ?? '')
  }

  return (
    <div>
      <input type="text" list={listId} value={text} onChange={e => handleText(e.target.value)}
        placeholder={placeholder ?? 'Ketik nama pengantar...'}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
      <datalist id={listId}>
        {options.map(c => <option key={c.id} value={labelOf(c)} />)}
      </datalist>
      {selected ? (
        <p className="text-xs text-green-700 mt-1">✓ Pengantar: <b>{selected.full_name}</b> ({selected.branch_name})</p>
      ) : text.trim() ? (
        <p className="text-xs text-red-600 mt-1">Pilih nama dari daftar yang muncul.</p>
      ) : null}
    </div>
  )
}
