import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { ViewerPanel } from './components/ViewerPanel'
import { Toolbar } from './components/Toolbar'
import { parseDICOMSlice, groupSlicesIntoSeries } from './utils/dicom'
import type { DICOMSeries, DICOMSlice } from './types'

type YearGroup = { year: string; series: DICOMSeries[] }

function normalizeSeriesDesc(desc: string): string {
  return desc.toUpperCase().replace(/\s+/g, ' ').trim()
}

function seriesSimilarity(a: string, b: string): number {
  const na = normalizeSeriesDesc(a)
  const nb = normalizeSeriesDesc(b)
  if (na === nb) return 1.0
  if (na.includes(nb) || nb.includes(na)) return 0.5
  const wordsA = na.split(' ')
  const wordsB = nb.split(' ')
  const common = wordsA.filter(w => wordsB.includes(w)).length
  const total = new Set([...wordsA, ...wordsB]).size
  if (total === 0) return 0
  return common / total
}

function findBestMatch(seriesDesc: string, candidates: DICOMSeries[]): DICOMSeries | null {
  let best: DICOMSeries | null = null
  let bestScore = 0
  for (const c of candidates) {
    const score = seriesSimilarity(seriesDesc, c.seriesDesc ?? c.seriesNumber)
    if (score > bestScore) { bestScore = score; best = c }
  }
  return bestScore >= 0.5 ? best : null
}

function buildYearGroups(seriesList: DICOMSeries[]): YearGroup[] {
  const yearMap = new Map<string, DICOMSeries[]>()
  for (const s of seriesList) {
    if (!yearMap.has(s.year)) yearMap.set(s.year, [])
    yearMap.get(s.year)!.push(s)
  }
  const years = [...yearMap.keys()].sort()
  return years.map(year => ({ year, series: yearMap.get(year)! }))
}

function buildAlignedRows(
  yearGroups: YearGroup[],
  seriesList: DICOMSeries[]
): { rowKey: string; seriesDesc: string; entries: { year: string; series: DICOMSeries | null }[] }[] {
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
const KNOWN_DATA_FOLDERS = [
  { name: 'IMAGES_Teng_2025:10:31', year: '2025' },
  { name: 'IMAGES_Teng_2026:10:04', year: '2026' },
] as const

// ─── Demo data loader ────────────────────────────────────────────────
// Scans for the last sequential IM file (stops at first gap), then fetches
// all DICOM files in parallel batches for fast loading.
async function loadDemoData(): Promise<DICOMSeries[]> {
  const allSeries: DICOMSeries[] = []
  const MAX_FILES = 3000
  const BATCH_SIZE = 20

  for (const folder of KNOWN_DATA_FOLDERS) {
    const dicomUrl = `/data/${folder.name}/IMAGES/DICOMS`
    try {
      // Quick existence check
      const sampleResp = await fetch(`${dicomUrl}/IM1`)
      if (!sampleResp.ok) continue

      // Scan for last existing file (stop at first gap)
      let lastFile = 0
      for (let i = 1; i <= MAX_FILES; i++) {
        const fname = `IM${i}`
        try {
          const resp = await fetch(`${dicomUrl}/${fname}`, { method: 'HEAD' })
          const ct = resp.headers.get('content-type') || ''
          if (resp.ok && !ct.includes('text/html')) {
            lastFile = i
          } else {
            break
          }
        } catch { break }
      }

      if (lastFile === 0) continue
      console.log(`Auto-loading ${folder.name}: ${lastFile} files`)

      // Fetch in parallel batches
      const slices: DICOMSlice[] = []
      for (let start = 1; start <= lastFile; start += BATCH_SIZE) {
        const batch = Array.from({ length: Math.min(BATCH_SIZE, lastFile - start + 1) }, (_, j) => start + j)
        const results = await Promise.all(batch.map(async i => {
          const fname = `IM${i}`
          try {
            const resp = await fetch(`${dicomUrl}/${fname}`)
            if (!resp.ok) return null
            const buffer = await resp.arrayBuffer()
            return parseDICOMSlice(buffer, fname)
          } catch { return null }
        }))
        for (const slice of results) {
          if (slice) slices.push(slice)
        }
      }

      if (slices.length > 0) {
        const grouped = groupSlicesIntoSeries(slices)
        for (const [, series] of grouped) {
          allSeries.push(series)
        }
        console.log(`  → ${grouped.size} series for ${folder.year}`)
      }
    } catch (e) {
      console.warn(`Failed to load ${folder.name}:`, e)
    }
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
  const [uploadYear, setUploadYear] = useState<string>('自动')
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
    setLoadingAll(true)
    loadDemoData().then(newSeries => {
      console.log('Auto-load complete:', newSeries.length, 'series')
      if (newSeries.length > 0) setSeriesList(newSeries)
    }).catch(e => console.error('Auto-load failed:', e)).finally(() => setLoadingAll(false))
  }, [])

  const processFiles = useCallback(async (files: File[], yearOverride?: string) => {
    if (files.length === 0) return

    setLoadingAll(true)
    setErrorMsg(null)

    const slices: DICOMSlice[] = []
    let errors = 0
    const seenNames = new Set<string>()

    for (const file of files) {
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
        if (slice) slices.push(slice)
        else errors++
      } catch { errors++ }
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

    // If user selected a specific year, override the extracted year
    if (yearOverride && yearOverride !== '自动') {
      for (const s of newSeries) {
        s.year = yearOverride
        s.id = `${yearOverride}_${s.seriesNumber}`
        s.label = `${yearOverride} - ${s.seriesDesc}`
        for (const sl of s.slices) sl.studyDate = yearOverride + '0101'
      }
    }

    setSeriesList(prev => {
      const existingIds = new Set(prev.map(s => s.id))
      const toAdd = newSeries.filter(s => !existingIds.has(s.id))
      return [...prev, ...toAdd]
    })

    if (newSeries.length > 0) setSyncedSlice(0)
    setLoadingAll(false)
    setErrorMsg(errors > 0 ? `完成，${errors} 个文件解析失败` : null)
  }, [])

  const handleAddFolder = useCallback((files: File[]) => {
    processFiles(files, uploadYear)
  }, [processFiles, uploadYear])

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
        uploadYear={uploadYear}
        onYearChange={setUploadYear}
      />

      {loadingAll && (
        <div className="global-loading">
          <div className="spinner" />
          <span>正在加载 DICOM 文件...</span>
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
                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/>
                <line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/>
                <line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/>
              </svg>
            </div>
            <h2>MRI 多年度对比查看器</h2>
            <p>自动加载本地数据，或选择年份后上传 DICOM 文件夹进行对比</p>
            <div className="empty-hints">
              <span>自动按年份分组</span><span>·</span>
              <span>智能序列匹配</span><span>·</span>
              <span>多年度并排对比</span><span>·</span>
              <span>窗宽窗位同步</span>
            </div>
          </div>
        ) : hasMultipleYears ? (
          <div className="year-compare-view">
            <div className="year-header-row">
              <div className="series-label-cell" />
              {yearGroups.map(yg => (
                <div key={yg.year} className="year-header-cell">
                  <span className="year-header-badge">{yg.year}</span>
                  <span className="year-series-count">{yg.series.length} 个序列</span>
                </div>
              ))}
            </div>
            {alignedRows.map(({ rowKey, seriesDesc, entries }) => (
              <div key={rowKey} className="series-row">
                <div className="series-label-cell">
                  <span className="series-label-text" title={seriesDesc}>{seriesDesc}</span>
                </div>
                {entries.map(({ year, series }) => {
                  if (!series) return <div key={year} className="series-cell empty-cell" />
                  return (
                    <div key={year} className="series-cell">
                      <ViewerPanel
                        series={series} tool={activeTool}
                        onRemove={() => removeSeries(series.id)}
                        syncedSlice={syncedSlice} onSliceChange={handleSliceChange}
                        syncedWw={syncWW.get(rowKey)} syncedWc={syncWC.get(rowKey)}
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
          <div className={`panel-grid grid-${Math.min(seriesList.length, 4)}`}>
            {seriesList.map(series => (
              <ViewerPanel
                key={series.id} series={series} tool={activeTool}
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
