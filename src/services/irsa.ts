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
  stale?: boolean
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

export function formatObservationTimestamp(value: string): string {
  if (!value.trim()) return ''
  const mjd = Number(value)
  const timestamp = Number.isFinite(mjd) ? (mjd - 40587) * 86400000 : Date.parse(value)
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date)
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
    const minValue = fieldValue(raw, 'em_min')
    const maxValue = fieldValue(raw, 'em_max')
    const min = minValue ? Number(minValue) : Number.NaN
    const max = maxValue ? Number(maxValue) : Number.NaN
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

function normalizeCollections(collections?: string[] | string): string[] {
  const normalized = Array.isArray(collections)
    ? collections.filter((value): value is string => Boolean(value && value.trim()))
    : typeof collections === 'string' && collections.trim()
      ? collections.split(',').map((value) => value.trim()).filter(Boolean)
      : [...SPHEREX_COLLECTIONS]
  return normalized.length ? normalized : [...SPHEREX_COLLECTIONS]
}

function normalizeMaxRec(value?: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(1000, Number(value))) : 500
}

function observationKey(observation: Observation): string {
  return observation.accessUrl || observation.previewUrl || observation.raw.obs_id || observation.raw.obs_publisher_did || ''
}

function uniqueObservations(observations: Observation[]): Observation[] {
  const seen = new Set<string>()
  return observations.filter((observation, index) => {
    const key = observationKey(observation) || `record-${index}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function searchArchive(url: string, key: string, allowStale: boolean): Promise<SearchResult> {
  let staleCache: { storedAt: number; observations: Observation[] } | null = null
  try {
    const cached = localStorage.getItem(key)
    if (cached) {
      const parsed = JSON.parse(cached) as { storedAt: number; observations: Observation[] }
      if (Number.isFinite(parsed.storedAt) && Array.isArray(parsed.observations)) {
        staleCache = { storedAt: parsed.storedAt, observations: parsed.observations }
        if (Date.now() - parsed.storedAt < CACHE_MS) {
          return { observations: parsed.observations, searchedAt: new Date(parsed.storedAt).toISOString(), cached: true }
        }
      }
    }
  } catch {
    staleCache = null
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(75000) })
    if (!response.ok) {
      let detail = ''
      if (response.headers.get('content-type')?.includes('application/json')) {
        try {
          const body = await response.json() as { detail?: unknown }
          if (typeof body.detail === 'string') detail = body.detail
        } catch {
          // Keep the HTTP status visible when a proxy returns malformed JSON.
        }
      }
      throw new Error(`explorer.errorHttp:${response.status}:${detail}`)
    }
    const observations = uniqueObservations(parseVOTable(await response.text()))
    const storedAt = Date.now()
    try {
      localStorage.setItem(key, JSON.stringify({ storedAt, observations }))
    } catch {
      // Storage is optional; the live archive results remain usable.
    }
    return { observations, searchedAt: new Date(storedAt).toISOString(), cached: false }
  } catch (error) {
    if (staleCache && allowStale) {
      return {
        observations: staleCache.observations,
        searchedAt: new Date(staleCache.storedAt).toISOString(),
        cached: true,
        stale: true,
      }
    }
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error('explorer.errorTimeout')
    }
    if (error instanceof Error && (error.message.startsWith('explorer.') || error.message.startsWith('HTTP '))) throw error
    throw new Error('explorer.errorNetwork')
  }
}

export async function searchSpherex(
  ra: number,
  dec: number,
  radius = 0.1,
  options: { collections?: string[] | string; maxRec?: number; allowStale?: boolean } = {},
): Promise<SearchResult> {
  const normalizedRa = normalizeRa(ra)
  const normalizedDec = normalizeDec(dec)
  if (!Number.isFinite(ra) || ra < 0 || ra > 360 || !Number.isFinite(dec) || dec < -90 || dec > 90) {
    throw new Error('explorer.errorInvalid')
  }
  const collections = normalizeCollections(options.collections)
  const maxRec = normalizeMaxRec(options.maxRec)
  const key = `cosmic-lens-sia:${normalizedRa}:${normalizedDec}:${radius}:${collections.join(',')}:${maxRec}`
  const params = new URLSearchParams({
    ra: String(normalizedRa),
    dec: String(normalizedDec),
    radius: String(radius),
    collections: collections.join(','),
    maxrec: String(maxRec),
  })
  return searchArchive(apiUrl(`/api/irsa/sia?${params.toString()}`), key, Boolean(options.allowStale))
}

export async function searchSpherexById(
  observationId: string,
  options: { collections?: string[] | string; maxRec?: number; allowStale?: boolean } = {},
): Promise<SearchResult> {
  const identifier = observationId.trim()
  if (!identifier) throw new Error('explorer.errorIdRequired')
  const collections = normalizeCollections(options.collections)
  const maxRec = normalizeMaxRec(options.maxRec)
  const params = new URLSearchParams({
    observation_id: identifier,
    collections: collections.join(','),
    maxrec: String(maxRec),
  })
  const cacheKey = `cosmic-lens-sia:id:${identifier.toLowerCase()}:${collections.join(',')}:${maxRec}`
  return searchArchive(apiUrl(`/api/irsa/sia/id?${params.toString()}`), cacheKey, Boolean(options.allowStale))
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
  const query = new URLSearchParams()
  for (const collection of (normalizedCollections.length ? normalizedCollections : ['spherex_dr1'])) {
    query.append('COLLECTION', collection)
  }
  query.set('POS', `CIRCLE ${normalizeRa(ra)} ${normalizeDec(dec)} ${radius}`)
  query.set('MAXREC', '500')
  return `https://irsa.ipac.caltech.edu/SIA?${query.toString()}`
}

export function archiveIdSearchUrl(observationId: string, collections: string[] | string = [...SPHEREX_COLLECTIONS]): string {
  const normalizedCollections = Array.isArray(collections)
    ? collections.filter((value) => value && value.trim())
    : collections.split(',').map((value) => value.trim()).filter(Boolean)
  const query = new URLSearchParams()
  for (const collection of (normalizedCollections.length ? normalizedCollections : [...SPHEREX_COLLECTIONS])) {
    query.append('COLLECTION', collection)
  }
  query.set('ID', observationId.trim())
  query.set('MAXREC', '500')
  return `https://irsa.ipac.caltech.edu/SIA?${query.toString()}`
}

export const IRSA_DOCS = 'https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html'
export const IRSA_EXPLORER = 'https://irsa.ipac.caltech.edu/applications/spherex/'
