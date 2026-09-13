/**
 * lib/noPaste.ts
 * Blokir tempel (paste) di textarea jawaban esai supaya diisi dengan kata-kata
 * sendiri. onPaste/onDrop saja tidak cukup — sebagian browser HP (chip
 * clipboard bawaan keyboard) menyisipkan teks lewat event 'input' biasa, jadi
 * onChange di sini juga mengecek InputEvent.inputType.
 */

const PASTE_LIKE_TYPES = ['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertFromYank', 'insertReplacementText']

export function blockPasteOnChange(currentValue: string, onChange: (value: string) => void) {
  return (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const inputType = (e.nativeEvent as InputEvent).inputType
    if (inputType && PASTE_LIKE_TYPES.includes(inputType)) {
      e.currentTarget.value = currentValue
      return
    }
    onChange(e.target.value)
  }
}

export const blockPasteHandlers = {
  onPaste: (e: React.ClipboardEvent) => e.preventDefault(),
  onDrop: (e: React.DragEvent) => e.preventDefault(),
}
