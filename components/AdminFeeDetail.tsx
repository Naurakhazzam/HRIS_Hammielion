import { ADMIN_FEE_KIND_LABEL, type AdminFeeItem } from '@/lib/payrollAbsence'

const fmtRp = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')
const fmtDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })

// Rincian baris "Denda Lupa Absen" (slip Penggajian Bulanan, Portal Slip Gaji, perkiraan gaji di
// Portal): satu baris per tanggal + jenisnya. Slip lama yang snapshot-nya belum menyimpan rincian
// (items undefined) cuma tampil totalnya di baris induk.
export default function AdminFeeDetail({ items }: { items: AdminFeeItem[] | undefined }) {
  if (!items || items.length === 0) return null
  return (
    <div className="mt-1 space-y-0.5">
      {items.map(i => (
        <div key={i.date} className="text-xs text-amber-600">
          └ {fmtDay(i.date)} — {ADMIN_FEE_KIND_LABEL[i.kind]}: {fmtRp(i.amount)}
        </div>
      ))}
    </div>
  )
}
