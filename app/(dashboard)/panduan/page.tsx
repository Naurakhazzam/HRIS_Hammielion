'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getCurrentPeriodRangeStr, rosterPeriodLabel } from '@/lib/rosterPeriod'
import { IZIN_GROUP_MULTIPLIERS, ALPHA_GROUP_MULTIPLIERS } from '@/lib/escalatingDeduction'

const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)
const fmtJam = (t: string) => t.substring(0, 5).replace(':', '.')

// Link biru ke halaman pribadi karyawan (Aturan Potongan Gaji) -- dipakai berkali-kali di bawah
// supaya kata "DI SINI" selalu konsisten gaya & tujuannya.
function DiSiniLink() {
  return <Link href="/potongan" className="text-blue-600 hover:underline font-semibold">DI SINI</Link>
}

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
  { id: 'ajukan-izin', label: '6. Cara Ajukan Izin/Sakit/Cuti' },
  { id: 'alpha', label: '7. Alpha & Klarifikasi' },
  { id: 'lupa-absen', label: '8. Lupa Absen (Masuk/Pulang)' },
  { id: 'potongan-izin', label: '9. Potongan Izin/Sakit' },
  { id: 'potongan-alpha', label: '10. Potongan Alpha' },
  { id: 'potongan-sakit', label: '11. Potongan Sakit + Surat' },
  { id: 'ringkasan', label: '12. Ringkasan Cepat' },
]

export default function PanduanKaryawanPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [deptSchedules, setDeptSchedules] = useState<SchedRow[]>([])
  const [branchSchedules, setBranchSchedules] = useState<SchedRow[]>([])
  const [lateRate, setLateRate] = useState(1000)
  const [overtimeRate, setOvertimeRate] = useState(7500)
  // Gaji standar acuan sistem (salary_defaults) -- dipakai HR sebagai isian awal saat menambah
  // karyawan baru. Dipakai di sini sebagai dasar simulasi supaya angkanya REAL (bukan karangan),
  // walau tetap bukan gaji pribadi siapa pun -- gaji asli tiap orang beda-beda.
  const [contohGajiBulanan, setContohGajiBulanan] = useState(0)

  const period = getCurrentPeriodRangeStr()
  const contohGajiHarian = Math.round(contohGajiBulanan / 26)

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const [{ data: dept }, { data: branch }, { data: def }] = await Promise.all([
      supabase.from('work_schedules')
        .select('check_in_time, check_out_time, detect_until, allow_overtime, departments(name)')
        .order('check_in_time'),
      supabase.from('branch_shift_schedules')
        .select('check_in_time, check_out_time, detect_until, allow_overtime, branches(name)')
        .eq('is_active', true).order('check_in_time'),
      supabase.from('salary_defaults').select('base_salary, position_allowance, meal_allowance, late_penalty_per_minute, overtime_rate_per_hour').limit(1).maybeSingle(),
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
    setOvertimeRate(Number(def?.overtime_rate_per_hour ?? 7500))
    setContohGajiBulanan(Number(def?.base_salary ?? 0) + Number(def?.position_allowance ?? 0) + Number(def?.meal_allowance ?? 0))
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
            <p>Telat dihitung dari <strong>selisih menit</strong> antara jam Anda absen masuk dengan jam masuk shift Anda. Kalau datang lebih awal atau tepat waktu, telatnya dianggap 0 menit (tidak pernah minus). Setiap menit telat berpotensi kena potongan — jadi usahakan selalu datang tepat waktu.</p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="font-medium text-blue-800">💡 Analogi gampangnya:</p>
              <p className="text-blue-700 mt-0.5">Bayangkan naik angkot langganan yang berangkat jam 7 pagi tepat. Datang jam 7 lewat 12 menit? Angkotnya sudah jalan duluan — Anda yang menanggung 12 menit itu.</p>
            </div>
            <p className="font-semibold text-slate-700 pt-1">🧮 Simulasi (tarif standar sistem: {fmtRp(lateRate)}/menit):</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Telat 5 menit → potongan = 5 × {fmtRp(lateRate)} = <strong>{fmtRp(5 * lateRate)}</strong></li>
              <li>Telat 12 menit → potongan = 12 × {fmtRp(lateRate)} = <strong>{fmtRp(12 * lateRate)}</strong></li>
              <li>Telat 30 menit → potongan = 30 × {fmtRp(lateRate)} = <strong>{fmtRp(30 * lateRate)}</strong></li>
            </ul>
            <p className="text-sm text-slate-500">Tarif pribadi Anda bisa beda dari contoh di atas — untuk lihat tarif & rincian telat Anda sendiri, klik <DiSiniLink />.</p>
          </div>
        </section>

        {/* 4. Lembur */}
        <section id="lembur" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">4. 🌙 Aturan Lembur</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <ul className="list-disc pl-5 space-y-1">
              <li>Lembur baru <strong>terdeteksi</strong> kalau Anda pulang <strong>minimal 60 menit penuh</strong> setelah jam pulang shift Anda.</li>
              <li>Perhitungan jamnya <strong>dibulatkan ke bawah</strong> per jam penuh — 59 menit lebih = belum terdeteksi, 61 menit lebih = terdeteksi 1 jam (bukan 1,5 jam).</li>
              <li><strong>Team Gudang tidak pernah mendapat lembur</strong> apapun alasannya. <strong>Helper yang bertugas di cabang Gudang</strong> juga tidak mendapat lembur maupun potongan telat.</li>
            </ul>
            <div className="bg-purple-50 border-2 border-purple-300 rounded-lg p-3">
              <p className="font-bold text-purple-800">⚠️ Lembur terdeteksi ≠ otomatis dibayar!</p>
              <p className="text-purple-700 mt-0.5">Lembur yang terdeteksi dari jam pulang <strong>tidak otomatis masuk gaji</strong>. Wajib diklaim dengan langkah berikut supaya dibayar (jalur klaimnya ada di Portal Saya, muncul otomatis kalau ada lembur terdeteksi):</p>
              <ol className="list-decimal pl-5 mt-1.5 space-y-0.5 text-purple-700">
                <li>Isi kertas lembur fisik & minta tanda tangan sesuai prosedur cabang Anda.</li>
                <li>Foto kertas itu dan upload di Portal Saya — <strong>paling lambat 3 hari</strong> setelah tanggal lembur.</li>
                <li><strong>Owner</strong> yang meninjau & menyetujui foto tersebut (bukan HR/Supervisor).</li>
                <li>Baru setelah disetujui, jam lembur itu ikut dihitung ke gaji.</li>
              </ol>
              <p className="text-purple-700 font-semibold mt-1.5">Lewat 3 hari tidak diklaim = HANGUS, tidak bisa dibayar lagi walau sudah terdeteksi sistem.</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="font-medium text-blue-800">💡 Analogi gampangnya:</p>
              <p className="text-blue-700 mt-0.5">Seperti reimburse struk belanja kantor — biar kelihatan di struk kasir (terdeteksi), tetap harus difoto & diajukan supaya benar-benar diganti uangnya. Kelamaan disimpan tanpa diklaim, ya tidak bisa diganti lagi.</p>
            </div>
            <p className="font-semibold text-slate-700 pt-1">🧮 Simulasi (tarif standar sistem: {fmtRp(overtimeRate)}/jam, berlaku semua staff kecuali Team Gudang):</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Pulang 45 menit lewat jam shift → belum genap 60 menit → lembur <strong>0 jam</strong>, tidak ada yang perlu diklaim</li>
              <li>Pulang 95 menit lewat jam shift → dibulatkan ke bawah → terdeteksi <strong>1 jam</strong> = {fmtRp(overtimeRate)} → wajib klaim+foto dalam 3 hari, baru dibayar setelah Owner setuju</li>
              <li>Pulang 130 menit lewat jam shift → dibulatkan ke bawah → terdeteksi <strong>2 jam</strong> = {fmtRp(overtimeRate * 2)} → wajib klaim+foto dalam 3 hari, baru dibayar setelah Owner setuju</li>
            </ul>
            <p className="text-sm text-slate-500">Tarif di atas tarif standar sistem — tarif Anda sendiri bisa dicek pasti lewat klik <DiSiniLink />.</p>
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
              <li>Kalau hari kosong (tidak ada absen sama sekali) <strong>lebih dari 4 hari</strong>, kelebihannya bukan lagi dianggap libur — masuk hitungan Izin/Alpha (lihat bagian 9 &amp; 10).</li>
              <li>Kalau ternyata hari itu terjadwal libur tapi Anda tetap masuk kerja, sistem akan minta Anda memilih <strong>tanggal pengganti</strong> untuk libur Anda — pilih lewat kalender yang muncul saat absen masuk.</li>
            </ul>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="font-medium text-emerald-800">✅ Hari libur otomatis tercatat sendiri</p>
              <p className="text-emerald-700 mt-0.5">Begitu HR/Owner menyetujui pengajuan libur Anda, sistem otomatis menandai tanggal itu sebagai Libur — Anda tidak perlu absen apa-apa di hari itu dan tidak akan dianggap Alpha. Beda dengan Izin/Sakit yang HARUS diajukan manual (lihat bagian 6).</p>
            </div>
          </div>
        </section>

        {/* 6. Cara Ajukan Izin/Sakit/Cuti */}
        <section id="ajukan-izin" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">6. 📝 Cara Ajukan Izin, Sakit, atau Cuti</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Beda dengan Libur (otomatis dari pengajuan roster di bagian 5), <strong>Izin dan Sakit TIDAK pernah otomatis tercatat</strong> — Anda wajib mengajukan sendiri lewat menu <strong>Cuti &amp; Izin → Ajukan</strong>. Kalau tidak diajukan sama sekali dan Anda tidak absen, sistem akan menganggapnya <strong>Alpha</strong> (lihat bagian 7).</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="bg-slate-50 text-slate-700"><th className="px-3 py-1.5 text-left">Jenis</th><th className="px-3 py-1.5 text-left">Kapan boleh mendadak?</th><th className="px-3 py-1.5 text-left">Syarat</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  <tr><td className="px-3 py-1.5">Cuti Tahunan</td><td className="px-3 py-1.5 text-red-500">Tidak — wajib H-2</td><td className="px-3 py-1.5">Masa kerja ≥1 tahun, jatah 12 hari/tahun (dihitung dari tanggal masuk kerja Anda)</td></tr>
                  <tr><td className="px-3 py-1.5">Izin Periksa/Keperluan</td><td className="px-3 py-1.5 text-red-500">Tidak — wajib H-2</td><td className="px-3 py-1.5">—</td></tr>
                  <tr><td className="px-3 py-1.5">Sakit (tanpa surat)</td><td className="px-3 py-1.5 text-green-600">Boleh, hari itu juga</td><td className="px-3 py-1.5">Maks. 1 hari — lebih dari itu wajib surat dokter</td></tr>
                  <tr><td className="px-3 py-1.5">Sakit (dengan surat dokter)</td><td className="px-3 py-1.5 text-green-600">Boleh, hari itu juga</td><td className="px-3 py-1.5">Wajib lampirkan foto/scan surat dokter</td></tr>
                  <tr><td className="px-3 py-1.5">Izin Duka Keluarga</td><td className="px-3 py-1.5 text-green-600">Boleh, hari itu juga</td><td className="px-3 py-1.5">—</td></tr>
                </tbody>
              </table>
            </div>
            <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3">
              <p className="font-bold text-red-800">⚠️ Penting: H-2 itu wajib, bukan sekadar saran</p>
              <p className="text-red-700 mt-0.5">Cuti Tahunan atau Izin Periksa/Keperluan yang diajukan <strong>kurang dari 2 hari sebelum tanggal mulai</strong> tetap dihitung <strong>Alpha</strong> walaupun nanti disetujui HR/Owner. Kalau memang mendadak, ajukan sebagai Sakit atau Izin Duka Keluarga (tidak kena aturan H-2).</p>
            </div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Semua pengajuan menunggu <strong>persetujuan HR/Owner</strong> dulu sebelum resmi tercatat.</li>
              <li>Kalau hari itu Anda ternyata sudah benar-benar absen (sudah check-in), pengajuan izin <strong>tidak akan menimpa</strong> data kehadiran asli Anda.</li>
            </ul>
            <p className="text-sm text-slate-500">Sudah terlanjur tidak absen dan ketahuan Alpha duluan? Itu bukan jalur ini — pakai <strong>Klarifikasi Alpha</strong> di bagian 7 (jalur darurat/susulan, bukan cara utama).</p>
          </div>
        </section>

        {/* 7. Alpha */}
        <section id="alpha" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">7. 🚨 Alpha &amp; Cara Klarifikasi</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p><strong>Alpha</strong> = tidak absen sama sekali di hari kerja, padahal hari itu bukan hari libur terjadwal Anda. Sistem mengecek ini <strong>otomatis setiap hari</strong> (bukan cuma kalau kebetulan ada yang buka halaman tertentu), tidak perlu dilaporkan HR. Ini adalah <strong>jalur darurat/susulan</strong> — kalau Anda sudah tahu dari awal tidak bisa masuk, seharusnya ajukan lewat <strong>Cuti &amp; Izin</strong> (bagian 6) SEBELUM terjadi, bukan menunggu dianggap Alpha dulu.</p>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="font-medium text-emerald-800">📍 Ada tab khusus untuk ini!</p>
              <p className="text-emerald-700 mt-0.5">Jangan cuma andalkan pengingat yang muncul di dashboard — kalau kelewat/ter-skip, buka langsung menu <strong>Portal Saya → Klarifikasi Alpha</strong>. Semua Alpha yang masih perlu ditindaklanjuti selalu ada di sana, kapan pun Anda buka.</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="font-medium text-red-800">⏳ Anda punya waktu 2 hari untuk klarifikasi!</p>
              <p className="text-red-700 mt-0.5">
                Buka <strong>Portal Saya → Klarifikasi Alpha</strong> dan klarifikasi sebenarnya kenapa: pilih <em>Sakit (tanpa surat)</em>, <em>Sakit (dengan surat dokter — wajib lampirkan foto/scan surat)</em>, <em>Izin</em>, <em>Libur</em> (lihat kotak di bawah), atau <em>Lupa Absen</em> (bagian 8). Batas waktunya <strong>2 hari</strong> dari tanggal Alpha itu terjadi.
              </p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="font-medium text-blue-800">🏖️ Opsi "Libur" — pakai jatah 4 hari/periode</p>
              <p className="text-blue-700 mt-0.5">Kalau hari Alpha itu sebenarnya memang mau Anda jadikan libur (belum sempat diajukan di muka), pilih opsi <em>Libur</em> saat klarifikasi — <strong>gratis, tidak ada potongan sama sekali</strong>, selama jatah 4 hari libur periode ini belum habis (lihat bagian 5). Kalau jatahnya sudah habis, ajukan sebagai Izin biasa.</p>
            </div>
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3">
              <p className="font-bold text-emerald-800">✅ Opsi "Saya Hadir" — khusus periode 26 Agustus - 25 September 2026</p>
              <p className="text-emerald-700 mt-0.5">Kalau Alpha Anda jatuh di periode ini, akan muncul opsi tambahan <em>Saya Hadir</em> — khusus untuk periode transisi ini karena banyak Alpha yang terjadi bukan karena kesalahan karyawan (sistem absen sedang berpindah dari mesin fingerprint ke QR). Pilih ini kalau Anda sebenarnya masuk kerja normal — <strong>gratis, tanpa denda, tidak dibatasi berapa kali</strong>. Opsi ini tidak muncul untuk periode lain.</p>
            </div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Klarifikasi tepat waktu → HR akan meninjau, dan statusnya berubah sesuai yang Anda pilih (bukan Alpha lagi kalau disetujui).</li>
              <li>Lewat 2 hari tanpa klarifikasi → Alpha jadi <strong>permanen</strong>, tidak bisa diubah lagi.</li>
              <li>Kalau klarifikasi Anda ditolak HR, Anda masih bisa mengajukan ulang — selama belum lewat batas 2 hari.</li>
              <li>Setiap kali Anda absen dan masih ada Alpha yang belum diklarifikasi, akan muncul pengingat merah di layar absen — jangan diabaikan.</li>
            </ul>
          </div>
        </section>

        {/* 8. Lupa Absen */}
        <section id="lupa-absen" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">8. 🙈 Lupa Absen (Masuk atau Pulang)</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Manusiawi kalau sesekali lupa scan — sistem punya jalur khusus untuk ini, beda dari Sakit/Izin/Alpha, dengan denda tetap yang jauh lebih kecil:</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="bg-amber-50 text-amber-800"><th className="px-3 py-1.5 text-left">Kasus</th><th className="px-3 py-1.5 text-left">Diajukan lewat</th><th className="px-3 py-1.5 text-right">Denda per kejadian</th></tr></thead>
                <tbody className="divide-y divide-amber-100">
                  <tr><td className="px-3 py-1.5">Lupa Absen Masuk (sebenarnya masuk kerja, tidak absen sama sekali)</td><td className="px-3 py-1.5">Klarifikasi Alpha (bagian 7), pilih "Lupa Absen"</td><td className="px-3 py-1.5 text-right font-medium">Rp15.000</td></tr>
                  <tr><td className="px-3 py-1.5">Lupa Absen Pulang (sudah absen masuk, lupa absen pulang)</td><td className="px-3 py-1.5">Portal Saya, muncul otomatis kalau terdeteksi</td><td className="px-3 py-1.5 text-right font-medium">Rp5.000</td></tr>
                </tbody>
              </table>
            </div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Kedua jenis ini dibatasi <strong>maksimal 4 kali per periode gajian</strong> masing-masing (4x Lupa Absen Masuk + 4x Lupa Absen Pulang, dihitung terpisah).</li>
              <li>Kalau disetujui HR, hari itu dianggap <strong>hadir normal</strong> — tidak masuk kelompok potongan Izin/Alpha yang eskalasi (bagian 9 &amp; 10), cuma kena denda tetap di atas.</li>
              <li>HR berhak menolak kalau dianggap tidak masuk akal atau terlalu sering — jadi tetap usahakan absen tepat waktu, jangan mengandalkan jalur ini.</li>
              <li>Lewat jatah 4x per periode, ajukan sebagai Izin biasa (bagian 6) untuk kasus Lupa Absen Masuk.</li>
            </ul>
          </div>
        </section>

        {/* 9. Potongan Izin/Sakit */}
        <section id="potongan-izin" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">9. 💸 Potongan Izin / Sakit Tanpa Surat</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Izin (duka, keperluan pribadi, dll) dan Sakit <strong>tanpa</strong> surat dokter digabung jadi satu kelompok yang sama. Aturannya per <strong>"kejadian"</strong>: kalau izin 2-3 hari berturut-turut tanpa jeda masuk kerja, itu dihitung <strong>1 kejadian saja</strong> (bukan dihitung per hari). Begitu Anda masuk kerja lagi lalu izin lagi di lain waktu (dalam periode yang sama), itu jadi kejadian berikutnya — dan tarifnya naik. Setiap masuk periode baru (tanggal 26), hitungan kembali dari kejadian pertama lagi.</p>
            <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3">
              <p className="font-bold text-amber-800">🔰 Kecuali karyawan Training</p>
              <p className="text-amber-700 mt-0.5">Kalau status Anda masih <strong>Training</strong>, aturan di atas TIDAK berlaku — potongannya <strong>flat 1× gaji harian per hari</strong>, kejadian ke berapa pun, tidak pernah naik bertahap. Berlaku sama untuk Alpha di bagian 10.</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="font-medium text-blue-800">💡 Analogi gampangnya:</p>
              <p className="text-blue-700 mt-0.5">Ibarat kartu pelanggaran wasit sepak bola dalam satu musim pertandingan (1 periode gaji). Pelanggaran pertama masih kartu ringan. Begitu bikin pelanggaran <em>terpisah</em> lagi di hari lain, kartunya makin berat. Masuk musim baru (periode baru), papan kartu direset dari nol.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="bg-orange-50 text-orange-800"><th className="px-3 py-1.5 text-left">Kejadian ke-</th><th className="px-3 py-1.5 text-left">Pengali</th><th className="px-3 py-1.5 text-right">Potongan per hari</th></tr></thead>
                <tbody className="divide-y divide-orange-100">
                  {IZIN_GROUP_MULTIPLIERS.map((m, i) => (
                    <tr key={i}><td className="px-3 py-1.5">{i + 1}{i === IZIN_GROUP_MULTIPLIERS.length - 1 ? ' (mentok, seterusnya tetap segini)' : ''}</td><td className="px-3 py-1.5">{m}×</td><td className="px-3 py-1.5 text-right font-medium">{fmtRp(Math.round(contohGajiHarian * m))}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="font-semibold text-slate-700 pt-1">🧮 Simulasi lengkap (pakai gaji standar sistem {fmtRp(contohGajiBulanan)}/bulan → gaji harian {fmtRp(contohGajiHarian)}):</p>
            <p>Dalam satu periode: Izin 1 hari (tgl 3) — lalu masuk kerja normal — lalu Sakit tanpa surat 2 hari berturut (tgl 15-16).</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Kejadian ke-1 (tgl 3, 1 hari) × 1× = <strong>{fmtRp(contohGajiHarian)}</strong></li>
              <li>Kejadian ke-2 (tgl 15-16, 2 hari, tetap 1 kejadian karena berturut) × 1.25× = 2 × {fmtRp(Math.round(contohGajiHarian * 1.25))} = <strong>{fmtRp(2 * Math.round(contohGajiHarian * 1.25))}</strong></li>
              <li>Total potongan periode ini: <strong>{fmtRp(contohGajiHarian + 2 * Math.round(contohGajiHarian * 1.25))}</strong></li>
            </ul>
            <p className="text-sm text-slate-500">Ini pakai gaji standar sistem sebagai contoh — gaji Anda sendiri kemungkinan beda. Untuk jelasnya, Anda bisa lihat sendiri potongan Anda yang sesungguhnya berapa, klik <DiSiniLink />.</p>
          </div>
        </section>

        {/* 10. Potongan Alpha */}
        <section id="potongan-alpha" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">10. 💸 Potongan Alpha</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Cara hitungnya <strong>sama persis</strong> seperti Izin/Sakit di atas (per kejadian, blok tanggal berturut dihitung 1 kejadian, reset tiap periode, <strong>kecuali karyawan Training</strong> yang flat 1× — lihat catatan di bagian 9) — bedanya tarifnya jauh lebih berat karena ini absen tanpa keterangan sama sekali. Alpha eksplisit dan hari kosong yang melebihi jatah 4 hari (lihat bagian 5) digabung jadi satu rangkaian kejadian yang sama. Kalau sebenarnya Anda masuk kerja tapi cuma lupa scan, itu bukan Alpha biasa — lihat jalur "Lupa Absen" di bagian 8.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="bg-red-50 text-red-800"><th className="px-3 py-1.5 text-left">Kejadian ke-</th><th className="px-3 py-1.5 text-left">Pengali</th><th className="px-3 py-1.5 text-right">Potongan per hari</th></tr></thead>
                <tbody className="divide-y divide-red-100">
                  {ALPHA_GROUP_MULTIPLIERS.map((m, i) => (
                    <tr key={i}><td className="px-3 py-1.5">{i + 1}{i === ALPHA_GROUP_MULTIPLIERS.length - 1 ? ' (mentok, seterusnya tetap segini)' : ''}</td><td className="px-3 py-1.5">{m}×</td><td className="px-3 py-1.5 text-right font-medium">{fmtRp(Math.round(contohGajiHarian * m))}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400">(Pakai gaji harian standar sistem {fmtRp(contohGajiHarian)} sebagai contoh — lihat angka Anda sendiri di link bawah.)</p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-700">Ini kenapa klarifikasi Alpha (bagian 7) penting dilakukan cepat — kalau berhasil diubah jadi Izin/Sakit, potongannya jauh lebih ringan (kelompok 1×–2× di bagian 9), dibanding dibiarkan jadi Alpha permanen (kelompok 1.5×–3× di sini).</p>
            </div>
            <p className="text-sm text-slate-500">Untuk jelasnya, Anda bisa lihat sendiri potongan Anda yang sesungguhnya berapa, klik <DiSiniLink />.</p>
          </div>
        </section>

        {/* 11. Potongan Sakit + Surat */}
        <section id="potongan-sakit" className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">11. 💸 Potongan Sakit Dengan Surat Dokter</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Beda dengan Izin/Sakit tanpa surat — Sakit <strong>dengan</strong> surat dokter dihitung per <strong>hari berturut</strong> (bukan per kejadian), jadi lebih ringan karena ada bukti resmi.</p>
            <div className="bg-slate-50 rounded-lg p-3 space-y-1">
              <p>Hari ke-1: <strong className="text-green-600">Gratis</strong> (ditanggung perusahaan)</p>
              <p>Hari ke-2 &amp; ke-3: <strong>{fmtRp(Math.round(contohGajiHarian * 0.5))}/hari</strong> (0.5×)</p>
              <p>Hari ke-4 dan seterusnya: <strong>{fmtRp(contohGajiHarian)}/hari</strong> (1×)</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="font-medium text-blue-800">💡 Analogi gampangnya:</p>
              <p className="text-blue-700 mt-0.5">Seperti asuransi — hari pertama sakit, perusahaan yang tanggung penuh selama ada surat dokter. Makin lama sakitnya, porsi yang Anda tanggung sendiri makin besar, tapi tetap lebih ringan daripada sakit tanpa surat sama sekali.</p>
            </div>
            <p className="font-semibold text-slate-700 pt-1">🧮 Simulasi: Sakit 5 hari berturut dengan surat dokter (gaji harian standar sistem {fmtRp(contohGajiHarian)}):</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Hari 1: Gratis = <strong>Rp 0</strong></li>
              <li>Hari 2 &amp; 3: 2 × {fmtRp(Math.round(contohGajiHarian * 0.5))} = <strong>{fmtRp(2 * Math.round(contohGajiHarian * 0.5))}</strong></li>
              <li>Hari 4 &amp; 5: 2 × {fmtRp(contohGajiHarian)} = <strong>{fmtRp(2 * contohGajiHarian)}</strong></li>
              <li>Total potongan: <strong>{fmtRp(2 * Math.round(contohGajiHarian * 0.5) + 2 * contohGajiHarian)}</strong></li>
            </ul>
            <p className="text-sm text-slate-500">Untuk jelasnya, Anda bisa lihat sendiri potongan Anda yang sesungguhnya berapa, klik <DiSiniLink />.</p>
          </div>
        </section>

        {/* 12. Ringkasan */}
        <section id="ringkasan" className="bg-white rounded-xl shadow-sm border-2 border-emerald-300 p-5 scroll-mt-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">12. ✅ Ringkasan Cepat — Supaya Gaji Tidak Terpotong</h2>
          <ul className="space-y-2 text-sm text-slate-700">
            <li>✔️ Absen tepat waktu sesuai jam shift Anda.</li>
            <li>✔️ Tahu dari awal Anda tidak bisa masuk (izin/sakit/cuti)? Ajukan lewat <strong>Cuti & Izin</strong> (bagian 6) — jangan cuma diam dan tidak absen.</li>
            <li>✔️ Selalu absen masuk & pulang — kalau benar-benar lupa, ajukan "Lupa Absen" (bagian 8, denda kecil Rp5.000–15.000) daripada dibiarkan jadi Alpha (potongan jauh lebih besar).</li>
            <li>✔️ Terlanjur tidak absen dan sudah kena Alpha? Segera klarifikasi dalam <strong>2 hari</strong> (bagian 7) — jangan didiamkan.</li>
            <li>✔️ Simpan surat dokter kalau sakit lebih dari 1 hari — potongannya jauh lebih ringan dibanding tanpa surat.</li>
            <li>✔️ Manfaatkan jatah 4 hari libur tiap periode — kalau tidak dipakai penuh, sisanya tetap dibayar tunai, jadi tidak rugi.</li>
            <li>✔️ Weekend cuma boleh pilih 1 tanggal per periode — atur dari awal periode supaya kebagian tanggal yang diinginkan.</li>
            <li>✔️ Masih bingung soal gaji atau absen Anda sendiri? Klik <DiSiniLink /> untuk lihat angka asli Anda, atau tanya HR langsung.</li>
          </ul>
        </section>

      </div>
    </div>
  )
}
