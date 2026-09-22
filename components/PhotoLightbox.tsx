'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// Dipakai di halaman yang punya link dokumen campur (foto ATAU pdf, mis. Surat Cuti) --
// PDF tetap dibuka di tab baru (tidak masuk akal di-zoom sebagai gambar), cuma foto yang
// dicegat untuk ditampilkan membesar di tempat.
export function isImageUrl(url: string): boolean {
  return /\.(jpe?g|png|gif|webp|bmp|heic|avif)(\?|#|$)/i.test(url)
}

const MIN_SCALE = 1
const MAX_SCALE = 4

type LightboxState = { url: string; alt?: string } | null

const LightboxContext = createContext<{ openLightbox: (url: string, alt?: string) => void } | null>(null)

export function usePhotoLightbox() {
  const ctx = useContext(LightboxContext)
  if (!ctx) throw new Error('usePhotoLightbox harus dipakai di dalam PhotoLightboxProvider')
  return ctx
}

export function PhotoLightboxProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LightboxState>(null)
  const openLightbox = useCallback((url: string, alt?: string) => setState({ url, alt }), [])
  const close = useCallback(() => setState(null), [])

  return (
    <LightboxContext.Provider value={{ openLightbox }}>
      {children}
      {state && <LightboxOverlay url={state.url} alt={state.alt} onClose={close} />}
    </LightboxContext.Provider>
  )
}

function clampScale(s: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

function touchDistance(a: React.Touch, b: React.Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function LightboxOverlay({ url, alt, onClose }: { url: string; alt?: string; onClose: () => void }) {
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null)
  const lastTapRef = useRef(0)

  // Kunci scroll halaman di belakang selama lightbox terbuka + Escape untuk menutup (desktop).
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener('keydown', onKey) }
  }, [onClose])

  function toggleZoom() {
    setScale(s => (s > 1 ? 1 : 2.5))
    setPos({ x: 0, y: 0 })
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    setScale(s => clampScale(s - e.deltaY * 0.0015 * s))
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (scale <= 1) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
  }
  function handleMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return
    setPos({ x: dragRef.current.origX + (e.clientX - dragRef.current.startX), y: dragRef.current.origY + (e.clientY - dragRef.current.startY) })
  }
  function handleMouseUp() { dragRef.current = null }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      pinchRef.current = { startDist: touchDistance(e.touches[0], e.touches[1]), startScale: scale }
    } else if (e.touches.length === 1) {
      const now = Date.now()
      if (now - lastTapRef.current < 300) toggleZoom()
      lastTapRef.current = now
      if (scale > 1) dragRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, origX: pos.x, origY: pos.y }
    }
  }
  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchRef.current) {
      const ratio = touchDistance(e.touches[0], e.touches[1]) / pinchRef.current.startDist
      setScale(clampScale(pinchRef.current.startScale * ratio))
    } else if (e.touches.length === 1 && dragRef.current) {
      setPos({ x: dragRef.current.origX + (e.touches[0].clientX - dragRef.current.startX), y: dragRef.current.origY + (e.touches[0].clientY - dragRef.current.startY) })
    }
  }
  function handleTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) pinchRef.current = null
    if (e.touches.length === 0) dragRef.current = null
  }

  const dragging = !!dragRef.current || !!pinchRef.current

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center touch-none select-none">
      <button type="button" onClick={onClose} aria-label="Tutup"
        className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-xl transition">
        ✕
      </button>
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
        <button type="button" onClick={() => setScale(s => clampScale(s - 0.5))} aria-label="Perkecil"
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white text-lg transition">−</button>
        <button type="button" onClick={() => { setScale(1); setPos({ x: 0, y: 0 }) }}
          className="px-3 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition">Reset</button>
        <button type="button" onClick={() => setScale(s => clampScale(s + 0.5))} aria-label="Perbesar"
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white text-lg transition">+</button>
      </div>
      <div
        className="w-full h-full flex items-center justify-center overflow-hidden"
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
        onDoubleClick={toggleZoom}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt || 'Foto'}
          draggable={false}
          className="max-w-[95vw] max-h-[90vh] object-contain"
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
            cursor: scale > 1 ? 'grab' : 'zoom-in',
            transition: dragging ? 'none' : 'transform 0.15s ease-out',
          }}
        />
      </div>
    </div>
  )
}
