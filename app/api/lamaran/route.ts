import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { APPLICANT_STATUS_LABELS } from '@/lib/recruitmentStatusLabels'

// Endpoint publik (tanpa login) — pelamar isi form sendiri di /lamaran.
// Sama seperti app/api/signup/route.ts: pakai service_role di server supaya
// tidak perlu buka RLS anon sama sekali untuk tabel job_applicants.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const GENDER_VALUES = ['male', 'female']
const MARITAL_VALUES = ['single', 'married', 'divorced', 'widowed']
const PLACEMENT_VALUES = ['singaparna', 'tasik_kota']
const MIN_WORK_EXPERIENCE_LENGTH = 10

function normalizePhone(phone: string): string {
  return String(phone).replace(/\D/g, '')
}

async function generateApplicationCode(): Promise<string> {
  const year = new Date().getFullYear()
  for (let i = 0; i < 5; i++) {
    const suffix = Math.floor(1000 + Math.random() * 9000)
    const code = `LMR-${year}-${suffix}`
    const { data } = await supabaseAdmin
      .from('job_applicants')
      .select('id')
      .eq('application_code', code)
      .maybeSingle()
    if (!data) return code
  }
  // Fallback super jarang kepakai — timestamp jamin unik
  return `LMR-${year}-${Date.now().toString().slice(-6)}`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      full_name, gender, birth_place, birth_date, address, phone,
      marital_status, number_of_children, education, work_experience, motivation,
      placement, distance_km, distance_minutes,
    } = body

    if (!full_name || !gender || !phone || !marital_status || !education) {
      return NextResponse.json(
        { error: 'Nama, jenis kelamin, nomor telepon, status perkawinan, dan pendidikan wajib diisi.' },
        { status: 400 }
      )
    }
    if (!PLACEMENT_VALUES.includes(placement)) {
      return NextResponse.json({ error: 'Penempatan cabang wajib dipilih.' }, { status: 400 })
    }
    const distanceKmNum = Number(distance_km)
    const distanceMinutesNum = Number(distance_minutes)
    if (!distance_km || !distance_minutes || !Number.isFinite(distanceKmNum) || !Number.isFinite(distanceMinutesNum) || distanceKmNum < 0 || distanceMinutesNum < 0) {
      return NextResponse.json(
        { error: 'Jarak (KM) dan waktu tempuh (menit) ke titik acuan cabang wajib diisi dengan angka.' },
        { status: 400 }
      )
    }
    if (!work_experience || String(work_experience).trim().length < MIN_WORK_EXPERIENCE_LENGTH) {
      return NextResponse.json(
        { error: 'Pengalaman kerja wajib diisi (minimal 10 karakter). Kalau belum pernah bekerja, tulis "Belum ada pengalaman kerja".' },
        { status: 400 }
      )
    }
    if (!GENDER_VALUES.includes(gender)) {
      return NextResponse.json({ error: 'Jenis kelamin tidak valid.' }, { status: 400 })
    }
    if (!MARITAL_VALUES.includes(marital_status)) {
      return NextResponse.json({ error: 'Status perkawinan tidak valid.' }, { status: 400 })
    }

    // Cegah submit dobel dari nomor HP yang sama selama lamaran sebelumnya masih
    // berjalan. Kalau lamaran sebelumnya sudah "ditolak", tetap boleh melamar lagi.
    const normalizedPhone = normalizePhone(phone)
    const { data: existingRows } = await supabaseAdmin
      .from('job_applicants')
      .select('application_code, phone, status')
    const existing = (existingRows || []).find(
      r => normalizePhone(r.phone) === normalizedPhone && r.status !== 'ditolak'
    )
    if (existing) {
      return NextResponse.json(
        {
          error: `Nomor HP ini sudah pernah mendaftar (kode: ${existing.application_code}, status: ${APPLICANT_STATUS_LABELS[existing.status] || existing.status}). Cek status lamaran Anda di /lamaran/status, atau hubungi HR kalau ini kesalahan.`,
        },
        { status: 400 }
      )
    }

    const application_code = await generateApplicationCode()

    // Langsung lanjut ke screening — kalau HR belum punya pertanyaan screening
    // aktif, tidak ada yang perlu dijawab, jadi langsung ke tahap psikotes.
    const { data: activeQuestions } = await supabaseAdmin
      .from('screening_questions')
      .select('id, question_text')
      .eq('is_active', true)
      .order('sort_order')
    const initialStatus = (activeQuestions || []).length > 0 ? 'screening' : 'psikotes'

    const { data: inserted, error: dbError } = await supabaseAdmin
      .from('job_applicants')
      .insert({
        application_code,
        full_name: String(full_name).trim(),
        gender,
        birth_place: birth_place || null,
        birth_date: birth_date || null,
        address: address || null,
        phone: String(phone).trim(),
        marital_status,
        number_of_children: marital_status === 'married' && number_of_children !== '' ? Number(number_of_children) : null,
        education,
        work_experience: String(work_experience).trim(),
        motivation: motivation || null,
        placement,
        distance_km: distanceKmNum,
        distance_minutes: distanceMinutesNum,
        status: initialStatus,
      })
      .select('id')
      .single()

    if (dbError || !inserted) {
      return NextResponse.json({ error: 'Gagal menyimpan lamaran: ' + (dbError?.message || '') }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      application_code,
      applicant_id: inserted.id,
      status: initialStatus,
      questions: initialStatus === 'screening' ? activeQuestions : [],
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Terjadi kesalahan.' }, { status: 500 })
  }
}
