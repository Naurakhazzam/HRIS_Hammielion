import PembelianSupplierPage from '../PembelianPageContent'

// Sama persis komponennya dengan ../page.tsx (rute laporan) — satu tampilan tunggal, tidak ada
// lagi tab terpisah, supaya logikanya tidak dobel di dua tempat.
export default function Page() {
  return <PembelianSupplierPage />
}
