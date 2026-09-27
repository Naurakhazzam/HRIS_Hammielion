'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCurrentPeriodRangeStr, rosterPeriodLabel } from '@/lib/rosterPeriod'
import { QR_LATE_TOLERANCE_MINUTES } from '@/lib/lateTolerance'
import { IZIN_GROUP_MULTIPLIERS, ALPHA_GROUP_MULTIPLIERS } from '@/lib/escalatingDeduction'

const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)
const fmtJam = (t: string) => t.substring(0, 5).replace(':', '.')

// Contoh ilustrasi supaya simulasi gampang dihitung sendiri oleh karyawan -- BUKAN gaji
// sungguhan siapa pun. Gaji harian Anda yang sebenarnya ada di menu "Aturan Potongan Gaji".
const CONTOH_GAJI_HARIAN = 150000
const CONTOH_TARIF_LEMBUR = 15000

type SchedRow = { label: string; check_in_time: string; check_out_time: string | null; detect_until: string | null; allow_overtime: boolean }

function groupByLabel(rows: SchedRow[]): Map<string, SchedRow[]> {
  const map = new Map<string, SchedRow[]>()
  rows.forEach(r => {
    if (!map.has(r.label)) map.set(r.label, [])
    map.get(r.label)!.push(r)
  })
  return map
}

function ScheduleTable({ rows }: { rows: SchedRow[] }) {
  const grouped = groupByLabel(rows)
  if (grouped.size === 0) return <p className="text-sm text-slate-400 italic">Belum ada jadwal yang diatur HR.</p>
  return (
    <div className="space-y-3">
      {[...grouped.entries()].map(([label, scheds]) => (
        <div key={label} className="bg-slate-50 rounded-lg p-3">
          <p className="text-sm font-semibold text-slate-700 mb-1.5">{label}</p>
          <div className="space-y-1">
            {scheds.map((s, i) => (
              <p key={i} className="text-sm text-slate-600">
                {scheds.length > 1 && <span className="text-slate-400">Shift {i + 1}: </span>}
                Masuk <strong>{fmtJam(s.check_in_time)}</strong>
                {s.check_out_time && <> – Pulang <strong>{fmtJam(s.check_out_time)}</strong></>}
                {s.detect_until && <span className="text-slate-400"> (dianggap shift ini kalau absen masuk ≤ {fmtJam(s.detect_until)})</span>}
                {!s.allow_overtime && <span className="text-amber-600"> · tidak ada lembur di shift ini</span>}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const TOC = [
  { id: 'cara-absen', label: '1. Cara Absen' },
  { id: 'jam-kerja', label: '2. Jam Kerja & Shift' },
  { id: 'telat', label: '3. Aturan Terlambat' },
  { id: 'lembur', label: '4. Aturan Lembur' },
  { id: 'libur', label: '5. Jatah Libur' },
  { id: 'alpha', label: '6. Alpha & Klarifikasi' },
  { id: 'potongan-izin', label: '7. Potongan Izin/Sakit' },
  { id: 'potongan-alpha', label: '8. Potongan Alpha' },
  { id: 'potongan-sakit', label: '9. Potongan Sakit + Surat' },
  { id: 'ringkasan', label: '10. Ringkasan Cepat' },
]

export default function PanduanKaryawanPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [deptSchedules, setDeptSchedules] = useState<SchedRow[]>([])
  const [branchSchedules, setBranchSchedules] = useState<SchedRow[]>([])
  const [lateRate, setLateRate] = useState(1000)

  const period = getCurrentPeriodRangeStr()

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const [{ data: dept }, { data: branch }, { data: def }] = await Promise.all([
      supabase.from('work_schedules')
        .select('check_in_time, check_out_time, detect_until, allow_overtime, departments(name)')
        .order('check_in_time'),
      supabase.from('branch_shift_schedules')
        .select('check_in_time, check_out_time, detect_until, allow_overtime, branches(name)')
        .eq('is_active', true).order('check_in_time'),
      supabase.from('salary_defaults').select('late_penalty_per_minute').limit(1).maybeSingle(),
    ])
    setDeptSchedules((dept || []).map((d: any) => ({
      label: d.departments?.name ?? 'Departemen', check_in_time: d.check_in_time,
      check_out_time: d.check_out_time, detect_until: d.detect_until, allow_overtime: d.allow_overtime,
    })))
    setBranchSchedules((branch || []).map((b: any) => ({
      label: b.branches?.name ?? 'Cabang', check_in_time: b.check_in_time,
      check_out_time: b.check_out_time, detect_until: b.detect_until, allow_overtime: b.allow_overtime,
    })))
    setLateRate(Number(def?.late_penalty_per_minute ?? 1000))
    setLoading(false)
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat panduan...</div>

  return (
    <div className="max-w-3xl mx-auto pb-16">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">📖 Panduan Karyawan</h1>
        <p className="text-sm text-slate-500">
          Semua aturan absen, jam kerja, libur, dan potongan gaji — dijelaskan dengan bahasa sederhana.
          Baca pelan-pelan, tidak perlu buru-buru. Kalau masih bingung, tanya langsung ke HR.
        </p>
      </div>

      {/* Daftar Isi */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Daftar Isi</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {TOC.map(t => (
            <a key={t.id} href={`#${t.id}`} className="text-sm text-blue-600 hover:underline">{t.label}</a>
          ))}
        </div>
      </div>

      <div className="space-y-6">

        {/* 1. Cara Absen */}
        <section id="cara-absen" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">1. 📸 Cara Absen</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Ada 3 cara absen, tergantung cabang Anda:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Mesin Fingerprint</strong> — tempel jari di mesin yang ada di cabang.</li>
              <li><strong>Absen QR</strong> — buka HP, scan barcode yang ditempel di cabang, lalu foto wajah langsung dari kamera.</li>
              <li><strong>Absen HP (GPS)</strong> — kalau cabang Anda sudah diaktifkan, absen langsung dari HP dengan syarat berada dekat lokasi cabang.</li>
            </ul>
            <p>Beberapa hal yang wajib diingat:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>📷 Foto <strong>wajib diambil langsung dari kamera saat itu juga</strong> — tidak bisa pakai foto lama dari galeri HP.</li>
              <li>⏳ Absen <strong>pulang</strong> baru bisa dilakukan minimal <strong>15 menit</strong> setelah absen masuk — supaya tidak ada yang buru-buru absen pulang padahal baru saja absen masuk.</li>
              <li>🔁 <strong>Perbantuan cabang lain</strong>: kalau ditugaskan bantu cabang lain, scan saja QR di cabang itu — sistem akan tanya "ini perbantuan atau salah scan?", pilih <em>perbantuan</em> kalau memang sedang ditugaskan di sana.</li>
              <li>🛑 Absen tidak akan tersimpan dua kali dari sumber berbeda di hari yang sama (misal sudah difingerprint, tidak perlu absen HP lagi).</li>
            </ul>
          </div>
        </section>

        {/* 2. Jam Kerja & Shift */}
        <section id="jam-kerja" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">2. ⏰ Jam Kerja & Shift</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              Sistem <strong>otomatis mendeteksi shift Anda</strong> dari jam berapa Anda absen masuk — Anda tidak perlu memilih shift
              sendiri. Kalau di suatu departemen/cabang ada 2 shift, aturan bacanya: absen masuk sebelum atau tepat jam batas → dianggap Shift 1,
              lewat dari jam batas itu → otomatis dianggap Shift 2.
            </p>
            <p className="font-semibold text-slate-700 pt-1">Jadwal Departemen (dasar/default):</p>
            <ScheduleTable rows={deptSchedules} />
            <p className="font-semibold text-slate-700 pt-2">Jadwal per Cabang Toko (kalau cabang Anda ada di sini, pakai jadwal ini — bukan jadwal Team Toko di atas):</p>
            <ScheduleTable rows={branchSchedules} />
            <p className="text-xs text-slate-400 pt-1">
              Tabel di atas diambil langsung dari sistem — kalau HR mengubah jadwal, tabel ini otomatis ikut berubah.
              Kalau Anda punya "Jam Kerja Khusus" pribadi (biasanya karena alasan tertentu yang disetujui HR), jadwal pribadi itu yang berlaku, bukan tabel ini — tanya HR kalau tidak yakin.
            </p>
          </div>
        </section>

        {/* 3. Terlambat */}
        <section id="telat" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">3. ⏱️ Aturan Terlambat</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Telat dihitung dari <strong>selisih menit</strong> antara jam Anda absen masuk dengan jam masuk shift Anda. Kalau datang lebih awal atau tepat waktu, telatnya dianggap 0 menit (tidak pernah minus).</p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="font-medium text-amber-800">Toleransi khusus Absen QR: {QR_LATE_TOLERANCE_MINUTES} menit</p>
              <p className="text-amber-700 mt-0.5">Kalau Anda absen pakai <strong>QR</strong> dan telatnya cuma sampai {QR_LATE_TOLERANCE_MINUTES} menit, keterlambatan tetap tercatat apa adanya, tapi <strong>tidak dipotong gaji</strong>. Lewat {QR_LATE_TOLERANCE_MINUTES} menit, seluruh menit telatnya dihitung dari menit pertama (bukan cuma kelebihannya). Toleransi ini <strong>tidak berlaku</strong> untuk absen fingerprint, HP, atau input manual.</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="font-medium text-blue-800">💡 Analogi gampangnya:</p>
              <p className="text-blue-700 mt-0.5">Bayangkan naik angkot langganan yang berangkat jam 7 pagi tepat. Datang jam 7 lewat 12 menit? Angkotnya sudah jalan duluan — Anda yang menanggung 12 menit itu. Tapi kalau Anda absen QR dan cuma telat 3 menit, dianggap masih "keburu naik", jadi dimaafkan.</p>
            </div>
            <p className="font-semibold text-slate-700 pt-1">🧮 Simulasi (tarif standar Anda: {fmtRp(lateRate)}/menit — tarif pribadi Anda bisa dicek di menu <em>Aturan Potongan Gaji</em>):</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Absen fingerprint, telat 12 menit → potongan = 12 × {fmtRp(lateRate)} = <strong>{fmtRp(12 * lateRate)}</strong></li>
              <li>Absen QR, telat 3 menit → masih dalam toleransi {QR_LATE_TOLERANCE_MINUTES} menit → potongan <strong>Rp 0</strong></li>
              <li>Absen QR, telat 9 menit → lewat toleransi, dihitung penuh dari menit pertama → potongan = 9 × {fmtRp(lateRate)} = <strong>{fmtRp(9 * lateRate)}</strong></li>
            </ul>
          </div>
        </section>

        {/* 4. Lembur */}
        <section id="lembur" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">4. 🌙 Aturan Lembur</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <ul className="list-disc pl-5 space-y-1">
              <li>Lembur baru dihitung kalau Anda pulang <strong>minimal 60 menit penuh</strong> setelah jam pulang shift Anda.</li>
              <li>Perhitungannya <strong>dibulatkan ke bawah</strong> per jam penuh — 59 menit lebih = belum dihitung, 61 menit lebih = dihitung 1 jam (bukan 1,5 jam).</li>
              <li><strong>Team Gudang tidak pernah mendapat lembur</strong> apapun alasannya. <strong>Helper yang bertugas di cabang Gudang</strong> juga tidak mendapat lembur maupun potongan telat.</li>
            </ul>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="font-medium text-blue-800">💡 Analogi gampangnya:</p>
              <p className="text-blue-700 mt-0.5">Seperti parkir motor per jam — kurang dari 1 jam penuh belum ditagih, begitu genap 1 jam baru dihitung. Numpang lewat 5-10 menit saja belum kena tarif jam berikutnya.</p>
            </div>
            <p className="font-semibold text-slate-700 pt-1">🧮 Simulasi (contoh tarif lembur Anda: {fmtRp(CONTOH_TARIF_LEMBUR)}/jam — tarif asli lihat di slip gaji):</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Pulang 45 menit lewat jam shift → belum genap 60 menit → lembur <strong>Rp 0</strong></li>
              <li>Pulang 95 menit lewat jam shift → dibulatkan ke bawah jadi 1 jam → lembur = <strong>{fmtRp(CONTOH_TARIF_LEMBUR)}</strong></li>
              <li>Pulang 130 menit lewat jam shift → dibulatkan ke bawah jadi 2 jam → lembur = <strong>{fmtRp(CONTOH_TARIF_LEMBUR * 2)}</strong></li>
            </ul>
          </div>
        </section>

        {/* 5. Libur */}
        <section id="libur" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">5. 🏖️ Jatah Libur</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Satu periode gaji berjalan dari tanggal <strong>26 sampai tanggal 25 bulan berikutnya</strong> (periode berjalan sekarang: <strong>{rosterPeriodLabel(new Date(period.start), new Date(period.end))}</strong>).</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Setiap periode, Anda punya jatah <strong>4 hari libur gratis</strong>. Ajukan tanggalnya sendiri lewat menu <em>Ajukan Libur</em> di Portal.</li>
              <li>Maksimal <strong>1 tanggal Sabtu/Minggu</strong> per periode boleh dipilih jadi hari libur — supaya weekend bisa bergantian dengan rekan kerja, tidak dikuasai orang yang sama terus.</li>
              <li>Kalau libur yang Anda ambil <strong>kurang dari 4 hari</strong> dalam satu periode, sisanya <strong>dibayar tunai</strong> sebagai kompensasi (dianggap Anda "menabung" hari libur jadi uang).</li>
              <li>Kalau hari kosong (tidak ada absen sama sekali) <strong>lebih dari 4 hari</strong>, kelebihannya bukan lagi dianggap libur — masuk hitungan Izin/Alpha (lihat bagian 7 &amp; 8).</li>
              <li>Kalau ternyata hari itu terjadwal libur tapi Anda tetap masuk kerja, sistem akan minta Anda memilih <strong>tanggal pengganti</strong> untuk libur Anda — pilih lewat kalender yang muncul saat absen masuk.</li>
            </ul>
          </div>
        </section>

        {/* 6. Alpha */}
        <section id="alpha" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">6. 🚨 Alpha &amp; Cara Klarifikasi</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p><strong>Alpha</strong> = tidak absen sama sekali di hari kerja, padahal hari itu bukan hari libur terjadwal Anda. Sistem mendeteksi ini otomatis, tidak perlu dilaporkan HR.</p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="font-medium text-red-800">⏳ Anda punya waktu 2 hari untuk klarifikasi!</p>
              <p className="text-red-700 mt-0.5">
                Begitu terdeteksi Alpha, buka <strong>Portal Saya</strong> dan klarifikasi sebenarnya kenapa: pilih <em>Sakit (tanpa surat)</em>, <em>Sakit (dengan surat dokter — wajib lampirkan foto/scan surat)</em>, atau <em>Izin</em>. Batas waktunya <strong>2 hari</strong> dari tanggal Alpha itu terjadi.
              </p>
            </div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Klarifikasi tepat waktu → HR akan meninjau, dan statusnya berubah sesuai yang Anda pilih (bukan Alpha lagi kalau disetujui).</li>
              <li>Lewat 2 hari tanpa klarifikasi → Alpha jadi <strong>permanen</strong>, tidak bisa diubah lagi.</li>
              <li>Kalau klarifikasi Anda ditolak HR, Anda masih bisa mengajukan ulang — selama belum lewat batas 2 hari.</li>
              <li>Setiap kali Anda absen dan masih ada Alpha yang belum diklarifikasi, akan muncul pengingat merah di layar absen — jangan diabaikan.</li>
            </ul>
          </div>
        </section>

        {/* 7. Potongan Izin/Sakit */}
        <section id="potongan-izin" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">7. 💸 Potongan Izin / Sakit Tanpa Surat</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Izin (duka, keperluan pribadi, dll) dan Sakit <strong>tanpa</strong> surat dokter digabung jadi satu kelompok yang sama. Aturannya per <strong>"kejadian"</strong>: kalau izin 2-3 hari berturut-turut tanpa jeda masuk kerja, itu dihitung <strong>1 kejadian saja</strong> (bukan dihitung per hari). Begitu Anda masuk kerja lagi lalu izin lagi di lain waktu (dalam periode yang sama), itu jadi kejadian berikutnya — dan tarifnya naik. Setiap masuk periode baru (tanggal 26), hitungan kembali dari kejadian pertama lagi.</p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="font-medium text-blue-800">💡 Analogi gampangnya:</p>
              <p className="text-blue-700 mt-0.5">Ibarat kartu pelanggaran wasit sepak bola dalam satu musim pertandingan (1 periode gaji). Pelanggaran pertama masih kartu ringan. Begitu bikin pelanggaran <em>terpisah</em> lagi di hari lain, kartunya makin berat. Masuk musim baru (periode baru), papan kartu direset dari nol.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="bg-orange-50 text-orange-800"><th className="px-3 py-1.5 text-left">Kejadian ke-</th><th className="px-3 py-1.5 text-left">Pengali</th><th className="px-3 py-1.5 text-right">Potongan per hari (contoh gaji harian {fmtRp(CONTOH_GAJI_HARIAN)})</th></tr></thead>
                <tbody className="divide-y divide-orange-100">
                  {IZIN_GROUP_MULTIPLIERS.map((m, i) => (
                    <tr key={i}><td className="px-3 py-1.5">{i + 1}{i === IZIN_GROUP_MULTIPLIERS.length - 1 ? ' (mentok, seterusnya tetap segini)' : ''}</td><td className="px-3 py-1.5">{m}×</td><td className="px-3 py-1.5 text-right font-medium">{fmtRp(Math.round(CONTOH_GAJI_HARIAN * m))}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="font-semibold text-slate-700 pt-1">🧮 Simulasi lengkap (gaji harian contoh {fmtRp(CONTOH_GAJI_HARIAN)}):</p>
            <p>Dalam satu periode: Izin 1 hari (tgl 3) — lalu masuk kerja normal — lalu Sakit tanpa surat 2 hari berturut (tgl 15-16).</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Kejadian ke-1 (tgl 3, 1 hari) × 1× = <strong>{fmtRp(CONTOH_GAJI_HARIAN)}</strong></li>
              <li>Kejadian ke-2 (tgl 15-16, 2 hari, tetap 1 kejadian karena berturut) × 1.25× = 2 × {fmtRp(Math.round(CONTOH_GAJI_HARIAN * 1.25))} = <strong>{fmtRp(2 * Math.round(CONTOH_GAJI_HARIAN * 1.25))}</strong></li>
              <li>Total potongan periode ini: <strong>{fmtRp(CONTOH_GAJI_HARIAN + 2 * Math.round(CONTOH_GAJI_HARIAN * 1.25))}</strong></li>
            </ul>
          </div>
        </section>

        {/* 8. Potongan Alpha */}
        <section id="potongan-alpha" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">8. 💸 Potongan Alpha</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Cara hitungnya <strong>sama persis</strong> seperti Izin/Sakit di atas (per kejadian, blok tanggal berturut dihitung 1 kejadian, reset tiap periode) — bedanya tarifnya jauh lebih berat karena ini absen tanpa keterangan sama sekali. Alpha eksplisit dan hari kosong yang melebihi jatah 4 hari (lihat bagian 5) digabung jadi satu rangkaian kejadian yang sama.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="bg-red-50 text-red-800"><th className="px-3 py-1.5 text-left">Kejadian ke-</th><th className="px-3 py-1.5 text-left">Pengali</th><th className="px-3 py-1.5 text-right">Potongan per hari (contoh gaji harian {fmtRp(CONTOH_GAJI_HARIAN)})</th></tr></thead>
                <tbody className="divide-y divide-red-100">
                  {ALPHA_GROUP_MULTIPLIERS.map((m, i) => (
                    <tr key={i}><td className="px-3 py-1.5">{i + 1}{i === ALPHA_GROUP_MULTIPLIERS.length - 1 ? ' (mentok, seterusnya tetap segini)' : ''}</td><td className="px-3 py-1.5">{m}×</td><td className="px-3 py-1.5 text-right font-medium">{fmtRp(Math.round(CONTOH_GAJI_HARIAN * m))}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-700">Ini kenapa klarifikasi Alpha (bagian 6) penting dilakukan cepat — kalau berhasil diubah jadi Izin/Sakit, potongannya jauh lebih ringan (kelompok 1×–2× di bagian 7), dibanding dibiarkan jadi Alpha permanen (kelompok 1.5×–3× di sini).</p>
            </div>
          </div>
        </section>

        {/* 9. Potongan Sakit + Surat */}
        <section id="potongan-sakit" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">9. 💸 Potongan Sakit Dengan Surat Dokter</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Beda dengan Izin/Sakit tanpa surat — Sakit <strong>dengan</strong> surat dokter dihitung per <strong>hari berturut</strong> (bukan per kejadian), jadi lebih ringan karena ada bukti resmi.</p>
            <div className="bg-slate-50 rounded-lg p-3 space-y-1">
              <p>Hari ke-1: <strong className="text-green-600">Gratis</strong> (ditanggung perusahaan)</p>
              <p>Hari ke-2 &amp; ke-3: <strong>{fmtRp(Math.round(CONTOH_GAJI_HARIAN * 0.5))}/hari</strong> (0.5×)</p>
              <p>Hari ke-4 dan seterusnya: <strong>{fmtRp(CONTOH_GAJI_HARIAN)}/hari</strong> (1×)</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="font-medium text-blue-800">💡 Analogi gampangnya:</p>
              <p className="text-blue-700 mt-0.5">Seperti asuransi — hari pertama sakit, perusahaan yang tanggung penuh selama ada surat dokter. Makin lama sakitnya, porsi yang Anda tanggung sendiri makin besar, tapi tetap lebih ringan daripada sakit tanpa surat sama sekali.</p>
            </div>
            <p className="font-semibold text-slate-700 pt-1">🧮 Simulasi: Sakit 5 hari berturut dengan surat dokter (gaji harian contoh {fmtRp(CONTOH_GAJI_HARIAN)}):</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Hari 1: Gratis = <strong>Rp 0</strong></li>
              <li>Hari 2 &amp; 3: 2 × {fmtRp(Math.round(CONTOH_GAJI_HARIAN * 0.5))} = <strong>{fmtRp(2 * Math.round(CONTOH_GAJI_HARIAN * 0.5))}</strong></li>
              <li>Hari 4 &amp; 5: 2 × {fmtRp(CONTOH_GAJI_HARIAN)} = <strong>{fmtRp(2 * CONTOH_GAJI_HARIAN)}</strong></li>
              <li>Total potongan: <strong>{fmtRp(2 * Math.round(CONTOH_GAJI_HARIAN * 0.5) + 2 * CONTOH_GAJI_HARIAN)}</strong></li>
            </ul>
          </div>
        </section>

        {/* 10. Ringkasan */}
        <section id="ringkasan" className="bg-white rounded-xl shadow-sm border-2 border-emerald-300 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">10. ✅ Ringkasan Cepat — Supaya Gaji Tidak Terpotong</h2>
          <ul className="space-y-2 text-sm text-slate-700">
            <li>✔️ Absen tepat waktu sesuai jam shift Anda — kalau pakai QR, telat sampai {QR_LATE_TOLERANCE_MINUTES} menit masih dimaafkan.</li>
            <li>✔️ Selalu absen, walau cuma sebentar di kantor/cabang — jangan sampai dianggap Alpha karena lupa absen.</li>
            <li>✔️ Kalau benar-benar tidak bisa masuk (sakit/ada urusan), segera absen klarifikasi Alpha dalam <strong>2 hari</strong> — jangan didiamkan.</li>
            <li>✔️ Simpan surat dokter kalau sakit lebih dari 1 hari — potongannya jauh lebih ringan dibanding tanpa surat.</li>
            <li>✔️ Manfaatkan jatah 4 hari libur tiap periode — kalau tidak dipakai penuh, sisanya tetap dibayar tunai, jadi tidak rugi.</li>
            <li>✔️ Weekend cuma boleh pilih 1 tanggal per periode — atur dari awal periode supaya kebagian tanggal yang diinginkan.</li>
            <li>✔️ Masih bingung soal gaji atau absen Anda sendiri? Buka menu <em>Aturan Potongan Gaji</em> untuk lihat angka asli Anda, atau tanya HR langsung.</li>
          </ul>
        </section>

      </div>
    </div>
  )
}
