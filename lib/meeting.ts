import { createClient } from '@/lib/supabase/client'

type Supabase = ReturnType<typeof createClient>

export type Branch = { id: string; name: string }
export type Dept = { id: string; name: string }
export type Emp = { id: string; full_name: string; branch_id: string | null; department_id: string | null }

export type AudienceValue = { all: boolean; branchIds: string[]; departmentIds: string[]; employeeIds: string[] }
export const emptyAudience: AudienceValue = { all: false, branchIds: [], departmentIds: [], employeeIds: [] }

export function audienceIsEmpty(v: AudienceValue) {
  return !v.all && v.branchIds.length === 0 && v.departmentIds.length === 0 && v.employeeIds.length === 0
}

export function audienceToTargets(v: AudienceValue): { kind: string; id?: string }[] {
  if (v.all) return [{ kind: 'all' }]
  return [
    ...v.branchIds.map(id => ({ kind: 'branch', id })),
    ...v.departmentIds.map(id => ({ kind: 'department', id })),
    ...v.employeeIds.map(id => ({ kind: 'employee', id })),
  ]
}

// Harus sama persis dengan cara save_meeting_task di database memperluas target jadi daftar orang.
export function expandAudience(v: AudienceValue, employees: Emp[]): Emp[] {
  if (v.all) return employees
  return employees.filter(e =>
    v.employeeIds.includes(e.id)
    || (e.branch_id && v.branchIds.includes(e.branch_id))
    || (e.department_id && v.departmentIds.includes(e.department_id)))
}

export function audienceLabels(
  a: { branch_id: string | null; department_id: string | null; employee_id: string | null }[],
  branches: Branch[], departments: Dept[], employees: Emp[],
): string[] {
  return a.map(x => {
    if (x.branch_id) return branches.find(b => b.id === x.branch_id)?.name ?? 'Cabang'
    if (x.department_id) return departments.find(d => d.id === x.department_id)?.name ?? 'Divisi'
    return employees.find(e => e.id === x.employee_id)?.full_name ?? 'Karyawan'
  })
}

export function wibDate(ts: string | Date): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
}

export function fmtDate(d: string | Date, withYear = true): string {
  const date = typeof d === 'string' && d.length === 10 ? new Date(d + 'T00:00:00+07:00') : new Date(d)
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'Asia/Jakarta' })
}

export function fmtDateTime(ts: string): string {
  return new Date(ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
}

export type MemberStatus = 'open' | 'in_progress' | 'submitted' | 'revision' | 'approved'

export const STATUS_LABEL: Record<MemberStatus, string> = {
  open: 'Belum dikerjakan',
  in_progress: 'Sedang dikerjakan',
  submitted: 'Menunggu review',
  revision: 'Perlu revisi',
  approved: 'Selesai',
}

export const STATUS_STYLE: Record<MemberStatus, string> = {
  open: 'bg-slate-100 text-slate-700 border-slate-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  submitted: 'bg-amber-50 text-amber-800 border-amber-200',
  revision: 'bg-red-50 text-red-700 border-red-200',
  approved: 'bg-green-50 text-green-700 border-green-200',
}

// Telat dihitung dari laporan akhir PERTAMA (bukan yang terakhir), supaya revisi tidak
// menghapus catatan telat -- data ini nanti dipakai untuk KPI.
export function lateInfo(dueDate: string | null, firstFinalAt: string | null): { late: boolean; label: string } {
  if (!dueDate) return { late: false, label: '' }
  if (firstFinalAt) {
    return wibDate(firstFinalAt) > dueDate ? { late: true, label: 'Dilapor telat' } : { late: false, label: '' }
  }
  return wibDate(new Date()) > dueDate ? { late: true, label: 'Telat' } : { late: false, label: '' }
}

// HEIC/HEIF (format default kamera iPhone) tidak bisa ditampilkan <img> di browser
// selain Safari. Kalau resize gagal dan filenya format ini, upload HARUS ditolak --
// jangan diam-diam nyimpen file mentah yang nanti muncul sebagai foto rusak di laporan.
const BROWSER_SAFE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

async function resizeImage(file: File, maxSide = 1600): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  let bmp: ImageBitmap | null = null
  try {
    bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.8))
    if (!blob) throw new Error('Gagal memproses gambar')
    return blob
  } catch (e) {
    if (!BROWSER_SAFE_TYPES.includes(file.type)) {
      throw new Error(`Format foto "${file.type || 'tidak dikenal'}" tidak didukung. Di iPhone, ubah ke Pengaturan > Kamera > Format > "Kompatibel Paling Tinggi", lalu coba lagi.`)
    }
    return file
  } finally {
    bmp?.close()
  }
}

export async function uploadReportPhotos(supabase: Supabase, memberId: string, files: File[]): Promise<string[]> {
  const paths: string[] = []
  for (const f of files) {
    const blob = await resizeImage(f)
    const path = `meeting_tasks/${memberId}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`
    const { error } = await supabase.storage.from('documents').upload(path, blob, { contentType: blob.type || 'image/jpeg' })
    if (error) throw new Error('Gagal unggah foto: ' + error.message)
    paths.push(path)
  }
  return paths
}

export async function signedPhotoUrls(supabase: Supabase, paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths))
  if (unique.length === 0) return {}
  const { data } = await supabase.storage.from('documents').createSignedUrls(unique, 3600)
  const map: Record<string, string> = {}
  ;(data || []).forEach(d => { if (d.path && d.signedUrl) map[d.path] = d.signedUrl })
  return map
}
