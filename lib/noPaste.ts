/**
 * lib/noPaste.ts
 * Blokir tempel (paste) di textarea jawaban esai supaya diisi dengan kata-kata
 * sendiri. onPaste/onDrop saja tidak cukup — sebagian browser HP (chip
 * clipboard bawaan keyboard) menyisipkan teks lewat event 'input' biasa, jadi
 * onChange di sini juga mengecek InputEvent.inputType.
 *
 * CATATAN: 'insertReplacementText' sengaja TIDAK dimasukkan ke daftar ini —
 * itu juga dipakai keyboard HP untuk autocorrect/saran kata biasa saat mengetik
 * normal. Kalau ikut diblokir, ketikan jujur pelamar yang kena autocorrect bisa
 * "kebalik sendiri" tanpa penjelasan, kelihatan seperti web-nya rusak.
 *
 * LAPISAN KEDUA (addedLength): terbukti dari jawaban asli yang masuk, sebagian
 * WebView (terutama browser dalam-aplikasi seperti WhatsApp, tempat link
 * lamaran ini biasa dibuka) tidak selalu mengisi inputType sama sekali saat
 * tempel — inputType kosong lolos dari pengecekan di atas begitu saja. Sebagai
 * jaring pengaman, event manapun yang menambah teks lebih dari batas wajar
 * sekali ketik/autocorrect (~30 karakter) dianggap tempelan tak terdeteksi,
 * berapa pun nilai inputType-nya.
 */

const PASTE_LIKE_TYPES = ['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertFromYank']
const MAX_LEGIT_SINGLE_EVENT_INSERT = 30

export function blockPasteOnChange(currentValue: string, onChange: (value: string) => void) {
  return (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const inputType = (e.nativeEvent as InputEvent).inputType
    const newValue = e.target.value
    const isKnownPasteType = !!inputType && PASTE_LIKE_TYPES.includes(inputType)
    const isUndetectedBulkInsert = newValue.length - currentValue.length > MAX_LEGIT_SINGLE_EVENT_INSERT
    if (isKnownPasteType || isUndetectedBulkInsert) {
      e.currentTarget.value = currentValue
      return
    }
    onChange(newValue)
  }
}

export const blockPasteHandlers = {
  onPaste: (e: React.ClipboardEvent) => e.preventDefault(),
  onDrop: (e: React.DragEvent) => e.preventDefault(),
  onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
}
