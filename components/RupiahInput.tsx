'use client'

import { useRef } from 'react'

function toDigits(v: string) {
  return v.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '')
}

function formatId(digits: string) {
  if (!digits) return ''
  return Number(digits).toLocaleString('id-ID')
}

type Props = {
  value: string
  onChange: (rawDigits: string) => void
  required?: boolean
  placeholder?: string
  className?: string
  disabled?: boolean
  id?: string
  autoFocus?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

/**
 * Input angka dengan pemisah ribuan otomatis saat mengetik (mis. 100000 -> 100.000).
 * `value`/`onChange` tetap berupa string digit mentah (tanpa titik) — pas dipakai
 * langsung dengan parseFloat() seperti input number biasa, cuma tampilannya yang beda.
 */
export default function RupiahInput({ value, onChange, required, placeholder, className, disabled, id, autoFocus, onKeyDown }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const display = formatId(value)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target
    const prevCursor = input.selectionStart ?? display.length
    const digitsBeforeCursor = display.slice(0, prevCursor).replace(/[^\d]/g, '').length

    const rawDigits = toDigits(input.value)
    const newDisplay = formatId(rawDigits)
    onChange(rawDigits)

    requestAnimationFrame(() => {
      if (!ref.current) return
      let count = 0
      let pos = newDisplay.length
      if (digitsBeforeCursor === 0) {
        pos = 0
      } else {
        for (let i = 0; i < newDisplay.length; i++) {
          if (/\d/.test(newDisplay[i])) count++
          if (count === digitsBeforeCursor) { pos = i + 1; break }
        }
      }
      ref.current.setSelectionRange(pos, pos)
    })
  }

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      autoFocus={autoFocus}
      required={required}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      id={id}
      value={display}
      onChange={handleChange}
      onKeyDown={onKeyDown}
    />
  )
}
