import { useState, useCallback } from 'react'
import { ViewerPanel } from './components/ViewerPanel'
import { Toolbar } from './components/Toolbar'
import { parseDICOMSlice, groupSlicesIntoSeries } from './utils/dicom'
import type { DICOMSeries, DICOMSlice } from './types'

export default function App() {
  const [seriesList, setSeriesList] = useState<DICOMSeries[]>([])
  const [activeTool, setActiveTool] = useState<'zoom' | 'pan' | 'wwwc' | 'length'>('wwwc')
  const [syncedSlice, setSyncedSlice] = useState<number>(0)
  const [loadingAll, setLoadingAll] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

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

  const handleAdd = useCallback((_file: File, _year: string) => {
    // Legacy single-file handler - nothing to do
  }, [])

  const removeSeries = useCallback((id: string) => {
    setSeriesList(prev => prev.filter(s => s.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setSeriesList([])
    setSyncedSlice(0)
    setErrorMsg(null)
  }, [])

  const handleSliceChange = useCallback((index: number) => {
    setSyncedSlice(index)
  }, [])

  return (
    <div className="app">
      <Toolbar
        onAdd={handleAdd}
        onAddFolder={handleAddFolder}
        onClear={clearAll}
        activeTool={activeTool}
        onToolChange={setActiveTool}
        seriesCount={seriesList.length}
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
            <p>添加 DICOM 文件夹或文件，按年度分组对比影像变化</p>
            <div className="empty-hints">
              <span>支持整个 DICOM 文件夹</span>
              <span>·</span>
              <span>自动按序列分组</span>
              <span>·</span>
              <span>窗宽窗位自动适配</span>
              <span>·</span>
              <span>切片同步滑动</span>
            </div>
          </div>
        ) : (
          <div className={`panel-grid grid-${Math.min(seriesList.length, 4)}`}>
            {seriesList.map(series => (
              <ViewerPanel
                key={series.id}
                series={series}
                tool={activeTool}
                onRemove={() => removeSeries(series.id)}
                syncedSlice={seriesList.length > 1 ? syncedSlice : undefined}
                onSliceChange={seriesList.length > 1 ? handleSliceChange : undefined}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
