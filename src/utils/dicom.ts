import * as dicomParser from 'dicom-parser'
import type { DICOMSlice, DICOMSeries } from '../types'

const DICM = new Uint8Array([0x44, 0x49, 0x43, 0x4D]) // 'DICM'

/**
 * Check if a file buffer contains a valid DICOM file.
 * Looks for 'DICM' marker within first 256 bytes.
 */
export function isDICOM(buffer: ArrayBuffer): boolean {
  const view = new Uint8Array(buffer)
  for (let i = 0; i < Math.min(256, view.length - 4); i++) {
    if (view[i] === DICM[0] && view[i+1] === DICM[1] &&
        view[i+2] === DICM[2] && view[i+3] === DICM[3]) {
      return true
    }
  }
  return false
}

/**
 * Parse a single DICOM file into a DICOMSlice.
 */
export function parseDICOMSlice(buffer: ArrayBuffer, fileName: string): DICOMSlice | null {
  try {
    const dataSet = dicomParser.parseDicom(new Uint8Array(buffer))

    const rows = dataSet.uint16('x00280010') ?? 256
    const cols = dataSet.uint16('x00280011') ?? 256
    const bitsAlloc = dataSet.uint16('x00280100') ?? 16
    const slope = dataSet.float('x00281053') ?? 1
    const intercept = dataSet.float('x00281052') ?? 0
    const modality = dataSet.string('x00080060') ?? 'MR'
    const instanceNum = dataSet.string('x00200013') ?? '0'
    const seriesNum = dataSet.string('x00200011') ?? '0'
    const studyDate = dataSet.string('x00080020') ?? ''
    const seriesDesc = dataSet.string('x00081030')

    // Detect and skip garbage slope/intercept (common in Philips DICOM)
    // Valid slope should be > 0.01 and < 100; valid intercept should be reasonable
    const isSlopeGarbage = !slope || slope === 0 || Math.abs(slope) < 0.01 || Math.abs(slope) > 100 || !isFinite(slope)
    const isInterceptGarbage = !intercept || Math.abs(intercept) < 1e-6 || !isFinite(intercept)
    const validSlope = isSlopeGarbage ? 1 : slope
    const validIntercept = isInterceptGarbage ? 0 : intercept

    return {
      name: fileName,
      buffer,
      rows,
      cols,
      bitsAlloc,
      slope: validSlope,
      intercept: validIntercept,
      instanceNumber: instanceNum,
      seriesNumber: seriesNum,
      studyDate,
      modality,
      seriesDesc: seriesDesc ?? undefined,
    }
  } catch {
    return null
  }
}

/**
 * Extract year from a study date string (YYYYMMDD format).
 */
export function extractYear(dateStr: string): string {
  if (!dateStr || dateStr.length < 4) return '未知年份'
  return dateStr.substring(0, 4)
}

/**
 * Group DICOM slices by series and organize by year.
 */
export function groupSlicesIntoSeries(slices: DICOMSlice[]): Map<string, DICOMSeries> {
  const seriesMap = new Map<string, DICOMSlice[]>()

  for (const slice of slices) {
    const key = `${slice.studyDate}_${slice.seriesNumber}`
    if (!seriesMap.has(key)) seriesMap.set(key, [])
    seriesMap.get(key)!.push(slice)
  }

  const result = new Map<string, DICOMSeries>()
  for (const [key, sliceList] of seriesMap) {
    sliceList.sort((a, b) => parseInt(a.instanceNumber) - parseInt(b.instanceNumber))
    const studyDate = sliceList[0].studyDate
    const year = extractYear(studyDate)
    const seriesNum = sliceList[0].seriesNumber
    const seriesDesc = sliceList[0].seriesDesc ?? `序列 ${seriesNum}`

    result.set(key, {
      id: key,
      seriesNumber: seriesNum,
      seriesDesc,
      modality: sliceList[0].modality,
      rows: sliceList[0].rows,
      cols: sliceList[0].cols,
      slices: sliceList,
      year,
      label: `${year} - ${seriesDesc}`,
    })
  }

  // Sort by year, then series number
  return new Map([...result.entries()].sort((a, b) => {
    const yearCompare = a[1].year.localeCompare(b[1].year)
    if (yearCompare !== 0) return yearCompare
    return parseInt(a[1].seriesNumber) - parseInt(b[1].seriesNumber)
  }))
}
