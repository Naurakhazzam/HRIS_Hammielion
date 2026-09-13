import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { scorePsychometricTest, TestType } from '@/lib/psychometricTests'

// Endpoint publik (tanpa login) — submit jawaban salah satu dari 4 tes
// tambahan (DISC/personality/work_preference/integrity). Beda dari
// /api/lamaran/psikotes: hasil interpretasi DIKIRIM BALIK ke client,
// karena tes-tes ini memang dirancang supaya pelamar bisa lihat
// kecenderungannya sendiri.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const VALID_TEST_TYPES: TestType[] = ['disc', 'personality', 'work_preference', 'integrity']

function normalizePhone(phone: string): string {
  return String(phone).replace(/\D/g, '')
}

export async function POST(req: NextRequest) {
  try {
    const { applicant_id, phone, test_type, answers } = await req.json()

    if (!applicant_id || !phone || !VALID_TEST_TYPES.includes(test_type) || answers === undefined) {
      return NextResponse.json({ error: 'Data tidak lengkap.' }, { status: 400 })
    }

    const { data: applicant } = await supabaseAdmin
      .from('job_applicants')
      .select('id, phone, status')
      .eq('id', applicant_id)
      .maybeSingle()

    if (!applicant || normalizePhone(applicant.phone) !== normalizePhone(phone)) {
      return NextResponse.json({ error: 'Data tidak cocok. Cek lagi nama dan nomor HP Anda.' }, { status: 400 })
    }
    if (applicant.status !== 'psikotes') {
      return NextResponse.json({ error: 'Tahap psikotes untuk lamaran ini sudah tidak aktif.' }, { status: 400 })
    }

    const { data: existing } = await supabaseAdmin
      .from('psychometric_results')
      .select('id')
      .eq('applicant_id', applicant_id)
      .eq('test_type', test_type)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'Tes ini sudah pernah Anda kerjakan sebelumnya.' }, { status: 400 })
    }

    let scored: { raw_scores: unknown; result_summary: unknown }
    try {
      scored = scorePsychometricTest(test_type, answers)
    } catch (scoringError) {
      return NextResponse.json(
        { error: scoringError instanceof Error ? scoringError.message : 'Data jawaban tidak valid.' },
        { status: 400 }
      )
    }

    const { error } = await supabaseAdmin.from('psychometric_results').insert({
      applicant_id,
      test_type,
      raw_scores: scored.raw_scores,
      result_summary: scored.result_summary,
    })

    if (error) {
      return NextResponse.json({ error: 'Gagal menyimpan hasil tes: ' + error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, result_summary: scored.result_summary })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Terjadi kesalahan.' }, { status: 500 })
  }
}
