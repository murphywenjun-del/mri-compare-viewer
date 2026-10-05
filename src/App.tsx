import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { ViewerPanel } from './components/ViewerPanel'
import { Toolbar } from './components/Toolbar'
import { parseDICOMSlice, groupSlicesIntoSeries } from './utils/dicom'
import type { DICOMSeries, DICOMSlice } from './types'

// ─── Types ───────────────────────────────────────────────────────────
type YearGroup = { year: string; series: DICOMSeries[] }
type SeriesByKey = Map<string, DICOMSeries>

// ─── Series description normalization ────────────────────────────────
// Normalizes series descriptions so "MRI MS BRAIN" and "MRI MS BRAIN CERVICAL SPINE 3D"
// can be matched as related sequences for cross-year comparison.
function normalizeSeriesDesc(desc: string): string {
  return desc
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Computes a similarity score between two normalized descriptions.
// Returns 1.0 for exact match, 0.5 for substring, 0.0 for unrelated.
function seriesSimilarity(a: string, b: string): number {
  const na = normalizeSeriesDesc(a)
  const nb = normalizeSeriesDesc(b)
  if (na === nb) return 1.0
  if (na.includes(nb) || nb.includes(na)) return 0.5
  // Check if they share key words
  const wordsA = na.split(' ')
  const wordsB = nb.split(' ')
  const common = wordsA.filter(w => wordsB.includes(w)).length
  const total = new Set([...wordsA, ...wordsB]).size
  if (total === 0) return 0
  return common / total
}

// Finds the best matching series in `candidates` for a given description.
function findBestMatch(seriesDesc: string, candidates: DICOMSeries[]): DICOMSeries | null {
  let best: DICOMSeries | null = null
  let bestScore = 0
  for (const c of candidates) {
    const score = seriesSimilarity(seriesDesc, c.seriesDesc ?? c.seriesNumber)
    if (score > bestScore) { bestScore = score; best = c }
  }
  return bestScore >= 0.5 ? best : null
}

// ─── Grouping ────────────────────────────────────────────────────────
function buildYearGroups(seriesList: DICOMSeries[]): YearGroup[] {
  const yearMap = new Map<string, DICOMSeries[]>()
  for (const s of seriesList) {
    if (!yearMap.has(s.year)) yearMap.set(s.year, [])
    yearMap.get(s.year)!.push(s)
  }
  const years = [...yearMap.keys()].sort()
  return years.map(year => ({ year, series: yearMap.get(year)! }))
}

// Builds aligned rows: each row = one logical sequence, columns = years.
// Uses fuzzy matching so "BRAIN 3D" in 2026 matches "BRAIN CERVICAL SPINE 3D" in 2025.
function buildAlignedRows(
  yearGroups: YearGroup[],
  seriesList: DICOMSeries[]
): { rowKey: string; seriesDesc: string; entries: { year: string; series: DICOMSeries | null }[] }[] {
  // Collect all unique series descriptions in order of appearance
  const seen = new Set<string>()
  const allDescriptions: string[] = []
  for (const s of seriesList) {
    const desc = s.seriesDesc ?? s.seriesNumber
    if (!seen.has(desc)) { seen.add(desc); allDescriptions.push(desc) }
  }

  return allDescriptions.map(desc => {
    const entries = yearGroups.map(yg => {
      const match = findBestMatch(desc, yg.series)
      return { year: yg.year, series: match }
    })
    return { rowKey: desc, seriesDesc: desc, entries }
  })
}

// ─── Known data folders ──────────────────────────────────────────────
// Relative to public/data/ — auto-loaded on startup.
const KNOWN_DATA_FOLDERS = [
  'IMAGES_Teng_2025:10:31',
  'IMAGES_Teng_2026:10:04',
] as const

// ─── Demo data loader ────────────────────────────────────────────────
// Loads pre-stored DICOM data from public/data/ on app startup.
// Uses HEAD requests to efficiently scan for existing files.
async function loadDemoData(): Promise<DICOMSeries[]> {
  const allSeries: DICOMSeries[] = []

  for (const folder of KNOWN_DATA_FOLDERS) {
    const dicomUrl = `/data/${folder}/IMAGES/DICOMS`
    try {
      // Check if folder exists
      const sampleResp = await fetch(`${dicomUrl}/IM1`, { method: 'HEAD' })
      if (!sampleResp.ok) continue

      // Scan for files using HEAD requests, checking content-type to distinguish from SPA fallback
      const files: string[] = []
      for (let i = 1; i <= 3000; i++) {
        const fname = `IM${i}`
        try {
          const resp = await fetch(`${dicomUrl}/${fname}`, { method: 'HEAD' })
          // Vite SPA fallback returns 200 for missing files but with text/html content-type
          const ct = resp.headers.get('content-type') || ''
          if (resp.ok && !ct.includes('text/html')) files.push(fname)
        } catch { break }
      }

      if (files.length === 0) continue

      const slices: DICOMSlice[] = []
      for (const fname of files) {
        try {
          const resp = await fetch(`${dicomUrl}/${fname}`)
          if (!resp.ok) continue
          const buffer = await resp.arrayBuffer()
          const slice = parseDICOMSlice(buffer, fname)
          if (slice) slices.push(slice)
        } catch { /* skip */ }
      }

      if (slices.length > 0) {
        const grouped = groupSlicesIntoSeries(slices)
        for (const [, series] of grouped) {
          allSeries.push(series)
        }
      }
    } catch { /* skip folder */ }
  }
  return allSeries
}

// ─── Main App ────────────────────────────────────────────────────────
export default function App() {
  const [seriesList, setSeriesList] = useState<DICOMSeries[]>([])
  const [activeTool, setActiveTool] = useState<'zoom' | 'pan' | 'wwwc' | 'length'>('wwwc')
  const [syncedSlice, setSyncedSlice] = useState<number>(0)
  const [loadingAll, setLoadingAll] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [syncWW, setSyncWW] = useState<Map<string, number>>(new Map())
  const [syncWC, setSyncWC] = useState<Map<string, number>>(new Map())
  const loadedRef = useRef(false)

  const yearGroups = useMemo(() => buildYearGroups(seriesList), [seriesList])
  const alignedRows = useMemo(
    () => buildAlignedRows(yearGroups, seriesList),
    [yearGroups, seriesList]
  )
  const hasMultipleYears = yearGroups.length > 1

  // Auto-load demo data on mount (one-shot via ref)
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    loadDemoData().then(newSeries => {
      if (newSeries.length > 0) {
        setSeriesList(newSeries)
      }
    }).catch(() => {})
  }, [])

  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return

    setLoadingAll(true)
    setErrorMsg(null)

    const slices: DICOMSlice[] = []
    let errors = 0
    const seenNames = new Set<string>()

    for (const file of files) {
      // Deduplicate by name to avoid re-processing
      if (seenNames.has(file.name)) continue
      seenNames.add(file.name)

      try {
        const buffer = await file.arrayBuffer()
        const view = new Uint8Array(buffer)
        let isDicom = false
        for (let i = 0; i < Math.min(256, view.length - 4); i++) {
          if (view[i] === 0x44 && view[i+1] === 0x49 && view[i+2] === 0x43 && view[i+3] === 0x4D) {
            isDicom = true
            break
          }
        }
        if (!isDicom) continue

        const slice = parseDICOMSlice(buffer, file.name)
        if (slice) {
          slices.push(slice)
        } else {
          errors++
        }
      } catch {
        errors++
      }
    }

    if (slices.length === 0) {
      setErrorMsg('未找到有效的 DICOM 文件，请确认文件为 DICOM 格式')
      setLoadingAll(false)
      return
    }

    const grouped = groupSlicesIntoSeries(slices)
    const newSeries: DICOMSeries[] = []
    for (const [, series] of grouped) {
      newSeries.push(series)
    }

    setSeriesList(prev => {
      const existingIds = new Set(prev.map(s => s.id))
      const toAdd = newSeries.filter(s => !existingIds.has(s.id))
      return [...prev, ...toAdd]
    })

    if (newSeries.length > 0) {
      setSyncedSlice(0)
    }

    setLoadingAll(false)
    if (errors > 0) {
      setErrorMsg(`完成，${errors} 个文件解析失败`)
    } else {
      setErrorMsg(null)
    }
  }, [])

  const handleAddFolder = useCallback((files: File[]) => {
    processFiles(files)
  }, [processFiles])

  const removeSeries = useCallback((id: string) => {
    setSeriesList(prev => prev.filter(s => s.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setSeriesList([])
    setSyncedSlice(0)
    setSyncWW(new Map())
    setSyncWC(new Map())
    setErrorMsg(null)
  }, [])

  const handleSliceChange = useCallback((index: number) => {
    setSyncedSlice(index)
  }, [])

  const handleWWChange = useCallback((seriesDescKey: string, val: number) => {
    setSyncWW(prev => { const next = new Map(prev); next.set(seriesDescKey, val); return next })
  }, [])

  const handleWCChange = useCallback((seriesDescKey: string, val: number) => {
    setSyncWC(prev => { const next = new Map(prev); next.set(seriesDescKey, val); return next })
  }, [])

  const handleReset = useCallback((seriesDescKey: string) => {
    setSyncWW(prev => { const next = new Map(prev); next.delete(seriesDescKey); return next })
    setSyncWC(prev => { const next = new Map(prev); next.delete(seriesDescKey); return next })
  }, [])

  return (
    <div className="app">
      <Toolbar
        onAdd={() => {}}
        onAddFolder={handleAddFolder}
        onClear={clearAll}
        activeTool={activeTool}
        onToolChange={setActiveTool}
        seriesCount={seriesList.length}
        yearCount={yearGroups.length}
      />

      {loadingAll && (
        <div className="global-loading">
          <div className="spinner" />
          <span>正在解析 DICOM 文件...</span>
        </div>
      )}

      {errorMsg && (
        <div className="global-error">{errorMsg}</div>
      )}

      <main className="viewer-container">
        {seriesList.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="4"/>
                <line x1="12" y1="2" x2="12" y2="4"/>
                <line x1="12" y1="20" x2="12" y2="22"/>
                <line x1="2" y1="12" x2="4" y2="12"/>
                <line x1="20" y1="12" x2="22" y2="12"/>
              </svg>
            </div>
            <h2>MRI 多年度对比查看器</h2>
            <p>自动加载本地数据，或拖入 DICOM 文件夹进行对比</p>
            <div className="empty-hints">
              <span>自动按年份分组</span>
              <span>·</span>
              <span>智能序列匹配</span>
              <span>·</span>
              <span>多年度并排对比</span>
              <span>·</span>
              <span>窗宽窗位同步</span>
            </div>
          </div>
        ) : hasMultipleYears ? (
          <div className="year-compare-view">
            {/* Column headers */}
            <div className="year-header-row">
              <div className="series-label-cell" />
              {yearGroups.map(yg => (
                <div key={yg.year} className="year-header-cell">
                  <span className="year-header-badge">{yg.year}</span>
                  <span className="year-series-count">{yg.series.length} 个序列</span>
                </div>
              ))}
            </div>

            {/* Data rows */}
            {alignedRows.map(({ rowKey, seriesDesc, entries }) => (
              <div key={rowKey} className="series-row">
                <div className="series-label-cell">
                  <span className="series-label-text" title={seriesDesc}>{seriesDesc}</span>
                </div>
                {entries.map(({ year, series }) => {
                  if (!series) {
                    return <div key={year} className="series-cell empty-cell" />
                  }
                  return (
                    <div key={year} className="series-cell">
                      <ViewerPanel
                        series={series}
                        tool={activeTool}
                        onRemove={() => removeSeries(series.id)}
                        syncedSlice={syncedSlice}
                        onSliceChange={handleSliceChange}
                        syncedWw={syncWW.get(rowKey)}
                        syncedWc={syncWC.get(rowKey)}
                        onWwChange={(v) => handleWWChange(rowKey, v)}
                        onWcChange={(v) => handleWCChange(rowKey, v)}
                        onReset={() => handleReset(rowKey)}
                      />
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        ) : (
          // Single year: flat grid layout
          <div className={`panel-grid grid-${Math.min(seriesList.length, 4)}`}>
            {seriesList.map(series => (
              <ViewerPanel
                key={series.id}
                series={series}
                tool={activeTool}
                onRemove={() => removeSeries(series.id)}
                syncedWw={syncWW.get(series.seriesDesc ?? series.seriesNumber)}
                syncedWc={syncWC.get(series.seriesDesc ?? series.seriesNumber)}
                onWwChange={(v) => handleWWChange(series.seriesDesc ?? series.seriesNumber, v)}
                onWcChange={(v) => handleWCChange(series.seriesDesc ?? series.seriesNumber, v)}
                onReset={() => handleReset(series.seriesDesc ?? series.seriesNumber)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
