'use client'

import { useState } from 'react'
import ScreeningForm, { ScreeningQuestion } from './ScreeningForm'
import PsikotesArithmetic from './PsikotesArithmetic'
import PsychometricBattery from './PsychometricBattery'
import { TestType } from '@/lib/psychometricTests'

/**
 * Orkestrator alur self-service pelamar: Screening -> Psikotes (hitung
 * cepat) -> Psikotes (DISC/kepribadian/preferensi-kerja/integritas).
 * Dipakai di app/lamaran/page.tsx (langsung lanjut setelah submit lamaran)
 * dan app/lamaran/status/page.tsx (melanjutkan tahap yang belum selesai).
 *
 * Transisi status (baru->screening->psikotes->interview) sudah ditangani
 * otomatis di server (lihat app/api/lamaran/route.ts,
 * screening-answers/route.ts, psikotes/route.ts, psychometric/route.ts) —
 * komponen ini cuma mengikuti progres di sisi client tanpa perlu refetch.
 */
export default function RecruitmentFlow({
  applicantId, phone, status, questions = [], existingAnswers, psychotestDone, psychometricDone,
}: {
  applicantId: string
  phone: string
  status: string
  questions?: ScreeningQuestion[]
  existingAnswers?: Record<string, string>
  psychotestDone?: boolean
  psychometricDone?: Record<TestType, boolean>
}) {
  const [screeningSubmitted, setScreeningSubmitted] = useState(status !== 'screening')
  const [arithmeticDone, setArithmeticDone] = useState(!!psychotestDone)

  const inPreInterviewFlow = status === 'screening' || status === 'psikotes'
  const showScreening = inPreInterviewFlow && !screeningSubmitted && questions.length > 0
  const showArithmetic = inPreInterviewFlow && (screeningSubmitted || questions.length === 0) && !arithmeticDone
  const showPsychometric = inPreInterviewFlow && (screeningSubmitted || questions.length === 0) && arithmeticDone

  if (showScreening) {
    return (
      <ScreeningForm
        applicantId={applicantId}
        phone={phone}
        questions={questions}
        existingAnswers={existingAnswers}
        onDone={() => setScreeningSubmitted(true)}
      />
    )
  }

  if (showArithmetic) {
    return <PsikotesArithmetic applicantId={applicantId} phone={phone} onDone={() => setArithmeticDone(true)} />
  }

  if (showPsychometric) {
    return (
      <PsychometricBattery
        applicantId={applicantId}
        phone={phone}
        initialDone={psychometricDone || { disc: false, personality: false, work_preference: false, integrity: false }}
      />
    )
  }

  return null
}
