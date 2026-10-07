// Normalisasi nomor telepon Indonesia (0812xxx / +62812xxx / 62812xxx) jadi link wa.me
// yang bisa langsung diklik untuk membuka chat WhatsApp.
export function toWaLink(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const normalized = digits.startsWith('0') ? `62${digits.slice(1)}` : digits.startsWith('62') ? digits : `62${digits}`
  return `https://wa.me/${normalized}`
}

// Pesan WA ke driver saat tim menugaskan Tugas Ambil Retur ke trip-nya.
export function returnTaskWaLink(phone: string, store: { name: string; address?: string | null }, note: string | null): string {
  const lines = [
    `Tugas Ambil Retur: ${store.name}`,
    store.address ? `Alamat: ${store.address}` : null,
    note ? `Catatan: ${note}` : null,
    'Sudah masuk di trip Anda — buka Pengiriman Logistik, kartu ↩️ Tugas Retur.',
  ].filter(Boolean)
  return `${toWaLink(phone)}?text=${encodeURIComponent(lines.join('\n'))}`
}
