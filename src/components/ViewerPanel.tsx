import { useState, useEffect, useRef, useCallback } from 'react'
import * as dicomParser from 'dicom-parser'
import type { DICOMSeries } from '../types'

interface ViewerPanelProps {
  series: DICOMSeries
  tool: 'zoom' | 'pan' | 'wwwc' | 'length'
  onRemove: () => void
  syncedSlice?: number
  onSliceChange?: (index: number) => void
}

function getEffectiveSlope(slope: number | null | undefined): number {
  if (!slope || slope === 0) return 1
  if (!isFinite(slope)) return 1
  if (Math.abs(slope) < 0.01) return 1
  return slope
}

function getEffectiveIntercept(intercept: number | null | undefined): number {
  if (!intercept || intercept === 0) return 0
  if (!isFinite(intercept)) return 0
  if (Math.abs(intercept) < 1e-6) return 0
  return intercept
}

export function ViewerPanel({ series, tool, onRemove, syncedSlice, onSliceChange }: ViewerPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ww, setWw] = useState(400)
  const [wc, setWc] = useState(0)
  const [sliceIndex, setSliceIndex] = useState(0)
  const animFrameRef = useRef<number>(0)
  const activeSlice = syncedSlice !== undefined ? syncedSlice : sliceIndex

  useEffect(() => {
    if (series.slices.length === 0) { setError('无数据'); setLoading(false); return }

    try {
      const effSlope = getEffectiveSlope(series.slices[0].slope)
      const effIntercept = getEffectiveIntercept(series.slices[0].intercept)
      const samples: number[] = []
      const step = Math.max(1, Math.floor(series.slices.length / 3))
      for (let si = 0; si < series.slices.length && samples.length < 50000; si += step) {
        const slice = series.slices[si]
        const ds = dicomParser.parseDicom(new Uint8Array(slice.buffer))
        const pe = ds.elements['x7fe00010']
        if (!pe || !pe.dataOffset) continue
        const raw = new Uint8Array(slice.buffer, pe.dataOffset, Math.min(pe.length, 20000))
        const bits = slice.bitsAlloc
        for (let i = 0; i < raw.length; i += (bits === 16 ? 8 : 2)) {
          const v = bits === 16 ? (raw[i] | (raw[i+1] << 8)) : raw[i]
          samples.push(v * effSlope + effIntercept)
        }
      }
      if (samples.length > 100) {
        samples.sort((a, b) => a - b)
        const n = samples.length
        const p10 = samples[Math.floor(n * 0.10)]
        const p50 = samples[Math.floor(n * 0.50)]
        const p90 = samples[Math.floor(n * 0.90)]
        const p95 = samples[Math.floor(n * 0.95)]
        let w: number, c: number
        if (p50 === 0) {
          const upper = Math.max(p95, p90, 500)
          w = Math.min(Math.max(upper - p10, 1500), 3500)
          c = Math.round((p10 + upper) / 2)
        } else {
          w = Math.min(Math.max(p90 - p10, 200), 8000)
          c = Math.round((p10 + p90) / 2)
        }
        setWw(w)
        setWc(c)
      }
    } catch { setWw(400); setWc(0) }
    setLoading(false)
    setError(null)
  }, [series])

  const renderImage = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || series.slices.length === 0) return
    const slice = series.slices[Math.min(activeSlice, series.slices.length - 1)]
    if (!slice) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const ds = dicomParser.parseDicom(new Uint8Array(slice.buffer))
    const pe = ds.elements['x7fe00010']
    if (!pe || !pe.dataOffset || pe.length === 0) return
    const rawBytes = new Uint8Array(slice.buffer, pe.dataOffset, pe.length)
    const pixels = new Float32Array(slice.rows * slice.cols)
    const es = getEffectiveSlope(slice.slope)
    const ei = getEffectiveIntercept(slice.intercept)
    if (slice.bitsAlloc === 16) {
      for (let i = 0; i < slice.rows * slice.cols; i++) {
        pixels[i] = (rawBytes[i * 2] | (rawBytes[i * 2 + 1] << 8)) * es + ei
      }
    } else {
      for (let i = 0; i < slice.rows * slice.cols; i++) {
        pixels[i] = rawBytes[i] * es + ei
      }
    }
    const wNorm = Math.max(1, ww)
    const invR = 255 / wNorm
    const lower = wc - wNorm / 2
    const imgData = ctx.createImageData(slice.cols, slice.rows)
    const data = imgData.data
    for (let i = 0; i < pixels.length; i++) {
      const v = Math.max(0, Math.min(255, Math.round((pixels[i] - lower) * invR)))
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255
    }
    canvas.width = slice.cols
    canvas.height = slice.rows
    ctx.putImageData(imgData, 0, 0)
  }, [series, activeSlice, ww, wc])

  useEffect(() => {
    cancelAnimationFrame(animFrameRef.current)
    animFrameRef.current = requestAnimationFrame(renderImage)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [renderImage])

  const handleSliceChange = useCallback((val: number) => { setSliceIndex(val); onSliceChange?.(val) }, [onSliceChange])
  const handleWWChange = useCallback((val: number) => { setWw(val) }, [])
  const handleWCChange = useCallback((val: number) => { setWc(val) }, [])

  const handleReset = useCallback(() => {
    const slice = series.slices[0]; if (!slice) return
    const ds = dicomParser.parseDicom(new Uint8Array(slice.buffer))
    const pe = ds.elements['x7fe00010']; if (!pe || !pe.dataOffset) return
    const effSlope = getEffectiveSlope(slice.slope)
    const effIntercept = getEffectiveIntercept(slice.intercept)
    const raw = new Uint8Array(slice.buffer, pe.dataOffset, Math.min(pe.length, 65536))
    const samples: number[] = []
    const bits = slice.bitsAlloc
    for (let i = 0; i < raw.length; i += 4) {
      const v = bits === 16 ? (raw[i] | (raw[i+1] << 8)) : raw[i]
      samples.push(v * effSlope + effIntercept)
    }
    samples.sort((a, b) => a - b)
    const n = samples.length
    const p10 = samples[Math.floor(n * 0.10)]
    const p50 = samples[Math.floor(n * 0.50)]
    const p90 = samples[Math.floor(n * 0.90)]
    const p95 = samples[Math.floor(n * 0.95)]
    let w: number, c: number
    if (p50 === 0) {
      const upper = Math.max(p95, p90, 500)
      w = Math.min(Math.max(upper - p10, 1500), 3500)
      c = Math.round((p10 + upper) / 2)
    } else {
      w = Math.min(Math.max(p90 - p10, 200), 8000)
      c = Math.round((p10 + p90) / 2)
    }
    setWw(w); setWc(c)
  }, [series])

  const toolLabel = { zoom: '缩放', pan: '平移', wwwc: '窗宽窗位', length: '测距' }[tool]

  return (
    <div className="viewer-panel">
      <div className="panel-header">
        <div className="panel-meta">
          <span className="year-badge">{series.year}</span>
          <span className="series-label">{series.seriesDesc}</span>
        </div>
        <button className="btn-remove" onClick={onRemove} title="移除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      <div className="dicom-canvas">
        {loading && (<div className="loading-overlay"><div className="spinner" /><span>正在解析 DICOM...</span></div>)}
        {error && (<div className="error-overlay"><span>{error}</span></div>)}
        <canvas ref={canvasRef} className="dicom-render" />
      </div>
      <div className="panel-controls">
        <div className="control-row">
          <span className="control-label">层</span>
          <input type="range" min={0} max={Math.max(0, series.slices.length - 1)} value={activeSlice} onChange={e => handleSliceChange(Number(e.target.value))} />
          <span className="control-value num">{activeSlice + 1} / {series.slices.length}</span>
        </div>
        <div className="control-row">
          <span className="control-label">WW</span>
          <input type="range" min={1} max={4000} value={ww} onChange={e => handleWWChange(Number(e.target.value))} />
          <span className="control-value num">{ww}</span>
        </div>
        <div className="control-row">
          <span className="control-label">WC</span>
          <input type="range" min={-2000} max={2000} value={wc} onChange={e => handleWCChange(Number(e.target.value))} />
          <span className="control-value num">{wc}</span>
        </div>
        <button className="btn-reset" onClick={handleReset} title="重置视图">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 4v6h6M23 20v-6h-6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
      <div className="panel-tool-hint">{toolLabel} · {series.slices.length} 层</div>
    </div>
  )
}
