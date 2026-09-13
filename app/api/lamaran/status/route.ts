import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Endpoint publik (tanpa login) — pelamar cek status pakai Nama + No HP,
// bukan akun. Sama seperti app/api/lamaran/route.ts: service_role di server,
// tidak ada RLS anon ke job_applicants/screening_questions/screening_answers.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const NOTICE = 'Pastikan nama lengkap dan nomor HP yang Anda masukkan sama persis dengan yang didaftarkan. Kalau tetap tidak ditemukan, hubungi HR.'

function normalizePhone(phone: string): string {
  return String(phone).replace(/\D/g, '')
}

export async function POST(req: NextRequest) {
  try {
    const { full_name, phone } = await req.json()
    if (!full_name || !phone) {
      return NextResponse.json({ found: false, notice: NOTICE }, { status: 400 })
    }

    const normalizedPhone = normalizePhone(phone)
    const { data: candidates } = await supabaseAdmin
      .from('job_applicants')
      .select('id, application_code, full_name, phone, status')

    // Cari nama + HP dulu (paling akurat), fallback ke HP saja kalau nama typo.
    const nameNorm = String(full_name).trim().toLowerCase()
    let applicant = (candidates || []).find(
      c => normalizePhone(c.phone) === normalizedPhone && c.full_name.trim().toLowerCase() === nameNorm
    )
    if (!applicant) {
      applicant = (candidates || []).find(c => normalizePhone(c.phone) === normalizedPhone)
    }

    if (!applicant) {
      return NextResponse.json({ found: false, notice: NOTICE })
    }

    let questions: { id: string; question_text: string }[] = []
    let existing_answers: Record<string, string> = {}
    let psychotest_done = false

    if (applicant.status === 'screening') {
      const { data: qData } = await supabaseAdmin
        .from('screening_questions')
        .select('id, question_text')
        .eq('is_active', true)
        .order('sort_order')
      questions = qData || []

      const { data: aData } = await supabaseAdmin
        .from('screening_answers')
        .select('question_id, answer_text')
        .eq('applicant_id', applicant.id)
      existing_answers = Object.fromEntries((aData || []).map(a => [a.question_id, a.answer_text || '']))
    }

    if (applicant.status === 'psikotes') {
      const { data: resultData } = await supabaseAdmin
        .from('psychotest_results')
        .select('id')
        .eq('applicant_id', applicant.id)
        .maybeSingle()
      psychotest_done = !!resultData
    }

    return NextResponse.json({
      found: true,
      applicant_id: applicant.id,
      full_name: applicant.full_name,
      application_code: applicant.application_code,
      status: applicant.status,
      notice: NOTICE,
      questions,
      existing_answers,
      psychotest_done,
    })
  } catch (err) {
    return NextResponse.json(
      { found: false, notice: err instanceof Error ? err.message : 'Terjadi kesalahan.' },
      { status: 500 }
    )
  }
}
