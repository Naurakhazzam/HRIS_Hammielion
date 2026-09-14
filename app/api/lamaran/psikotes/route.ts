import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { PSYCHOTEST_LEVELS, PSYCHOTEST_MAX_PLAUSIBLE_QUESTIONS } from '@/lib/psychotestLevels'
import { advanceToInterviewIfComplete } from '@/lib/server/recruitmentTransitions'

// Endpoint publik (tanpa login) — submit hasil tes hitung cepat, SATU LEVEL
// per panggilan (bukan ketiganya sekaligus di akhir) — supaya kalau koneksi
// putus di tengah jalan, level yang sudah selesai tidak ikut hilang. Skor
// akhir baru dihitung & disimpan setelah ketiga level lengkap di server.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

function normalizePhone(phone: string): string {
  return String(phone).replace(/\D/g, '')
}

export async function POST(req: NextRequest) {
  try {
    const { applicant_id, phone, level, questions, correct } = await req.json()

    if (
      !applicant_id || !phone || typeof level !== 'number' ||
      typeof questions !== 'number' || typeof correct !== 'number'
    ) {
      return NextResponse.json({ error: 'Data tidak lengkap.' }, { status: 400 })
    }

    const levelConfig = PSYCHOTEST_LEVELS.find(l => l.level === level)
    if (!levelConfig) {
      return NextResponse.json({ error: 'Level tidak dikenali.' }, { status: 400 })
    }
    if (questions < 0 || correct < 0 || correct > questions || questions > PSYCHOTEST_MAX_PLAUSIBLE_QUESTIONS) {
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

    const { data: existingResult } = await supabaseAdmin
      .from('psychotest_results')
      .select('id')
      .eq('applicant_id', applicant_id)
      .maybeSingle()
    if (existingResult) {
      return NextResponse.json({ error: 'Tes sudah pernah Anda kerjakan sebelumnya.' }, { status: 400 })
    }

    const { data: existingLevel } = await supabaseAdmin
      .from('psychotest_level_progress')
      .select('id')
      .eq('applicant_id', applicant_id)
      .eq('level', level)
      .maybeSingle()
    if (existingLevel) {
      return NextResponse.json({ error: 'Level ini sudah pernah disimpan sebelumnya.' }, { status: 400 })
    }

    const { error: insertError } = await supabaseAdmin.from('psychotest_level_progress').insert({
      applicant_id, level, questions, correct,
    })
    if (insertError) {
      return NextResponse.json({ error: 'Gagal menyimpan hasil level: ' + insertError.message }, { status: 500 })
    }

    const { data: allProgress } = await supabaseAdmin
      .from('psychotest_level_progress')
      .select('level, questions, correct')
      .eq('applicant_id', applicant_id)

    const allLevelsDone = (allProgress || []).length >= PSYCHOTEST_LEVELS.length

    if (allLevelsDone) {
      const normalizedLevels = PSYCHOTEST_LEVELS.map(cfg => {
        const p = (allProgress || []).find(row => row.level === cfg.level)!
        const accuracy = p.questions > 0 ? p.correct / p.questions : 0
        const throughput_ratio = Math.min(1, p.questions / cfg.targetQuestions)
        const level_score = accuracy * 0.6 + throughput_ratio * 0.4
        return {
          level: cfg.level, min: cfg.min, max: cfg.max, questions: p.questions, correct: p.correct,
          accuracy, target_questions: cfg.targetQuestions, throughput_ratio, level_score,
        }
      })

      const [acc1, , acc3] = normalizedLevels.map(l => l.accuracy)
      const [score1, score2, score3] = normalizedLevels.map(l => l.level_score)
      const totalQuestions = normalizedLevels.reduce((sum, l) => sum + l.questions, 0)
      const totalCorrect = normalizedLevels.reduce((sum, l) => sum + l.correct, 0)
      const overall_accuracy = totalQuestions > 0 ? totalCorrect / totalQuestions : 0
      // Skor akhir gabungan ketepatan (60%) + kecepatan relatif terhadap target
      // per level (40%), dibobot makin berat di level yang lebih sulit.
      const score = Math.round(score1 * 20 + score2 * 30 + score3 * 50)
      // Resilience murni soal ketepatan (bukan kecepatan) — apakah presisi
      // bertahan waktu soal makin susah, terpisah dari soal cepat/lambat.
      const resilience = acc1 > 0 ? Math.min(1, acc3 / acc1) : (acc3 > 0 ? 1 : 0)

      const { error: resultError } = await supabaseAdmin.from('psychotest_results').insert({
        applicant_id, levels: normalizedLevels, overall_accuracy, resilience, score,
      })
      if (resultError) {
        return NextResponse.json({ error: 'Gagal menyimpan hasil akhir: ' + resultError.message }, { status: 500 })
      }

      await advanceToInterviewIfComplete(supabaseAdmin, applicant_id)
    }

    return NextResponse.json({ success: true, allLevelsDone })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Terjadi kesalahan.' }, { status: 500 })
  }
}
