import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Endpoint publik (tanpa login) — kandidat buka undangan interview lewat link personal
// berisi token acak (bukan nama+HP seperti /api/lamaran/status), jadi link ini aman dikirim
// langsung lewat WhatsApp tanpa perlu verifikasi tambahan. Service role di server, sama
// seperti pola app/api/lamaran/status/route.ts — job_applicants tidak punya RLS anon sama sekali.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function findByToken(token: string) {
  const { data } = await supabaseAdmin
    .from('job_applicants')
    .select('id, full_name, application_code, interview_confirmation, interview_confirmed_at, test_impression')
    .eq('interview_token', token)
    .maybeSingle()
  return data
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const applicant = await findByToken(token)

  if (!applicant) {
    return NextResponse.json({ found: false }, { status: 404 })
  }

  // Jadwal & lokasi interview seragam untuk semua kandidat, diatur sekali di
  // Pengaturan Rekrutmen (recruitment_settings), bukan per-kandidat.
  const { data: settings } = await supabaseAdmin
    .from('recruitment_settings')
    .select('interview_scheduled_at, interview_address, interview_map_url')
    .eq('id', 1)
    .maybeSingle()

  if (!settings?.interview_scheduled_at) {
    return NextResponse.json({ found: true, scheduled: false, full_name: applicant.full_name })
  }

  const [{ data: psychotest }, { data: psychometrics }] = await Promise.all([
    supabaseAdmin.from('psychotest_results')
      .select('score, overall_accuracy, resilience')
      .eq('applicant_id', applicant.id).maybeSingle(),
    supabaseAdmin.from('psychometric_results')
      .select('test_type, result_summary')
      .eq('applicant_id', applicant.id),
  ])

  return NextResponse.json({
    found: true,
    scheduled: true,
    full_name: applicant.full_name,
    application_code: applicant.application_code,
    interview_scheduled_at: settings.interview_scheduled_at,
    interview_address: settings.interview_address,
    interview_map_url: settings.interview_map_url,
    interview_confirmation: applicant.interview_confirmation,
    interview_confirmed_at: applicant.interview_confirmed_at,
    test_impression: applicant.test_impression,
    psychotest: psychotest || null,
    psychometrics: psychometrics || [],
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const applicant = await findByToken(token)
  if (!applicant) {
    return NextResponse.json({ error: 'Undangan tidak ditemukan.' }, { status: 404 })
  }

  const { confirmation_text, test_impression } = await req.json()
  if (!confirmation_text || !String(confirmation_text).trim()) {
    return NextResponse.json({ error: 'Konfirmasi kehadiran wajib diisi.' }, { status: 400 })
  }
  if (!test_impression || !String(test_impression).trim()) {
    return NextResponse.json({ error: 'Kesan mengikuti tes wajib diisi.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('job_applicants')
    .update({
      interview_confirmation: String(confirmation_text).trim(),
      interview_confirmed_at: new Date().toISOString(),
      test_impression: String(test_impression).trim(),
    })
    .eq('id', applicant.id)

  if (error) {
    return NextResponse.json({ error: 'Gagal menyimpan konfirmasi: ' + error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
