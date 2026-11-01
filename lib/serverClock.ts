import type { SupabaseClient } from '@supabase/supabase-js'
import { wibDateStr } from '@/lib/date'

/**
 * Jam server untuk tampilan di HP. Jam HP bisa dimundurkan/dimajukan karyawan, jadi semua yang
 * TAMPIL di alur absen (jam di foto, tanggal "hari ini", hitung mundur absen pulang, dll) pakai
 * jam server: selisih jam HP vs server diukur sekali lewat RPC server_now(), lalu
 * serverNow() = jam HP + selisih itu. Yang TERSIMPAN tetap dipaksa now() oleh database
 * (trigger migr 113) -- ini cuma supaya yang dilihat karyawan sama dengan yang tercatat.
 */
let offsetMs = 0

export async function syncServerClock(supabase: SupabaseClient): Promise<Date | null> {
  const t0 = Date.now()
  const { data, error } = await supabase.rpc('server_now')
  const t1 = Date.now()
  if (error || !data) return null
  const server = new Date(data as string)
  // Respons server dianggap terjadi di tengah-tengah perjalanan request.
  offsetMs = server.getTime() - (t0 + t1) / 2
  return server
}

export function serverNow(): Date {
  return new Date(Date.now() + offsetMs)
}

/** Tanggal hari ini menurut jam server, WIB, format "YYYY-MM-DD". */
export function serverTodayStr(): string {
  return wibDateStr(serverNow())
}
