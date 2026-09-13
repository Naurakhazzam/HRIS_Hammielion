import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Endpoint publik (tanpa login) — submit jawaban screening pelamar.
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
    const { applicant_id, phone, answers } = await req.json()
    if (!applicant_id || !phone || !Array.isArray(answers)) {
      return NextResponse.json({ error: 'Data tidak lengkap.' }, { status: 400 })
    }

    // Verifikasi phone cocok dengan applicant_id — jangan cuma modal tebak UUID.
    const { data: applicant } = await supabaseAdmin
      .from('job_applicants')
      .select('id, phone, status')
      .eq('id', applicant_id)
      .maybeSingle()

    if (!applicant || normalizePhone(applicant.phone) !== normalizePhone(phone)) {
      return NextResponse.json({ error: 'Data tidak cocok. Cek lagi nama dan nomor HP Anda.' }, { status: 400 })
    }
    if (applicant.status !== 'screening') {
      return NextResponse.json({ error: 'Tahap screening untuk lamaran ini sudah tidak aktif.' }, { status: 400 })
    }

    const rows = answers
      .filter((a: { question_id?: string }) => a && a.question_id)
      .map((a: { question_id: string; answer_text?: string }) => ({
        applicant_id,
        question_id: a.question_id,
        answer_text: (a.answer_text || '').trim(),
      }))

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Belum ada jawaban yang diisi.' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('screening_answers')
      .upsert(rows, { onConflict: 'applicant_id,question_id' })

    if (error) {
      return NextResponse.json({ error: 'Gagal menyimpan jawaban: ' + error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Terjadi kesalahan.' }, { status: 500 })
  }
}
