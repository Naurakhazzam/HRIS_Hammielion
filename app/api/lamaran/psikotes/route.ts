import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { PSYCHOTEST_LEVELS, PSYCHOTEST_MAX_PLAUSIBLE_QUESTIONS } from '@/lib/psychotestLevels'

// Endpoint publik (tanpa login) — submit hasil tes hitung cepat 3 level
// (gaya Kraepelin). Skor dihitung di server, bukan dipercaya dari client.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

function normalizePhone(phone: string): string {
  return String(phone).replace(/\D/g, '')
}

type LevelSubmission = { level: number; questions: number; correct: number }

export async function POST(req: NextRequest) {
  try {
    const { applicant_id, phone, levels } = await req.json()

    if (!applicant_id || !phone || !Array.isArray(levels)) {
      return NextResponse.json({ error: 'Data tidak lengkap.' }, { status: 400 })
    }

    // Validasi tiap level yang dikirim cocok persis dengan konfigurasi resmi —
    // supaya client tidak bisa mengklaim level yang salah atau soal fiktif.
    if (levels.length !== PSYCHOTEST_LEVELS.length) {
      return NextResponse.json({ error: 'Data hasil tes tidak lengkap.' }, { status: 400 })
    }
    const byLevel = new Map<number, LevelSubmission>()
    for (const entry of levels as LevelSubmission[]) {
      if (
        !entry || typeof entry.level !== 'number' ||
        typeof entry.questions !== 'number' || typeof entry.correct !== 'number'
      ) {
        return NextResponse.json({ error: 'Data hasil tes tidak valid.' }, { status: 400 })
      }
      byLevel.set(entry.level, entry)
    }
    const normalizedLevels: { level: number; min: number; max: number; questions: number; correct: number; accuracy: number }[] = []
    for (const cfg of PSYCHOTEST_LEVELS) {
      const entry = byLevel.get(cfg.level)
      if (!entry) {
        return NextResponse.json({ error: 'Data hasil tes tidak lengkap.' }, { status: 400 })
      }
      if (
        entry.questions < 0 || entry.correct < 0 || entry.correct > entry.questions ||
        entry.questions > PSYCHOTEST_MAX_PLAUSIBLE_QUESTIONS
      ) {
        return NextResponse.json({ error: 'Data hasil tes tidak valid.' }, { status: 400 })
      }
      normalizedLevels.push({
        level: cfg.level,
        min: cfg.min,
        max: cfg.max,
        questions: entry.questions,
        correct: entry.correct,
        accuracy: entry.questions > 0 ? entry.correct / entry.questions : 0,
      })
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

    const [acc1, acc2, acc3] = normalizedLevels.map(l => l.accuracy)
    const totalQuestions = normalizedLevels.reduce((sum, l) => sum + l.questions, 0)
    const totalCorrect = normalizedLevels.reduce((sum, l) => sum + l.correct, 0)
    const overall_accuracy = totalQuestions > 0 ? totalCorrect / totalQuestions : 0
    const score = Math.round(acc1 * 20 + acc2 * 30 + acc3 * 50)
    const resilience = acc1 > 0 ? Math.min(1, acc3 / acc1) : (acc3 > 0 ? 1 : 0)

    const { error } = await supabaseAdmin.from('psychotest_results').insert({
      applicant_id,
      levels: normalizedLevels,
      overall_accuracy,
      resilience,
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
