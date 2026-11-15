import { apiUrl } from './api'

export type Observation = {
  collection: string
  target: string
  date: string
  ra: string
  dec: string
  format: string
  accessUrl: string
  previewUrl: string
  wavelengthMin: number | null
  wavelengthMax: number | null
  raw: Record<string, string>
}

export type SearchResult = {
  observations: Observation[]
  searchedAt: string
  cached: boolean
}

export const SPHEREX_COLLECTIONS = [
  'spherex_dr1',
  'spherex_dr1_deep',
  'spherex_qr3',
  'spherex_qr3_deep',
] as const

export type SpherexCollection = (typeof SPHEREX_COLLECTIONS)[number]
export type CollectionMode = 'wide' | 'deep' | 'both'

const CACHE_MS = 15 * 60 * 1000

export function normalizeRa(value: number): number {
  const ra = Number(value)
  if (!Number.isFinite(ra)) return 0
  const wrapped = ((ra % 360) + 360) % 360
  return wrapped === 360 ? 0 : wrapped
}

export function normalizeDec(value: number): number {
  const dec = Number(value)
  if (!Number.isFinite(dec)) return 0
  return Math.min(90, Math.max(-90, dec))
}

export function resolveCollections(mode: CollectionMode = 'both'): SpherexCollection[] {
  switch (mode) {
    case 'wide':
      return ['spherex_dr1', 'spherex_qr3']
    case 'deep':
      return ['spherex_dr1_deep', 'spherex_qr3_deep']
    case 'both':
    default:
      return ['spherex_dr1', 'spherex_dr1_deep', 'spherex_qr3', 'spherex_qr3_deep']
  }
}

export function formatObservationDate(value: string): string {
  if (!value.trim()) return ''
  const mjd = Number(value)
  if (!Number.isFinite(mjd)) return value
  const date = new Date((mjd - 40587) * 86400000)
  if (!Number.isFinite(date.getTime())) return `MJD ${value}`
  return `${date.toISOString().slice(0, 10)} (MJD ${value})`
}

export function observationDateKey(value: string): string {
  if (!value.trim()) return ''
  const mjd = Number(value)
  if (!Number.isFinite(mjd)) return value.slice(0, 10)
  const date = new Date((mjd - 40587) * 86400000)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : `MJD ${value}`
}

export function observationTimeValue(value: string): number {
  const mjd = Number(value)
  return Number.isFinite(mjd) ? mjd : Date.parse(value)
}

function fieldValue(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
    if (key && row[key]) return row[key]
  }
  return ''
}

function parseVOTable(xml: string): Observation[] {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  const parseError = document.querySelector('parsererror')
  if (parseError) throw new Error('explorer.errorUnreadable')

  const queryError = [...document.getElementsByTagNameNS('*', 'INFO')]
    .find((info) => info.getAttribute('name') === 'QUERY_STATUS' && info.getAttribute('value') === 'ERROR')
  if (queryError) throw new Error('explorer.errorQuery')

  const table = document.getElementsByTagNameNS('*', 'TABLE')[0]
  if (!table) throw new Error('explorer.errorNoTable')
  const names = [...table.getElementsByTagNameNS('*', 'FIELD')].map((field) => (
    field.getAttribute('name') || field.getAttribute('ID') || ''
  ))
  const tableData = table.getElementsByTagNameNS('*', 'TABLEDATA')[0]
  if (!tableData) return []

  return [...tableData.getElementsByTagNameNS('*', 'TR')].map((tr) => {
    const values = [...tr.getElementsByTagNameNS('*', 'TD')].map((td) => td.textContent?.trim() || '')
    const raw = Object.fromEntries(names.map((name, index) => [name, values[index] || '']))
    const min = Number(fieldValue(raw, 'em_min'))
    const max = Number(fieldValue(raw, 'em_max'))
    return {
      collection: fieldValue(raw, 'obs_collection', 'collection'),
      target: fieldValue(raw, 'target_name', 'target'),
      date: fieldValue(raw, 't_min', 'obs_date', 'date_obs'),
      ra: fieldValue(raw, 's_ra', 'ra'),
      dec: fieldValue(raw, 's_dec', 'dec'),
      format: fieldValue(raw, 'dataproduct_type', 'access_format'),
      accessUrl: fieldValue(raw, 'access_url'),
      previewUrl: fieldValue(raw, 'preview_url'),
      wavelengthMin: Number.isFinite(min) ? min : null,
      wavelengthMax: Number.isFinite(max) ? max : null,
      raw,
    }
  }).filter((row) => row.accessUrl || row.previewUrl)
}

export async function searchSpherex(
  ra: number,
  dec: number,
  radius = 0.1,
  options: { collections?: string[] | string; maxRec?: number } = {},
): Promise<SearchResult> {
  const normalizedRa = normalizeRa(ra)
  const normalizedDec = normalizeDec(dec)
  if (!Number.isFinite(ra) || ra < 0 || ra > 360 || !Number.isFinite(dec) || dec < -90 || dec > 90) {
    throw new Error('explorer.errorInvalid')
  }
  const collections = Array.isArray(options.collections)
    ? options.collections.filter((value): value is string => Boolean(value && value.trim()))
    : typeof options.collections === 'string' && options.collections.trim()
      ? options.collections.split(',').map((value) => value.trim()).filter(Boolean)
      : ['spherex_dr1']
  const maxRec = Number.isFinite(options.maxRec) ? Math.max(1, Math.min(1000, Number(options.maxRec))) : 500
  const key = `cosmic-lens-sia:${normalizedRa.toFixed(5)}:${normalizedDec.toFixed(5)}:${radius}:${collections.join(',')}:${maxRec}`
  try {
    const cached = localStorage.getItem(key)
    if (cached) {
      const parsed = JSON.parse(cached) as { storedAt: number; observations: Observation[] }
      if (Date.now() - parsed.storedAt < CACHE_MS) {
        return { observations: parsed.observations, searchedAt: new Date(parsed.storedAt).toISOString(), cached: true }
      }
    }
  } catch {
    // A blocked or malformed local cache should not prevent a fresh archive search.
  }

  const params = new URLSearchParams({
    ra: String(normalizedRa),
    dec: String(normalizedDec),
    radius: String(radius),
    collections: collections.join(','),
    maxrec: String(maxRec),
  })
  let response: Response
  try {
    response = await fetch(apiUrl(`/api/irsa/sia?${params.toString()}`), { signal: AbortSignal.timeout(90000) })
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error('explorer.errorTimeout')
    }
    throw new Error('explorer.errorNetwork')
  }
  if (!response.ok) throw new Error(`explorer.errorHttp:${response.status}`)
  const observations = parseVOTable(await response.text()).filter((observation, index, list) => (
    Boolean(observation.accessUrl) && list.findIndex((candidate) => candidate.accessUrl === observation.accessUrl) === index
  ))
  const storedAt = Date.now()
  try {
    localStorage.setItem(key, JSON.stringify({ storedAt, observations }))
  } catch {
    // Storage is optional; the live search remains usable.
  }
  return { observations, searchedAt: new Date(storedAt).toISOString(), cached: false }
}

export function archiveSearchUrl(
  ra: number,
  dec: number,
  collections: string[] | string = ['spherex_dr1'],
  radius = 0.1,
): string {
  const normalizedCollections = Array.isArray(collections)
    ? collections.filter((value) => value && value.trim())
    : collections.split(',').map((value) => value.trim()).filter(Boolean)
  const query = new URLSearchParams({
    COLLECTION: (normalizedCollections.length ? normalizedCollections : ['spherex_dr1']).join(','),
    POS: `CIRCLE ${normalizeRa(ra)} ${normalizeDec(dec)} ${radius}`,
    MAXREC: '500',
  })
  return `https://irsa.ipac.caltech.edu/SIA?${query.toString()}`
}

export const IRSA_DOCS = 'https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html'
export const IRSA_EXPLORER = 'https://irsa.ipac.caltech.edu/applications/spherex/'
