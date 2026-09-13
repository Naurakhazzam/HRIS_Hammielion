/**
 * lib/waLink.ts
 * Convert nomor HP Indonesia (format apapun: 08xx, +62xx, 62xx, dengan spasi/
 * strip) jadi link wa.me supaya HR bisa klik langsung untuk chat WhatsApp.
 */
export function toWhatsAppLink(phone: string): string {
  const digits = String(phone).replace(/\D/g, '')
  const withCountryCode = digits.startsWith('62')
    ? digits
    : digits.startsWith('0')
      ? `62${digits.slice(1)}`
      : `62${digits}`
  return `https://wa.me/${withCountryCode}`
}
