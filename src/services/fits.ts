import { apiUrl } from './api'

export type FitsImage = {
  width: number
  height: number
  unit: string
  observation_id: string
  created_at: string
  axis1: string
  axis2: string
  center_ra: number
  center_dec: number
  image_count: number
  hdu_index: number
  image_hdus: number[]
  plane_count: number
  plane_index: number
}

export type DetectedSource = {
  x: number
  y: number
  ra: number
  dec: number
  flux: number
  flux_error: number
  snr: number
  area_pixels: number
}

export type ComparedSource = {
  id: string
  object_type: string
  status: 'common' | 'brightness_candidate' | 'position_candidate' | 'not_detected_later' | 'new_candidate'
  brightness_candidate?: boolean
  position_candidate?: boolean
  earlier: DetectedSource | null
  later: DetectedSource | null
  brightness_delta?: number
  brightness_percent?: number
  brightness_significance?: number
  position_delta_pixels?: number
  position_delta_arcsec?: number
}

export type FitsComparison = {
  earlier: FitsImage & { date_mjd: number; band: string; pixel_scale_arcsec: number }
  later: FitsImage & { date_mjd: number; band: string; pixel_scale_arcsec: number }
  comparison: { width: number; height: number; overlap_pixels: number; localization: [number, number] }
  sources: ComparedSource[]
  source_list_truncated: boolean
  displayed_source_limit: number
  summary: {
    earlier_detected: number
    later_detected: number
    common: number
    new_candidates: number
    not_detected_later: number
    brightness_candidates: number
    position_candidates: number
  }
  quality_note: string
  images: { earlier_png: string; later_png: string; difference_png: string }
}

export function productPngProxyUrl(accessUrl: string, hdu = 0, plane = 0): string {
  const params = new URLSearchParams({ url: accessUrl, hdu: String(hdu), plane: String(plane) })
  return apiUrl(`/api/irsa/product/png?${params.toString()}`)
}

export function productDownloadProxyUrl(accessUrl: string): string {
  return apiUrl(`/api/irsa/product/download?${new URLSearchParams({ url: accessUrl }).toString()}`)
}

export function productComparisonProxyUrl(earlier: {
  observation: { accessUrl: string; date: string }; hdu?: number; plane?: number
}, later: {
  observation: { accessUrl: string; date: string }; hdu?: number; plane?: number
}): string {
  return apiUrl(`/api/irsa/compare?${new URLSearchParams({
    earlier_url: earlier.observation.accessUrl,
    later_url: later.observation.accessUrl,
    earlier_date: earlier.observation.date,
    later_date: later.observation.date,
    earlier_hdu: String(earlier.hdu ?? 0),
    later_hdu: String(later.hdu ?? 0),
    earlier_plane: String(earlier.plane ?? 0),
    later_plane: String(later.plane ?? 0),
  }).toString()}`)
}
