import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Endpoint publik (tanpa login) — submit hasil tes hitung cepat (gaya
// Kraepelin) pelamar. Skor dihitung di server, bukan dipercaya dari client.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

function normalizePhone(phone: string): string {
  return String(phone).replace(/\D/g, '')
}

type IntervalStat = { interval: number; questions: number; correct: number }

export async function POST(req: NextRequest) {
  try {
    const { applicant_id, phone, total_questions, correct_count, wrong_count, interval_stats } = await req.json()

    if (
      !applicant_id || !phone ||
      typeof total_questions !== 'number' || typeof correct_count !== 'number' || typeof wrong_count !== 'number' ||
      !Array.isArray(interval_stats)
    ) {
      return NextResponse.json({ error: 'Data tidak lengkap.' }, { status: 400 })
    }
    if (total_questions < 0 || correct_count < 0 || wrong_count < 0 || correct_count + wrong_count !== total_questions) {
      return NextResponse.json({ error: 'Data hasil tes tidak valid.' }, { status: 400 })
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
      .from('psychotest_results')
      .select('id')
      .eq('applicant_id', applicant_id)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'Tes sudah pernah Anda kerjakan sebelumnya.' }, { status: 400 })
    }

    const accuracy = total_questions > 0 ? correct_count / total_questions : 0
    const counts = (interval_stats as IntervalStat[]).map(s => s.questions).filter(n => typeof n === 'number')
    const maxCount = counts.length > 0 ? Math.max(...counts) : 0
    const minCount = counts.length > 0 ? Math.min(...counts) : 0
    const stability = maxCount > 0 ? minCount / maxCount : 0
    const score = Math.round(accuracy * 60 + stability * 40)

    const { error } = await supabaseAdmin.from('psychotest_results').insert({
      applicant_id,
      total_questions,
      correct_count,
      wrong_count,
      interval_stats,
      accuracy,
      stability,
      score,
    })

    if (error) {
      return NextResponse.json({ error: 'Gagal menyimpan hasil tes: ' + error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Terjadi kesalahan.' }, { status: 500 })
  }
}
