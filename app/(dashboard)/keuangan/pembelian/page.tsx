import PembelianSupplierPage from './PembelianPageContent'

// Dua rute (ini dan ./input/page.tsx) sama-sama merender komponen yang sama — satu tampilan
// tunggal (daftar supplier -> klik -> Detail berisi ledger + tambah belanja + bayar hutang),
// tidak ada lagi tab terpisah, supaya logikanya tidak dobel di dua tempat.
export default function Page() {
  return <PembelianSupplierPage />
}
