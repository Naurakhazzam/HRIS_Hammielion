// Normalisasi nomor telepon Indonesia (0812xxx / +62812xxx / 62812xxx) jadi link wa.me
// yang bisa langsung diklik untuk membuka chat WhatsApp.
export function toWaLink(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const normalized = digits.startsWith('0') ? `62${digits.slice(1)}` : digits.startsWith('62') ? digits : `62${digits}`
  return `https://wa.me/${normalized}`
}
