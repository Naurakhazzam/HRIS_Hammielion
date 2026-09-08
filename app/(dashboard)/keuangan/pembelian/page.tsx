import PembelianSupplierPage from './PembelianPageContent'

// Rute laporan — dibuka dari menu "Laporan Keuangan", default ke tab Ringkasan per Supplier.
// Untuk mencatat pembelian/bayar, lihat ./input/page.tsx (rute yang sama isinya, beda default tab).
export default function Page() {
  return <PembelianSupplierPage defaultTab="ringkasan-supplier" />
}
