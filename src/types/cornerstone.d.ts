declare module 'cornerstone-core' {
  export as namespace cornerstone;
  export interface IImage {
    imageId: string;
    rows: number;
    columns: number;
    width: number;
    height: number;
    minPixelValue: number;
    maxPixelValue: number;
    slope?: number;
    intercept?: number;
    pixelData: Uint8Array | Uint16Array | Float32Array;
    canvas: HTMLCanvasElement;
    color: boolean;
    inverted: boolean;
    columnPixelSpacing?: number;
    rowPixelSpacing?: number;
    windowCenter?: number;
    windowWidth?: number;
    [key: string]: any;
  }
  export interface IViewport {
    zoom?: number;
    pan?: { x: number; y: number };
    invert?: boolean;
    vni?: {
      voi?: { min: number; max: number };
      lut?: number;
      windowCenter?: number;
      windowWidth?: number;
    };
    aspectRatio?: number;
    seriesInstanceUID?: string;
    [key: string]: any;
  }
  export function enable(element: HTMLElement): void;
  export function disable(element: HTMLElement): void;
  export function displayImage(element: HTMLElement, image: IImage, viewport?: IViewport): void;
  export function getViewport(element: HTMLElement): IViewport | null;
  export function setViewport(element: HTMLElement, viewport: IViewport): void;
  export function reset(element: HTMLElement): void;
  export function getImage(element: HTMLElement): IImage | null;
  export function bumpSliceLevel(element: HTMLElement, delta?: number): void;
  export function loadImage(imageId: string): Promise<IImage>;
  export function releaseImage(imageId: string): void;
  export function registerImageLoader(id: string, loader: (imageId: string) => Promise<IImage>): void;
  export const external: { DICOM: any };
}
declare module 'dicom-image-loader' {
  export function dataSet(arrayBuffer: ArrayBuffer): any;
  export function generateMetaDataSet(dataSets: any[]): any;
  export function createImageId(dataSet: any, metadata: any): string;
  export function enhanceLoader(externalDicom: any): { loadImage: (imageId: string) => Promise<any> };
}
