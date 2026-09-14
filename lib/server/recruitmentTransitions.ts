import { SupabaseClient } from '@supabase/supabase-js'

const REQUIRED_PSYCHOMETRIC_TYPES = ['disc', 'personality', 'work_preference', 'integrity']

/**
 * Dipanggil setelah submit tes hitung cepat ATAU salah satu dari 4 tes
 * psikometri berhasil disimpan. Kalau applicant masih di status 'psikotes'
 * dan KELIMA komponen (1 hitung cepat + 4 psikometri) sudah lengkap,
 * otomatis majukan status ke 'interview' — HR tidak perlu klik manual.
 */
export async function advanceToInterviewIfComplete(supabaseAdmin: SupabaseClient, applicantId: string) {
  const { data: applicant } = await supabaseAdmin
    .from('job_applicants')
    .select('status')
    .eq('id', applicantId)
    .maybeSingle()
  if (!applicant || applicant.status !== 'psikotes') return

  const { data: arithmetic } = await supabaseAdmin
    .from('psychotest_results')
    .select('id')
    .eq('applicant_id', applicantId)
    .maybeSingle()
  if (!arithmetic) return

  const { data: psychometrics } = await supabaseAdmin
    .from('psychometric_results')
    .select('test_type')
    .eq('applicant_id', applicantId)
  const doneTypes = new Set((psychometrics || []).map(r => r.test_type))
  const allDone = REQUIRED_PSYCHOMETRIC_TYPES.every(t => doneTypes.has(t))
  if (!allDone) return

  await supabaseAdmin.from('job_applicants').update({ status: 'interview' }).eq('id', applicantId)
}
