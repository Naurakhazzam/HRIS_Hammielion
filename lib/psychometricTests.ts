/**
 * lib/psychometricTests.ts
 * Item bank & scoring untuk 4 tes tambahan (DISC, Tipe Kepribadian ala Jung,
 * Preferensi Kerja ala PAPI, Integritas). Semua soal & deskripsi hasil
 * ditulis sendiri — bukan replika instrumen berlisensi (MBTI®/PAPI Kostick®
 * adalah merek dagang perusahaan lain). Dipakai bersama oleh halaman publik
 * (render soal) dan API (hitung skor di server, sumber kebenaran tunggal).
 *
 * Semua tes ini alat bantu skrining — menunjukkan kecenderungan dari
 * jawaban self-report, bukan diagnosis psikologi resmi.
 */

export type TestType = 'disc' | 'personality' | 'work_preference' | 'integrity'

// ============================================================
// 1. DISC (forced-choice) — 12 blok, tiap blok pilih "paling" & "paling tidak"
// ============================================================

export type DiscTrait = 'D' | 'I' | 'S' | 'C'

export const DISC_BLOCKS: { trait: DiscTrait; text: string }[][] = [
  [
    { trait: 'D', text: 'Saya suka langsung mengambil keputusan tanpa menunggu lama' },
    { trait: 'I', text: 'Saya senang mengobrol dan berkenalan dengan orang baru' },
    { trait: 'S', text: 'Saya lebih suka suasana kerja yang tenang dan stabil' },
    { trait: 'C', text: 'Saya selalu memeriksa ulang pekerjaan sebelum menganggapnya selesai' },
  ],
  [
    { trait: 'D', text: 'Saya tidak takut menghadapi tantangan atau persaingan' },
    { trait: 'I', text: 'Saya mudah bersemangat dan menularkan semangat itu ke orang lain' },
    { trait: 'S', text: 'Saya sabar menghadapi rekan kerja yang lambat' },
    { trait: 'C', text: 'Saya suka bekerja dengan data dan angka yang pasti' },
  ],
  [
    { trait: 'D', text: 'Saya cenderung to-the-point saat berbicara' },
    { trait: 'I', text: 'Saya nyaman menjadi pusat perhatian' },
    { trait: 'S', text: 'Saya jarang terburu-buru dalam bekerja' },
    { trait: 'C', text: 'Saya mengikuti prosedur/SOP dengan disiplin' },
  ],
  [
    { trait: 'D', text: 'Saya ingin semua berjalan sesuai cara yang saya anggap benar' },
    { trait: 'I', text: 'Saya optimis semua akan berjalan baik' },
    { trait: 'S', text: 'Saya setia dan konsisten pada rutinitas kerja' },
    { trait: 'C', text: 'Saya tidak suka membuat keputusan tanpa data yang cukup' },
  ],
  [
    { trait: 'D', text: 'Saya cepat bosan dengan pekerjaan yang monoton' },
    { trait: 'I', text: 'Saya suka memotivasi orang lain di sekitar saya' },
    { trait: 'S', text: 'Saya lebih suka bekerja dalam tim yang harmonis' },
    { trait: 'C', text: 'Saya teliti dalam menghitung dan mencatat' },
  ],
  [
    { trait: 'D', text: 'Saya berani mengambil risiko demi hasil yang lebih baik' },
    { trait: 'I', text: 'Saya ekspresif dalam menyampaikan pendapat' },
    { trait: 'S', text: 'Saya tidak suka konflik dan lebih memilih mengalah' },
    { trait: 'C', text: 'Saya suka semua tersusun rapi dan sistematis' },
  ],
  [
    { trait: 'D', text: 'Saya lebih suka memimpin daripada mengikuti' },
    { trait: 'I', text: 'Saya mudah membangun hubungan baik dengan orang baru' },
    { trait: 'S', text: 'Saya dapat diandalkan untuk pekerjaan rutin jangka panjang' },
    { trait: 'C', text: 'Saya berhati-hati sebelum menyimpulkan sesuatu' },
  ],
  [
    { trait: 'D', text: 'Saya ingin cepat melihat hasil dari apa yang saya kerjakan' },
    { trait: 'I', text: 'Saya suka suasana kerja yang ramai dan interaktif' },
    { trait: 'S', text: 'Saya tetap tenang menghadapi tekanan pekerjaan' },
    { trait: 'C', text: 'Saya lebih nyaman mengikuti aturan yang sudah ada daripada membuat aturan baru' },
  ],
  [
    { trait: 'D', text: 'Saya tidak masalah membuat keputusan yang tidak populer' },
    { trait: 'I', text: 'Saya mudah dipercaya sebagai teman bicara' },
    { trait: 'S', text: 'Saya menghindari perubahan mendadak dalam cara kerja' },
    { trait: 'C', text: 'Saya memperhatikan detail kecil yang sering terlewat orang lain' },
  ],
  [
    { trait: 'D', text: 'Saya suka tantangan baru dalam pekerjaan' },
    { trait: 'I', text: 'Saya senang berbicara di depan banyak orang' },
    { trait: 'S', text: 'Saya mendengarkan lebih banyak daripada berbicara' },
    { trait: 'C', text: 'Saya lebih suka bekerja dengan instruksi yang jelas' },
  ],
  [
    { trait: 'D', text: 'Saya langsung bertindak begitu tahu apa yang harus dilakukan' },
    { trait: 'I', text: 'Saya cenderung antusias dan energik saat bekerja' },
    { trait: 'S', text: 'Saya nyaman dengan rutinitas kerja yang tidak berubah-ubah' },
    { trait: 'C', text: 'Saya berusaha akurat walau harus bekerja lebih lambat' },
  ],
  [
    { trait: 'D', text: 'Saya percaya diri dalam mengambil keputusan sendiri' },
    { trait: 'I', text: 'Saya suka memberi semangat pada rekan kerja yang sedang down' },
    { trait: 'S', text: 'Saya bekerja dengan ritme yang stabil, tidak naik turun' },
    { trait: 'C', text: 'Saya lebih suka merencanakan dulu sebelum bertindak' },
  ],
]

const DISC_INFO: Record<DiscTrait, { label: string; description: string }> = {
  D: {
    label: 'Dominance',
    description: 'Anda menunjukkan kecenderungan gaya Dominance (D) — biasanya digambarkan sebagai pribadi yang tegas, berorientasi hasil, cepat mengambil keputusan, dan menyukai tantangan.',
  },
  I: {
    label: 'Influence',
    description: 'Anda menunjukkan kecenderungan gaya Influence (I) — biasanya digambarkan sebagai pribadi yang ramah, antusias, mudah bergaul, dan pandai memotivasi orang lain.',
  },
  S: {
    label: 'Steadiness',
    description: 'Anda menunjukkan kecenderungan gaya Steadiness (S) — biasanya digambarkan sebagai pribadi yang sabar, dapat diandalkan, tenang menghadapi tekanan, dan bekerja dengan ritme yang stabil.',
  },
  C: {
    label: 'Conscientiousness',
    description: 'Anda menunjukkan kecenderungan gaya Conscientiousness (C) — biasanya digambarkan sebagai pribadi yang teliti, sistematis, akurat, dan disiplin mengikuti aturan/prosedur.',
  },
}

function scoreDisc(answers: { most: number; least: number }[]) {
  if (!Array.isArray(answers) || answers.length !== DISC_BLOCKS.length) {
    throw new Error('Jumlah jawaban DISC tidak sesuai.')
  }
  const raw: Record<DiscTrait, number> = { D: 0, I: 0, S: 0, C: 0 }
  answers.forEach((a, i) => {
    const block = DISC_BLOCKS[i]
    if (
      typeof a?.most !== 'number' || typeof a?.least !== 'number' ||
      a.most < 0 || a.most > 3 || a.least < 0 || a.least > 3 || a.most === a.least
    ) {
      throw new Error('Jawaban DISC tidak valid.')
    }
    raw[block[a.most].trait] += 1
    raw[block[a.least].trait] -= 1
  })
  const traits: DiscTrait[] = ['D', 'I', 'S', 'C']
  const maxScore = Math.max(...traits.map(t => raw[t]))
  const dominant = traits.filter(t => raw[t] === maxScore)
  const percentages = Object.fromEntries(
    traits.map(t => [t, Math.round(((raw[t] + DISC_BLOCKS.length) / (DISC_BLOCKS.length * 2)) * 100)])
  )
  return {
    raw_scores: raw,
    result_summary: {
      percentages,
      dominant_traits: dominant.map(t => DISC_INFO[t].label),
      description: dominant.map(t => DISC_INFO[t].description).join(' '),
    },
  }
}

// ============================================================
// 2. Tipe Kepribadian Kerja (ala Jung — 4 dimensi, BUKAN MBTI®)
// ============================================================

type PersonalityDimension = 'EI' | 'SN' | 'TF' | 'JP'

export const PERSONALITY_ITEMS: { dimension: PersonalityDimension; pole: 1 | 2; text: string }[] = [
  { dimension: 'EI', pole: 1, text: 'Saya merasa berenergi setelah menghabiskan waktu bersama banyak orang' },
  { dimension: 'EI', pole: 1, text: 'Saya senang memulai obrolan dengan orang yang baru saya kenal' },
  { dimension: 'EI', pole: 1, text: 'Saya lebih suka mengerjakan tugas sambil berdiskusi dengan orang lain' },
  { dimension: 'EI', pole: 2, text: 'Saya butuh waktu sendiri untuk mengisi ulang energi setelah beraktivitas ramai' },
  { dimension: 'EI', pole: 2, text: 'Saya lebih nyaman bekerja sendiri daripada dalam kelompok besar' },
  { dimension: 'EI', pole: 2, text: 'Saya cenderung berpikir dulu sebelum berbicara di depan orang banyak' },

  { dimension: 'SN', pole: 1, text: 'Saya lebih percaya pada fakta dan pengalaman nyata daripada teori' },
  { dimension: 'SN', pole: 1, text: 'Saya suka instruksi kerja yang jelas dan detail' },
  { dimension: 'SN', pole: 1, text: 'Saya fokus pada apa yang terjadi sekarang, bukan kemungkinan di masa depan' },
  { dimension: 'SN', pole: 2, text: 'Saya suka memikirkan kemungkinan dan ide-ide baru' },
  { dimension: 'SN', pole: 2, text: 'Saya sering melihat pola atau makna di balik sesuatu' },
  { dimension: 'SN', pole: 2, text: "Saya lebih tertarik pada 'gambaran besar' daripada detail teknis" },

  { dimension: 'TF', pole: 1, text: 'Saya mengambil keputusan berdasarkan logika, bukan perasaan' },
  { dimension: 'TF', pole: 1, text: 'Saya tidak masalah memberi kritik langsung kalau memang perlu' },
  { dimension: 'TF', pole: 1, text: 'Saya menilai sesuatu berdasarkan benar-salah, bukan perasaan orang' },
  { dimension: 'TF', pole: 2, text: 'Saya mempertimbangkan perasaan orang lain sebelum mengambil keputusan' },
  { dimension: 'TF', pole: 2, text: 'Saya berusaha menjaga keharmonisan meski harus mengalah' },
  { dimension: 'TF', pole: 2, text: 'Saya mudah berempati dengan kesulitan orang lain' },

  { dimension: 'JP', pole: 1, text: 'Saya suka merencanakan sesuatu jauh-jauh hari' },
  { dimension: 'JP', pole: 1, text: 'Saya merasa tidak nyaman kalau pekerjaan belum selesai sebelum deadline' },
  { dimension: 'JP', pole: 1, text: 'Saya suka semuanya teratur dan terjadwal' },
  { dimension: 'JP', pole: 2, text: 'Saya lebih suka fleksibel dan menyesuaikan rencana sesuai situasi' },
  { dimension: 'JP', pole: 2, text: 'Saya bisa bekerja baik meski mendadak/tanpa rencana matang' },
  { dimension: 'JP', pole: 2, text: 'Saya cenderung menunda keputusan sampai punya lebih banyak informasi' },
]

const PERSONALITY_POLE_LETTER: Record<PersonalityDimension, [string, string]> = {
  EI: ['E', 'I'],
  SN: ['S', 'N'],
  TF: ['T', 'F'],
  JP: ['J', 'P'],
}

const PERSONALITY_LETTER_BLURB: Record<string, string> = {
  E: 'cenderung mendapat energi dari interaksi sosial — senang berbicara dan beraktivitas bersama orang lain',
  I: 'cenderung mendapat energi dari waktu sendiri — lebih suka merenung sebelum bertindak',
  S: 'cenderung fokus pada fakta konkret dan pengalaman nyata — praktis dan detail',
  N: 'cenderung fokus pada ide, pola, dan kemungkinan di masa depan',
  T: 'cenderung mengambil keputusan berdasarkan logika dan analisis objektif',
  F: 'cenderung mengambil keputusan dengan mempertimbangkan nilai dan perasaan orang lain',
  J: 'cenderung menyukai keteraturan, perencanaan, dan penyelesaian tepat waktu',
  P: 'cenderung fleksibel, adaptif, dan nyaman dengan perubahan rencana',
}

function scorePersonality(answers: number[]) {
  if (!Array.isArray(answers) || answers.length !== PERSONALITY_ITEMS.length) {
    throw new Error('Jumlah jawaban tidak sesuai.')
  }
  if (answers.some(v => typeof v !== 'number' || v < 1 || v > 5)) {
    throw new Error('Nilai jawaban tidak valid.')
  }
  const totals: Record<PersonalityDimension, [number, number]> = { EI: [0, 0], SN: [0, 0], TF: [0, 0], JP: [0, 0] }
  PERSONALITY_ITEMS.forEach((item, i) => {
    totals[item.dimension][item.pole - 1] += answers[i]
  })
  let type = ''
  const dimensionScores: Record<string, { pole1: number; pole2: number; winner: string }> = {}
  ;(Object.keys(totals) as PersonalityDimension[]).forEach(dim => {
    const [p1, p2] = totals[dim]
    const letters = PERSONALITY_POLE_LETTER[dim]
    const winner = p1 >= p2 ? letters[0] : letters[1]
    type += winner
    dimensionScores[dim] = { pole1: p1, pole2: p2, winner }
  })
  return {
    raw_scores: dimensionScores,
    result_summary: {
      type,
      description: `Tipe kecenderungan Anda: ${type}. Anda ${type.split('').map(l => PERSONALITY_LETTER_BLURB[l]).join('; ')}.`,
    },
  }
}

// ============================================================
// 3. Preferensi Kerja (ala PAPI — generik, 6 dimensi)
// ============================================================

export const WORK_PREFERENCE_DIMENSIONS = [
  { key: 'leadership', label: 'Kepemimpinan' },
  { key: 'teamwork', label: 'Kerja Tim' },
  { key: 'diligence', label: 'Ketelitian & Kepatuhan Aturan' },
  { key: 'pace', label: 'Ritme Kerja' },
  { key: 'resilience', label: 'Ketahanan Tekanan' },
  { key: 'service', label: 'Orientasi Pelayanan' },
] as const

type WorkPreferenceKey = typeof WORK_PREFERENCE_DIMENSIONS[number]['key']

export const WORK_PREFERENCE_ITEMS: { dimension: WorkPreferenceKey; text: string }[] = [
  { dimension: 'leadership', text: 'Saya nyaman mengarahkan orang lain dalam bekerja' },
  { dimension: 'leadership', text: 'Saya sering mengambil inisiatif memimpin ketika tidak ada yang memimpin' },
  { dimension: 'leadership', text: 'Saya percaya diri memberi instruksi ke rekan kerja' },
  { dimension: 'leadership', text: 'Saya senang bertanggung jawab atas hasil kerja tim' },

  { dimension: 'teamwork', text: 'Saya lebih produktif saat bekerja bersama tim dibanding sendirian' },
  { dimension: 'teamwork', text: 'Saya senang membantu rekan kerja yang kesulitan' },
  { dimension: 'teamwork', text: 'Saya nyaman berbagi tugas dan tanggung jawab dengan orang lain' },
  { dimension: 'teamwork', text: 'Saya lebih suka berdiskusi sebelum mengambil keputusan bersama tim' },

  { dimension: 'diligence', text: 'Saya selalu memeriksa ulang pekerjaan sebelum menganggapnya selesai' },
  { dimension: 'diligence', text: 'Saya mengikuti SOP meski tidak ada yang mengawasi' },
  { dimension: 'diligence', text: 'Saya memperhatikan detail kecil dalam pekerjaan' },
  { dimension: 'diligence', text: 'Saya merasa tidak nyaman kalau ada aturan yang dilanggar' },

  { dimension: 'pace', text: 'Saya suka bekerja dengan cepat dan menyelesaikan banyak tugas sekaligus' },
  { dimension: 'pace', text: 'Saya bisa menyesuaikan kecepatan kerja sesuai tuntutan situasi' },
  { dimension: 'pace', text: 'Saya tidak keberatan bekerja di bawah tekanan waktu' },
  { dimension: 'pace', text: 'Saya tetap produktif meski harus multitasking' },

  { dimension: 'resilience', text: 'Saya tetap tenang saat menghadapi situasi kerja yang menekan' },
  { dimension: 'resilience', text: 'Saya tidak mudah panik saat menghadapi masalah mendadak' },
  { dimension: 'resilience', text: 'Saya bisa berpikir jernih meski sedang stres' },
  { dimension: 'resilience', text: 'Saya cepat pulih setelah menghadapi hari kerja yang berat' },

  { dimension: 'service', text: 'Saya senang membantu dan melayani orang lain' },
  { dimension: 'service', text: 'Saya sabar menghadapi pelanggan yang rewel atau menuntut' },
  { dimension: 'service', text: 'Saya berusaha membuat orang lain merasa puas dengan layanan saya' },
  { dimension: 'service', text: 'Saya menganggap keluhan pelanggan sebagai kesempatan memperbaiki diri' },
]

function levelFor(average: number): 'Rendah' | 'Sedang' | 'Tinggi' {
  if (average >= 4) return 'Tinggi'
  if (average >= 2.5) return 'Sedang'
  return 'Rendah'
}

function scoreWorkPreference(answers: number[]) {
  if (!Array.isArray(answers) || answers.length !== WORK_PREFERENCE_ITEMS.length) {
    throw new Error('Jumlah jawaban tidak sesuai.')
  }
  if (answers.some(v => typeof v !== 'number' || v < 1 || v > 5)) {
    throw new Error('Nilai jawaban tidak valid.')
  }
  const sums: Record<string, number> = {}
  const counts: Record<string, number> = {}
  WORK_PREFERENCE_ITEMS.forEach((item, i) => {
    sums[item.dimension] = (sums[item.dimension] || 0) + answers[i]
    counts[item.dimension] = (counts[item.dimension] || 0) + 1
  })
  const dimensions = WORK_PREFERENCE_DIMENSIONS.map(d => {
    const average = sums[d.key] / counts[d.key]
    return { key: d.key, label: d.label, average: Math.round(average * 10) / 10, level: levelFor(average) }
  })
  return {
    raw_scores: Object.fromEntries(dimensions.map(d => [d.key, d.average])),
    result_summary: { dimensions },
  }
}

// ============================================================
// 4. Tes Integritas — 12 pernyataan, sebagian dibalik skornya
// ============================================================

export const INTEGRITY_ITEMS: { text: string; reverse: boolean }[] = [
  { text: 'Menurut saya wajar mengambil barang kecil dari tempat kerja untuk keperluan pribadi, asal tidak ketahuan', reverse: true },
  { text: 'Saya tetap mengikuti aturan perusahaan meski tidak ada yang mengawasi', reverse: false },
  { text: 'Saya rasa berbohong sedikit demi menghindari masalah adalah hal yang wajar', reverse: true },
  { text: 'Saya akan melaporkan kesalahan saya sendiri meski bisa saja tidak ketahuan', reverse: false },
  { text: 'Kalau kembalian pembeli lebih dari yang seharusnya, saya rasa itu rezeki dan boleh disimpan', reverse: true },
  { text: 'Saya percaya kejujuran lebih penting daripada keuntungan pribadi jangka pendek', reverse: false },
  { text: 'Menurut saya banyak orang di tempat kerja melakukan kecurangan kecil dan itu wajar', reverse: true },
  { text: 'Saya akan menegur rekan kerja yang saya lihat melakukan kecurangan', reverse: false },
  { text: 'Saya merasa aturan yang terlalu ketat boleh dilanggar kalau tidak merugikan siapa pun', reverse: true },
  { text: 'Saya selalu mencatat dengan jujur meski hasilnya kurang menguntungkan bagi saya', reverse: false },
  { text: 'Saya pernah berpikir untuk memakai fasilitas kantor untuk keperluan pribadi tanpa izin', reverse: true },
  { text: 'Saya merasa tidak nyaman kalau melihat orang lain diperlakukan tidak adil karena kecurangan', reverse: false },
]

function scoreIntegrity(answers: number[]) {
  if (!Array.isArray(answers) || answers.length !== INTEGRITY_ITEMS.length) {
    throw new Error('Jumlah jawaban tidak sesuai.')
  }
  if (answers.some(v => typeof v !== 'number' || v < 1 || v > 5)) {
    throw new Error('Nilai jawaban tidak valid.')
  }
  const adjusted = answers.map((v, i) => (INTEGRITY_ITEMS[i].reverse ? 6 - v : v))
  const total = adjusted.reduce((sum, v) => sum + v, 0)
  const maxTotal = INTEGRITY_ITEMS.length * 5
  const percentage = total / maxTotal
  let level: string
  if (percentage >= 0.8) level = 'Tinggi'
  else if (percentage >= 0.6) level = 'Sedang'
  else level = 'Perlu Perhatian'
  return {
    raw_scores: { total, percentage },
    result_summary: {
      level,
      percentage: Math.round(percentage * 100),
      note: 'Ini kecenderungan sikap dari jawaban self-report, bukan bukti perilaku nyata seseorang jujur atau tidak.',
    },
  }
}

// ============================================================
// Dispatcher dipakai oleh API — satu pintu masuk untuk hitung skor
// ============================================================

export function scorePsychometricTest(testType: TestType, answers: unknown) {
  switch (testType) {
    case 'disc':
      return scoreDisc(answers as { most: number; least: number }[])
    case 'personality':
      return scorePersonality(answers as number[])
    case 'work_preference':
      return scoreWorkPreference(answers as number[])
    case 'integrity':
      return scoreIntegrity(answers as number[])
    default:
      throw new Error('Jenis tes tidak dikenali.')
  }
}
