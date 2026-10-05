import { useState, useRef, useCallback } from 'react'
import { isDICOM } from '../utils/dicom'

interface ToolbarProps {
  onAdd: (file: File, year: string) => void
  onAddFolder: (files: File[]) => void
  onClear: () => void
  activeTool: 'zoom' | 'pan' | 'wwwc' | 'length'
  onToolChange: (tool: 'zoom' | 'pan' | 'wwwc' | 'length') => void
  seriesCount: number
  yearCount?: number
}

const TOOLS: { id: 'zoom' | 'pan' | 'wwwc' | 'length'; label: string; icon: React.ReactNode }[] = [
  {
    id: 'wwwc', label: '窗宽窗位',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20" fill="currentColor" opacity="0.3"/></svg>,
  },
  {
    id: 'zoom', label: '缩放',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6" strokeLinecap="round"/></svg>,
  },
  {
    id: 'pan', label: '平移',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" strokeLinecap="round"/></svg>,
  },
  {
    id: 'length', label: '测距',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 6L3 24M3 6l18 18" strokeLinecap="round"/></svg>,
  },
]

export function Toolbar({ onAdd: _onAdd, onAddFolder, onClear, activeTool, onToolChange, seriesCount, yearCount }: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      onAddFolder(files)
    }
    e.target.value = ''
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const items = Array.from(e.dataTransfer.items)
    const files: File[] = []

    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) {
          const slice = file.slice(0, 256)
          slice.arrayBuffer().then(buf => {
            if (isDICOM(buf) && !files.includes(file!)) {
              files.push(file!)
            }
          })
        }
      }
    }

    if (files.length > 0) {
      onAddFolder(files)
    }
  }, [onAddFolder])

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => setDragOver(false)

  return (
    <>
      <header
        className={`toolbar ${dragOver ? 'drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <div className="toolbar-left">
          <div className="logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="4"/>
              <line x1="12" y1="2" x2="12" y2="4"/>
              <line x1="12" y1="20" x2="12" y2="22"/>
              <line x1="2" y1="12" x2="4" y2="12"/>
              <line x1="20" y1="12" x2="22" y2="12"/>
            </svg>
            <span>MRI Compare</span>
          </div>
          {seriesCount > 0 && (
            <span className="series-count">{seriesCount} 个序列{yearCount && yearCount > 1 ? ` · ${yearCount} 个年份` : ''}</span>
          )}
        </div>

        <nav className="toolbar-tools">
          {TOOLS.map(t => (
            <button
              key={t.id}
              className={`tool-btn ${activeTool === t.id ? 'active' : ''}`}
              onClick={() => onToolChange(t.id)}
              title={t.label}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="toolbar-right">
          <button
            className="btn-add"
            onClick={() => fileInputRef.current?.click()}
            title="选择 DICOM 文件"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
            </svg>
            添加文件
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden-input"
            onChange={handleFileChange}
          />

          <button
            className="btn-add btn-folder"
            onClick={() => folderInputRef.current?.click()}
            title="选择 DICOM 文件夹"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              <path d="M12 12v M12 12h" strokeLinecap="round"/>
            </svg>
            添加文件夹
          </button>
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden-input"
            onChange={handleFileChange}
            // @ts-ignore - webkitdirectory is non-standard but widely supported
            webkitdirectory=""
            directory=""
          />

          {seriesCount > 0 && (
            <button className="btn-clear" onClick={onClear}>清空</button>
          )}
        </div>
      </header>

      {dragOver && (
        <div className="drag-overlay">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>拖入 DICOM 文件或文件夹</span>
        </div>
      )}
    </>
  )
}
