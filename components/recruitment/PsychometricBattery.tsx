'use client'

import { useState } from 'react'
import Link from 'next/link'
import { DISC_BLOCKS, PERSONALITY_ITEMS, WORK_PREFERENCE_ITEMS, INTEGRITY_ITEMS, TestType } from '@/lib/psychometricTests'

const PSYCHOMETRIC_MODULES: { type: TestType; title: string; description: string }[] = [
  {
    type: 'disc',
    title: 'DISC — Gaya Kerja',
    description:
      'Di bawah ada 12 kelompok, masing-masing berisi 4 pernyataan. Untuk SETIAP kelompok, Anda harus memilih ' +
      'TEPAT 1 pernyataan yang PALING menggambarkan diri Anda (klik tombol hijau "Paling"), dan TEPAT 1 pernyataan ' +
      'lain yang PALING TIDAK menggambarkan diri Anda (klik tombol merah "Paling Tidak"). Dua pernyataan sisanya ' +
      'di kelompok itu tidak usah diklik sama sekali — biarkan kosong. Contoh: dari 4 pernyataan, kalau pernyataan ' +
      'ke-1 paling mirip Anda dan pernyataan ke-3 paling tidak mirip Anda, klik "Paling" di baris 1 dan "Paling Tidak" ' +
      'di baris 3, lalu lanjut ke kelompok berikutnya. Ulangi sampai semua 12 kelompok terisi, baru tombol "Kirim Jawaban" bisa ditekan.',
  },
  {
    type: 'personality',
    title: 'Tipe Kepribadian Kerja',
    description:
      'Ada 24 pernyataan. Untuk SETIAP pernyataan, klik SATU angka dari 1 sampai 5 yang paling sesuai dengan diri ' +
      'Anda: 1 = Sangat Tidak Setuju, 3 = Netral/Ragu-ragu, 5 = Sangat Setuju. Jawab semua 24 pernyataan sampai selesai.',
  },
  {
    type: 'work_preference',
    title: 'Preferensi Kerja',
    description:
      'Ada 24 pernyataan tentang gaya kerja Anda. Sama seperti sebelumnya: klik SATU angka dari 1 (Sangat Tidak ' +
      'Setuju) sampai 5 (Sangat Setuju) untuk tiap pernyataan, sampai semua terisi.',
  },
  {
    type: 'integrity',
    title: 'Sikap & Etika Kerja',
    description:
      'Ada 12 pernyataan. Klik SATU angka dari 1 (Sangat Tidak Setuju) sampai 5 (Sangat Setuju) untuk tiap ' +
      'pernyataan, sesuai pendapat pribadi Anda yang sebenarnya — tidak ada jawaban benar atau salah.',
  },
]

function DiscForm({ onSubmit }: { onSubmit: (answers: { most: number; least: number }[]) => void }) {
  const [selections, setSelections] = useState<{ most: number | null; least: number | null }[]>(
    DISC_BLOCKS.map(() => ({ most: null, least: null }))
  )
  const allAnswered = selections.every(s => s.most !== null && s.least !== null)

  function setMost(blockIndex: number, optIndex: number) {
    setSelections(prev => prev.map((s, i) => (i === blockIndex ? { ...s, most: optIndex, least: s.least === optIndex ? null : s.least } : s)))
  }
  function setLeast(blockIndex: number, optIndex: number) {
    setSelections(prev => prev.map((s, i) => (i === blockIndex ? { ...s, least: optIndex, most: s.most === optIndex ? null : s.most } : s)))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!allAnswered) return
    onSubmit(selections.map(s => ({ most: s.most as number, least: s.least as number })))
  }

  const filledCount = selections.filter(s => s.most !== null && s.least !== null).length

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 space-y-1 sticky top-0 z-10">
        <p className="text-xs text-blue-800">
          Tiap kelompok: klik <span className="font-semibold">satu</span> tombol hijau &quot;Paling&quot; (paling
          menggambarkan Anda) dan <span className="font-semibold">satu</span> tombol merah &quot;Paling Tidak&quot;
          (paling TIDAK menggambarkan Anda). 2 pernyataan sisanya dibiarkan kosong.
        </p>
        <p className="text-xs font-medium text-blue-700">{filledCount} dari {DISC_BLOCKS.length} kelompok terisi</p>
      </div>
      {DISC_BLOCKS.map((block, bi) => {
        const isBlockFilled = selections[bi].most !== null && selections[bi].least !== null
        return (
        <div key={bi} className={`border rounded-lg p-3 space-y-2 ${isBlockFilled ? 'border-green-300 bg-green-50/50' : 'border-slate-200'}`}>
          <p className="text-xs text-slate-400 flex items-center gap-1">
            Kelompok {bi + 1} dari {DISC_BLOCKS.length}
            {isBlockFilled && <span className="text-green-600 font-medium">✓ Terisi</span>}
          </p>
          {block.map((opt, oi) => (
            <div key={oi} className="flex items-center justify-between gap-2">
              <span className="flex-1 text-sm text-slate-700">{opt.text}</span>
              <div className="flex gap-1 shrink-0">
                <button type="button" onClick={() => setMost(bi, oi)}
                  className={`px-2 py-1 rounded text-xs border ${selections[bi].most === oi ? 'bg-green-600 text-white border-green-600' : 'border-slate-300 text-slate-500'}`}>
                  Paling
                </button>
                <button type="button" onClick={() => setLeast(bi, oi)}
                  className={`px-2 py-1 rounded text-xs border ${selections[bi].least === oi ? 'bg-red-600 text-white border-red-600' : 'border-slate-300 text-slate-500'}`}>
                  Paling Tidak
                </button>
              </div>
            </div>
          ))}
        </div>
        )
      })}
      <button type="submit" disabled={!allAnswered}
        className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
        Kirim Jawaban
      </button>
    </form>
  )
}

function LikertForm({ items, onSubmit }: { items: { text: string }[]; onSubmit: (answers: number[]) => void }) {
  const [values, setValues] = useState<(number | null)[]>(items.map(() => null))
  const allAnswered = values.every(v => v !== null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!allAnswered) return
    onSubmit(values as number[])
  }

  const filledCount = values.filter(v => v !== null).length

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 space-y-1 sticky top-0 z-10">
        <p className="text-xs text-blue-800">
          Klik <span className="font-semibold">satu</span> angka untuk tiap pernyataan: 1 = Sangat Tidak Setuju,
          3 = Netral, 5 = Sangat Setuju.
        </p>
        <p className="text-xs font-medium text-blue-700">{filledCount} dari {items.length} pernyataan terisi</p>
      </div>
      {items.map((item, i) => (
        <div key={i} className="space-y-1.5">
          <p className="text-sm text-slate-700">{i + 1}. {item.text}</p>
          <div className="flex justify-between gap-1">
            {[1, 2, 3, 4, 5].map(v => (
              <button key={v} type="button" onClick={() => setValues(prev => prev.map((p, idx) => (idx === i ? v : p)))}
                className={`flex-1 py-2 rounded border text-sm ${values[i] === v ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 text-slate-600'}`}>
                {v}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>Sangat Tidak Setuju</span><span>Sangat Setuju</span>
          </div>
        </div>
      ))}
      <button type="submit" disabled={!allAnswered}
        className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
        Kirim Jawaban
      </button>
    </form>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PsychometricResultDisplay({ testType, summary }: { testType: TestType; summary: any }) {
  if (testType === 'disc') {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Gaya dominan Anda: {summary.dominant_traits.join(' & ')}</p>
        <p className="text-sm text-slate-600">{summary.description}</p>
      </div>
    )
  }
  if (testType === 'personality') {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Tipe kecenderungan Anda: {summary.type}</p>
        <p className="text-sm text-slate-600">{summary.description}</p>
      </div>
    )
  }
  if (testType === 'work_preference') {
    return (
      <div className="space-y-1">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {summary.dimensions.map((d: any) => (
          <div key={d.key} className="flex justify-between text-sm text-slate-600 border-b border-slate-100 pb-1">
            <span>{d.label}</span><span className="font-medium">{d.level}</span>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">Kecenderungan: {summary.level}</p>
      <p className="text-xs text-slate-500">{summary.note}</p>
    </div>
  )
}

export default function PsychometricBattery({ applicantId, phone, initialDone }: {
  applicantId: string
  phone: string
  initialDone: Record<TestType, boolean>
}) {
  const [doneMap, setDoneMap] = useState(initialDone)
  const [phase, setPhase] = useState<'intro' | 'form' | 'submitting' | 'result' | 'all_done'>(
    () => (PSYCHOMETRIC_MODULES.every(m => initialDone[m.type]) ? 'all_done' : 'intro')
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [resultSummary, setResultSummary] = useState<any>(null)
  // Modul yang hasilnya sedang ditampilkan di layar 'result' — disimpan terpisah dari
  // currentModule, karena begitu doneMap di-update, currentModule sudah loncat ke modul
  // BERIKUTNYA yang belum dikerjakan, padahal layar hasil masih perlu menampilkan modul
  // yang barusan selesai (termasuk saat itu modul terakhir, di mana currentModule jadi null).
  const [completedType, setCompletedType] = useState<TestType | null>(null)
  const [error, setError] = useState('')

  const currentIndex = PSYCHOMETRIC_MODULES.findIndex(m => !doneMap[m.type])
  const currentModule = currentIndex === -1 ? null : PSYCHOMETRIC_MODULES[currentIndex]

  async function handleModuleSubmit(answers: unknown) {
    if (!currentModule) return
    setPhase('submitting')
    setError('')
    try {
      const res = await fetch('/api/lamaran/psychometric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicant_id: applicantId, phone, test_type: currentModule.type, answers }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Gagal menyimpan jawaban.')
        setPhase('form')
        return
      }
      setResultSummary(data.result_summary)
      setCompletedType(currentModule.type)
      setDoneMap(prev => ({ ...prev, [currentModule.type]: true }))
      setPhase('result')
    } catch {
      setError('Gagal menyimpan jawaban. Cek koneksi internet Anda.')
      setPhase('form')
    }
  }

  function handleContinue() {
    setResultSummary(null)
    const nextIndex = PSYCHOMETRIC_MODULES.findIndex(m => !doneMap[m.type])
    setPhase(nextIndex === -1 ? 'all_done' : 'intro')
  }

  if (phase === 'all_done') {
    return (
      <div className="text-sm text-slate-700 text-center space-y-3">
        <p className="font-medium">Anda sudah menyelesaikan seluruh rangkaian tes. Terima kasih! 🎉</p>
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-left space-y-1">
          <p className="text-sm text-blue-800 font-medium">Apa selanjutnya?</p>
          <p className="text-sm text-blue-700">
            Tim HR akan meninjau seluruh jawaban dan hasil tes Anda. Kalau Anda lolos ke tahap berikutnya, HR akan
            menghubungi Anda langsung lewat nomor WhatsApp yang Anda daftarkan untuk jadwal interview.
          </p>
          <p className="text-sm text-blue-700">
            Anda bisa cek status lamaran kapan saja di halaman{' '}
            <Link href="/lamaran/status" className="underline font-medium">Cek Status Lamaran</Link>.
          </p>
        </div>
        <p className="text-xs text-slate-400">
          Hasil di atas menunjukkan kecenderungan dari jawaban Anda sendiri — bukan diagnosis psikologi resmi.
        </p>
      </div>
    )
  }

  if (phase === 'result' && resultSummary && completedType) {
    const completedModule = PSYCHOMETRIC_MODULES.find(m => m.type === completedType)
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm font-medium text-slate-700">{completedModule?.title} — Selesai</p>
        <div className="text-left bg-slate-50 border border-slate-200 rounded-lg p-3">
          <PsychometricResultDisplay testType={completedType} summary={resultSummary} />
        </div>
        <button onClick={handleContinue} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium">
          Lanjut
        </button>
      </div>
    )
  }

  if (!currentModule) return null

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
      )}

      {phase === 'intro' && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700 text-center">{currentModule.title}</p>
          <p className="text-sm text-slate-600 text-left leading-relaxed">{currentModule.description}</p>
          <button onClick={() => setPhase('form')} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium">
            Mulai
          </button>
        </div>
      )}

      {phase === 'form' && currentModule.type === 'disc' && <DiscForm onSubmit={handleModuleSubmit} />}
      {phase === 'form' && currentModule.type === 'personality' && <LikertForm items={PERSONALITY_ITEMS} onSubmit={handleModuleSubmit} />}
      {phase === 'form' && currentModule.type === 'work_preference' && <LikertForm items={WORK_PREFERENCE_ITEMS} onSubmit={handleModuleSubmit} />}
      {phase === 'form' && currentModule.type === 'integrity' && <LikertForm items={INTEGRITY_ITEMS} onSubmit={handleModuleSubmit} />}

      {phase === 'submitting' && <p className="text-sm text-slate-500 text-center">Menyimpan hasil...</p>}
    </div>
  )
}
