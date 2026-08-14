'use client'

export default function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group ml-1 align-middle">
      <span className="w-3.5 h-3.5 rounded-full bg-slate-300 text-white text-[9px] font-bold flex items-center justify-center cursor-help select-none">
        i
      </span>
      <span className="pointer-events-none absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 rounded-lg bg-slate-800 text-white text-[11px] leading-snug px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity normal-case">
        {text}
      </span>
    </span>
  )
}
