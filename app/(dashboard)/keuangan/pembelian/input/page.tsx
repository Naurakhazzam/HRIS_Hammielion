import PembelianSupplierPage from '../PembelianPageContent'

// Rute input — dibuka dari menu "Keuangan" untuk mencatat pembelian/bayar supplier, default
// ke tab Catat Pembelian. Sama persis komponennya dengan ../page.tsx (rute laporan), cuma beda
// default tab, supaya logikanya tidak dobel di dua tempat.
export default function Page() {
  return <PembelianSupplierPage defaultTab="input" />
}
