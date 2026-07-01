import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeToMinutes(t: string): number {
  const [h, m] = t.substring(0, 5).split(':').map(Number)
  return h * 60 + m
}

function parsePeriod(rawData: string[][]): {
  startMonth: number; startDay: number; startYear: number
  endMonth: number;   endDay: number;   endYear: number
} | null {
  // Row 2, col 25: "Attendance date:05-26-2026~06-25-2026"
  for (let col = 0; col < (rawData[2]?.length ?? 0); col++) {
    const str = String(rawData[2][col] || '')
    const m = str.match(/(\d{2})-(\d{2})-(\d{4})~(\d{2})-(\d{2})-(\d{4})/)
    if (m) {
      return {
        startMonth: parseInt(m[1]), startDay: parseInt(m[2]), startYear: parseInt(m[3]),
        endMonth:   parseInt(m[4]), endDay:   parseInt(m[5]), endYear:   parseInt(m[6]),
      }
    }
  }
  return null
}

function dayToDate(
  day: number,
  p: { startMonth: number; startDay: number; startYear: number; endMonth: number; endDay: number; endYear: number }
): string {
  const year  = day >= p.startDay ? p.startYear  : p.endYear
  const month = day >= p.startDay ? p.startMonth : p.endMonth
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function matchSchedule(checkInStr: string, schedules: any[]): any | null {
  if (!schedules.length) return null
  const sorted = [...schedules].sort((a, b) => {
    if (!a.detect_until) return 1
    if (!b.detect_until) return -1
    return a.detect_until.localeCompare(b.detect_until)
  })
  return (
    sorted.find(s => !s.detect_until || checkInStr <= s.detect_until.substring(0, 5)) ??
    sorted[sorted.length - 1]
  )
}

// ─── POST /api/attendance/import ────────────────────────────────────────────
// Menerima file XLS, parse, cocokkan dengan karyawan, kembalikan preview JSON
// tanpa menyimpan ke database.

export async function POST(req: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: currentUser } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (!currentUser || !['owner', 'hr', 'finance'].includes(currentUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // Ambil file dari form data
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'File tidak ditemukan.' }, { status: 400 })

    // Parse XLS
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const ws = workbook.Sheets[workbook.SheetNames[0]]
    const rawData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })

    // Validasi format
    const period = parsePeriod(rawData)
    if (!period) {
      return NextResponse.json({
        error: 'Format file tidak dikenali. Pastikan file adalah hasil export mesin fingerprint.'
      }, { status: 400 })
    }

    // Load data dari Supabase
    const [{ data: employees }, { data: schedules }] = await Promise.all([
      supabase.from('employees').select('id, full_name, fingerprint_id, department_id').not('fingerprint_id', 'is', null),
      supabase.from('work_schedules').select('check_in_time, check_out_time, detect_until, allow_overtime, applies_to_dept'),
    ])

    // Build lookup maps
    const empMap = new Map((employees ?? []).map(e => [e.fingerprint_id as number, e]))
    const schedMap = new Map<string, any[]>()
    for (const s of schedules ?? []) {
      if (!schedMap.has(s.applies_to_dept)) schedMap.set(s.applies_to_dept, [])
      schedMap.get(s.applies_to_dept)!.push(s)
    }

    // Parse blok per karyawan
    const employeeResults: any[] = []
    const records: any[] = []
    let row = 0

    while (row < rawData.length) {
      const cells = rawData[row]
      if (String(cells?.[4]) !== 'User ID:') { row++; continue }

      const fingerprintId = parseInt(String(cells[5]))
      const nameInFile    = String(cells[11] || '').trim() || '(tanpa nama)'
      const dateRow       = rawData[row + 1] ?? []

      // Kumpulkan baris data sampai blok berikutnya
      const dataRows: string[][] = []
      let r = row + 2
      while (r < rawData.length && String(rawData[r]?.[4]) !== 'User ID:') {
        dataRows.push(rawData[r] as string[])
        r++
      }

      const emp = empMap.get(fingerprintId)
      if (!emp) {
        employeeResults.push({ fingerprintId, nameInFile, status: 'not_found', recordCount: 0 })
        row = r; continue
      }

      const deptSchedules = schedMap.get(emp.department_id) ?? []
      let recordCount = 0

      for (let col = 1; col < dateRow.length; col++) {
        const dayVal = parseFloat(String(dateRow[col]))
        if (isNaN(dayVal)) continue

        // Kumpulkan semua punch hari ini dari semua baris data
        const punches: string[] = []
        for (const dr of dataRows) {
          const val = String(dr[col] ?? '').trim()
          if (!val) continue
          val.split('\n')
            .map(t => t.trim())
            .filter(t => /^\d{2}:\d{2}$/.test(t))
            .forEach(t => punches.push(t))
        }
        if (!punches.length) continue

        const dateStr    = dayToDate(Math.round(dayVal), period)
        const checkInStr  = punches[0]
        const checkOutStr = punches.length > 1 ? punches[punches.length - 1] : null

        // Cocokkan jadwal
        const sched = matchSchedule(checkInStr, deptSchedules)

        // Hitung keterlambatan
        let lateMinutes = 0
        if (sched) {
          const diff = timeToMinutes(checkInStr) - timeToMinutes(sched.check_in_time)
          lateMinutes = Math.max(0, diff)
        }

        // Hitung lembur
        let overtimeHours = 0
        if (sched?.allow_overtime && checkOutStr) {
          const diffMins = timeToMinutes(checkOutStr) - timeToMinutes(sched.check_out_time)
          if (diffMins > 59) overtimeHours = Math.round((diffMins / 60) * 2) / 2
        }

        records.push({
          employee_id:    emp.id,
          date:           dateStr,
          check_in:       `${dateStr}T${checkInStr}:00+07:00`,
          check_out:      checkOutStr ? `${dateStr}T${checkOutStr}:00+07:00` : null,
          late_minutes:   lateMinutes,
          overtime_hours: overtimeHours,
          status:         'present',
          notes:          'Import fingerprint',
        })
        recordCount++
      }

      employeeResults.push({
        fingerprintId,
        nameInFile,
        nameInHris: emp.full_name,
        employeeId: emp.id,
        status: 'matched',
        recordCount,
      })
      row = r
    }

    const periodLabel =
      `${period.startYear}-${String(period.startMonth).padStart(2,'0')}-${String(period.startDay).padStart(2,'0')}` +
      ` s/d ` +
      `${period.endYear}-${String(period.endMonth).padStart(2,'0')}-${String(period.endDay).padStart(2,'0')}`

    return NextResponse.json({
      period:       periodLabel,
      employees:    employeeResults,
      records,
      totalRecords: records.length,
      matchedCount: employeeResults.filter(e => e.status === 'matched').length,
      notFoundCount: employeeResults.filter(e => e.status === 'not_found').length,
    })

  } catch (err: any) {
    console.error('[import/route]', err)
    return NextResponse.json({ error: err.message ?? 'Terjadi kesalahan.' }, { status: 500 })
  }
}
