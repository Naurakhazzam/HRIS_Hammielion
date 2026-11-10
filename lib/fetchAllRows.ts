// PostgREST (Supabase) diam-diam memotong hasil select di 1000 baris (max-rows). Query daftar
// yang tidak dibatasi periode bisa kehilangan data tanpa error begitu tabelnya > 1000 baris.
// Helper ini mengambil per batch pakai .range() sampai habis.
//
// WAJIB: query yang dibangun harus punya urutan deterministik (mis. .order('created_at').order('id')),
// kalau tidak baris bisa dobel/terlewat antar batch.
type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export async function fetchAllRows<T>(
  build: (from: number, to: number) => PageResult<T>,
  batchSize = 1000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = []
  for (let from = 0; ; from += batchSize) {
    const { data, error } = await build(from, from + batchSize - 1)
    if (error) return { data: out, error }
    const rows = data || []
    out.push(...rows)
    if (rows.length < batchSize) return { data: out, error: null }
  }
}
