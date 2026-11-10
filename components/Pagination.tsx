'use client'

// Navigasi halaman sederhana untuk tabel yang datanya sudah ada di client (filter/sort tetap
// dihitung atas SEMUA data, yang dipotong cuma baris yang di-render).
export function Pagination({ page, totalItems, pageSize, onChange }: {
  page: number
  totalItems: number
  pageSize: number
  onChange: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  if (totalItems <= pageSize) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, totalItems)
  const btn = 'px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white'
  return (
    <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 border-t border-slate-200 text-sm">
      <span className="text-slate-500">{from}–{to} dari {totalItems}</span>
      <div className="flex items-center gap-2">
        <button className={btn} disabled={page <= 1} onClick={() => onChange(page - 1)}>‹ Sebelumnya</button>
        <span className="text-slate-600">Hal. {page} / {totalPages}</span>
        <button className={btn} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Berikutnya ›</button>
      </div>
    </div>
  )
}

export function paginate<T>(rows: T[], page: number, pageSize: number): { rows: T[]; page: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const p = Math.min(Math.max(1, page), totalPages)
  return { rows: rows.slice((p - 1) * pageSize, p * pageSize), page: p }
}
