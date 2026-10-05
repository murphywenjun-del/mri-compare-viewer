import { useState, useCallback, useMemo } from 'react'
import { ViewerPanel } from './components/ViewerPanel'
import { Toolbar } from './components/Toolbar'
import { parseDICOMSlice, groupSlicesIntoSeries } from './utils/dicom'
import type { DICOMSeries, DICOMSlice } from './types'

// Group series by year, then by series description so matching sequences align
type YearGroup = { year: string; series: DICOMSeries[]; maxSlices: number }
type SeriesByKey = Map<string, DICOMSeries>

function buildYearGroups(seriesList: DICOMSeries[]): YearGroup[] {
  const yearMap = new Map<string, SeriesByKey>()

  for (const s of seriesList) {
    if (!yearMap.has(s.year)) yearMap.set(s.year, new Map())
    const keyMap = yearMap.get(s.year)!
    const key = s.seriesDesc ?? s.seriesNumber
    // Keep the first occurrence for each series description within a year
    if (!keyMap.has(key)) keyMap.set(key, s)
  }

  const years = [...yearMap.keys()].sort()
  return years.map(year => {
    const keyMap = yearMap.get(year)!
    const series = [...keyMap.values()]
    const maxSlices = Math.max(...series.map(s => s.slices.length), 1)
    return { year, series, maxSlices }
  })
}

export default function App() {
  const [seriesList, setSeriesList] = useState<DICOMSeries[]>([])
  const [activeTool, setActiveTool] = useState<'zoom' | 'pan' | 'wwwc' | 'length'>('wwwc')
  const [syncedSlice, setSyncedSlice] = useState<number>(0)
  const [loadingAll, setLoadingAll] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // Synced WW/CC per series description key (shared across years)
  const [syncWW, setSyncWW] = useState<Map<string, number>>(new Map())
  const [syncWC, setSyncWC] = useState<Map<string, number>>(new Map())

  const yearGroups = useMemo(() => buildYearGroups(seriesList), [seriesList])
  // Collect all unique series descriptions across all years, in order of first appearance
  const allSeriesKeys = useMemo(() => {
    const seen = new Set<string>()
    const order: string[] = []
    for (const yg of yearGroups) {
      for (const s of yg.series) {
        const key = s.seriesDesc ?? s.seriesNumber
        if (!seen.has(key)) { seen.add(key); order.push(key) }
      }
    }
    return order
  }, [yearGroups])

  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return

    setLoadingAll(true)
    setErrorMsg(null)

    const slices: DICOMSlice[] = []
    let errors = 0

    for (const file of files) {
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
      const existingKeys = new Set(prev.map(s => s.id))
      const toAdd = newSeries.filter(s => !existingKeys.has(s.id))
      return [...prev, ...toAdd]
    })

    if (newSeries.length > 0) {
      setSyncedSlice(0)
    }

    setLoadingAll(false)
    if (errors > 0) {
      setErrorMsg(`完成，${errors} 个文件解析失败`)
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

  // Sync WW/WC across all panels of the same series description
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

  const hasMultipleYears = yearGroups.length > 1

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
            <p>添加 DICOM 文件夹或文件，自动按年份和序列分组对比</p>
            <div className="empty-hints">
              <span>支持整个 DICOM 文件夹</span>
              <span>·</span>
              <span>自动按序列分组</span>
              <span>·</span>
              <span>多年度并排对比</span>
              <span>·</span>
              <span>窗宽窗位同步</span>
            </div>
          </div>
        ) : hasMultipleYears ? (
          <div className="year-compare-view">
            {allSeriesKeys.map((seriesKey, rowIdx) => (
              <div key={seriesKey} className="series-row">
                {/* Row label */}
                <div className="series-label-cell">
                  <span className="series-label-text">{seriesKey}</span>
                </div>
                {/* Year columns */}
                {yearGroups.map(yg => {
                  const series = yg.series.find(s => (s.seriesDesc ?? s.seriesNumber) === seriesKey)
                  if (!series) {
                    return <div key={yg.year} className="series-cell empty-cell" />
                  }
                  const effSlope = series.slices[0]?.slope ?? 1
                  const effIntercept = series.slices[0]?.intercept ?? 0
                  const effectiveSlope = (!effSlope || effSlope === 0 || Math.abs(effSlope) < 0.01 || !isFinite(effSlope)) ? 1 : effSlope
                  const effectiveIntercept = (!effIntercept || Math.abs(effIntercept) < 1e-6 || !isFinite(effIntercept)) ? 0 : effIntercept
                  return (
                    <div key={yg.year} className="series-cell">
                      <ViewerPanel
                        series={series}
                        tool={activeTool}
                        onRemove={() => removeSeries(series.id)}
                        syncedSlice={syncedSlice}
                        onSliceChange={handleSliceChange}
                        syncedWw={syncWW.get(seriesKey)}
                        syncedWc={syncWC.get(seriesKey)}
                        onWwChange={(v) => handleWWChange(seriesKey, v)}
                        onWcChange={(v) => handleWCChange(seriesKey, v)}
                        onReset={() => handleReset(seriesKey)}
                      />
                    </div>
                  )
                })}
              </div>
            ))}
            {/* Year header row */}
            <div className="year-header-row">
              <div className="series-label-cell" />
              {yearGroups.map(yg => (
                <div key={yg.year} className="year-header-cell">
                  <span className="year-header-badge">{yg.year}</span>
                  <span className="year-series-count">{yg.series.length} 个序列</span>
                </div>
              ))}
            </div>
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
