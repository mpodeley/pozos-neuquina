import { useEffect, useMemo, useRef, useState } from 'react'

// Shared pan/zoom interaction for the hand-rolled SVG maps (NetworkMap,
// CuencaMap). Pure interaction state — no coupling to the data being drawn.
// The caller supplies a base viewBox in *screen space* (y already flipped if
// the map negates y per-point) and spreads the returned handlers onto its
// <svg>. `scale` is exposed so callers can keep radii/labels constant on
// screen by dividing by it.

export interface BaseVB {
  minX: number
  minY: number
  w: number
  h: number
  cx: number
  cy: number
}

export interface MapPanZoomOptions {
  minScale?: number
  maxScale?: number
  zoomStep?: number
  /** Padding around the base viewBox, as a fraction of its width. */
  padFraction?: number
}

export interface MapPanZoom {
  svgRef: React.RefObject<SVGSVGElement | null>
  viewBox: string
  scale: number
  isDragging: boolean
  handlers: {
    onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void
    onMouseMove: (e: React.MouseEvent<SVGSVGElement>) => void
    onMouseUp: () => void
    onMouseLeave: () => void
  }
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
}

export function useMapPanZoom(baseVB: BaseVB, opts?: MapPanZoomOptions): MapPanZoom {
  const minScale = opts?.minScale ?? 1
  const maxScale = opts?.maxScale ?? 24
  const zoomStep = opts?.zoomStep ?? 1.25
  const padFraction = opts?.padFraction ?? 0.02

  // View state: scale + pan offset (in viewBox units relative to base center).
  const [view, setView] = useState({ scale: 1, panX: 0, panY: 0 })
  const dragRef = useRef<{
    startX: number
    startY: number
    startPanX: number
    startPanY: number
    moved: boolean
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const visibleW = baseVB.w / view.scale
  const visibleH = baseVB.h / view.scale
  const visibleCx = baseVB.cx + view.panX
  const visibleCy = baseVB.cy + view.panY
  const PAD = baseVB.w * padFraction
  const viewBox = useMemo(
    () =>
      `${visibleCx - visibleW / 2 - PAD} ${visibleCy - visibleH / 2 - PAD} ${visibleW + 2 * PAD} ${visibleH + 2 * PAD}`,
    [visibleCx, visibleCy, visibleW, visibleH, PAD],
  )

  function clampScale(s: number): number {
    return Math.min(maxScale, Math.max(minScale, s))
  }

  function zoomAtPoint(newScale: number, anchorFraction: { fx: number; fy: number }) {
    const clamped = clampScale(newScale)
    const newW = baseVB.w / clamped
    const newH = baseVB.h / clamped
    // Anchor: the point under (fx, fy) in viewBox units must stay there after zoom.
    const anchorX = visibleCx - visibleW / 2 + anchorFraction.fx * visibleW
    const anchorY = visibleCy - visibleH / 2 + anchorFraction.fy * visibleH
    const newCx = anchorX - (anchorFraction.fx - 0.5) * newW
    const newCy = anchorY - (anchorFraction.fy - 0.5) * newH
    setView({ scale: clamped, panX: newCx - baseVB.cx, panY: newCy - baseVB.cy })
  }

  function mouseFractionFromEvent(e: { clientX: number; clientY: number }): { fx: number; fy: number } {
    const svg = svgRef.current
    if (!svg) return { fx: 0.5, fy: 0.5 }
    const rect = svg.getBoundingClientRect()
    return {
      fx: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      fy: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  // Wheel zoom must be a non-passive listener so we can preventDefault and
  // stop the page from scrolling. React's onWheel is passive by default.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? zoomStep : 1 / zoomStep
      zoomAtPoint(view.scale * factor, mouseFractionFromEvent(e))
    }
    svg.addEventListener('wheel', handler, { passive: false })
    return () => svg.removeEventListener('wheel', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.scale, visibleW, visibleH, visibleCx, visibleCy])

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (e.button !== 0) return
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPanX: view.panX,
      startPanY: view.panY,
      moved: false,
    }
    setIsDragging(true)
  }

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!dragRef.current || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const dxFrac = (e.clientX - dragRef.current.startX) / rect.width
    const dyFrac = (e.clientY - dragRef.current.startY) / rect.height
    if (Math.abs(dxFrac) + Math.abs(dyFrac) > 0.002) dragRef.current.moved = true
    setView({
      scale: view.scale,
      panX: dragRef.current.startPanX - dxFrac * visibleW,
      panY: dragRef.current.startPanY - dyFrac * visibleH,
    })
  }

  function onMouseUp() {
    dragRef.current = null
    setIsDragging(false)
  }

  function reset() {
    setView({ scale: 1, panX: 0, panY: 0 })
  }

  function zoomBtn(delta: number) {
    return () => zoomAtPoint(view.scale * delta, { fx: 0.5, fy: 0.5 })
  }

  return {
    svgRef,
    viewBox,
    scale: view.scale,
    isDragging,
    handlers: { onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp },
    zoomIn: zoomBtn(zoomStep),
    zoomOut: zoomBtn(1 / zoomStep),
    reset,
  }
}
