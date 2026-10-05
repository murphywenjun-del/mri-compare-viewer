export interface DICOMSlice {
  name: string
  buffer: ArrayBuffer
  rows: number
  cols: number
  bitsAlloc: number
  slope: number
  intercept: number
  instanceNumber: string
  seriesNumber: string
  studyDate: string
  modality: string
  seriesDesc?: string
}

export interface DICOMSeries {
  id: string
  seriesNumber: string
  seriesDesc: string
  modality: string
  rows: number
  cols: number
  slices: DICOMSlice[]
  year: string
  label: string
}

export interface WindowParams {
  ww: number
  wc: number
}
