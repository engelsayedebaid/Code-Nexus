import {
  formatOpenVsxErrorMessage,
  type OpenVsxExtensionDetails,
  type OpenVsxExtensionSummary,
  type OpenVsxSearchOptions,
  type OpenVsxSearchResult
} from '../../shared/openvsx/openvsx-types'
import {
  asFiniteNumber,
  asHttpsUrl,
  parseOpenVsxExtensionRefs,
  splitOpenVsxExtensionId,
  toOpenVsxExtensionSummary,
  type RawOpenVsxExtension,
  type RawOpenVsxSearchResponse
} from './openvsx-api-mapper'

export { splitOpenVsxExtensionId }

const OPEN_VSX_API_BASE = 'https://open-vsx.org/api'
const API_TIMEOUT_MS = 15_000
const VSIX_DOWNLOAD_TIMEOUT_MS = 60_000
const MAX_VSIX_BYTES = 64 * 1024 * 1024
const MAX_README_BYTES = 512 * 1024
const USER_AGENT = 'Orca-IDE-OpenVSX-Client/1.0'

type FetchTransport = (url: string, init: RequestInit) => Promise<Response>
let primaryFetchTransport: FetchTransport | null = null

export function registerOpenVsxPrimaryFetch(transport: FetchTransport): void {
  primaryFetchTransport = transport
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function openVsxFetch(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<Response> {
  let lastError: unknown
  const transports: FetchTransport[] = primaryFetchTransport
    ? [primaryFetchTransport, (t, init) => fetch(t, init)]
    : [(t, init) => fetch(t, init), (t, init) => fetch(t, init)]

  for (const transport of transports) {
    try {
      return await transport(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(formatOpenVsxErrorMessage(lastError))
}

async function fetchJsonObject(
  url: string,
  timeoutMs = API_TIMEOUT_MS
): Promise<Record<string, unknown>> {
  const response = await openVsxFetch(
    url,
    {
      Accept: 'application/json',
      'User-Agent': USER_AGENT
    },
    timeoutMs
  )
  if (!response.ok) {
    throw new Error(`Open VSX request failed (${response.status} ${response.statusText})`)
  }
  const parsed: unknown = await response.json()
  return isPlainRecord(parsed) ? parsed : {}
}

async function readBoundedBytes(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  rejectOnExceed: boolean
): Promise<Buffer> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (!value) {
      continue
    }
    if (total + value.byteLength > maxBytes) {
      await reader.cancel().catch(() => undefined)
      if (rejectOnExceed) {
        throw new Error(`Response exceeded maximum size of ${maxBytes} bytes`)
      }
      const remaining = maxBytes - total
      if (remaining > 0) {
        chunks.push(value.subarray(0, remaining))
        total += remaining
      }
      break
    }
    chunks.push(value)
    total += value.byteLength
  }

  return Buffer.concat(chunks, total)
}

async function fetchTextBounded(url: string, maxBytes: number): Promise<string | undefined> {
  const safeUrl = asHttpsUrl(url)
  if (!safeUrl) {
    return undefined
  }
  const response = await openVsxFetch(
    safeUrl,
    {
      Accept: 'text/markdown, text/plain, */*',
      'User-Agent': USER_AGENT
    },
    API_TIMEOUT_MS
  )
  if (!response.ok || !response.body) {
    return undefined
  }
  const buffer = await readBoundedBytes(response.body, maxBytes, false)
  return buffer.toString('utf8')
}

export async function searchOpenVsxExtensions(
  options: OpenVsxSearchOptions
): Promise<OpenVsxSearchResult> {
  const params = new URLSearchParams()
  const query = options.query.trim()
  if (query.length > 0) {
    params.set('query', query)
  }
  if (options.category && options.category !== 'All') {
    params.set('category', options.category)
  }
  const sortBy = options.sortBy ?? (query.length > 0 ? 'relevance' : 'downloadCount')
  params.set('sortBy', sortBy)
  params.set('sortOrder', 'desc')
  const size = Math.min(Math.max(Math.trunc(options.size ?? 30), 1), 60)
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0)
  params.set('size', String(size))
  params.set('offset', String(offset))
  params.set('includeAllVersions', 'false')

  const raw: RawOpenVsxSearchResponse = await fetchJsonObject(
    `${OPEN_VSX_API_BASE}/-/search?${params.toString()}`
  )
  if (typeof raw.error === 'string' && raw.error.length > 0) {
    throw new Error(raw.error)
  }

  const rawList = Array.isArray(raw.extensions) ? raw.extensions : []
  const extensions: OpenVsxExtensionSummary[] = []
  for (const item of rawList) {
    if (!isPlainRecord(item)) {
      continue
    }
    const parsed = toOpenVsxExtensionSummary(item)
    if (parsed) {
      extensions.push(parsed)
    }
  }

  return {
    extensions,
    totalSize: asFiniteNumber(raw.totalSize) ?? extensions.length,
    offset: asFiniteNumber(raw.offset) ?? offset
  }
}

export async function getOpenVsxExtensionDetails(
  extensionId: string,
  version?: string,
  includeReadme = true
): Promise<OpenVsxExtensionDetails> {
  const split = splitOpenVsxExtensionId(extensionId)
  if (!split) {
    throw new Error(`Invalid Open VSX extension identifier: "${extensionId}"`)
  }

  const basePath = `${OPEN_VSX_API_BASE}/${encodeURIComponent(split.namespace)}/${encodeURIComponent(split.name)}`
  const url =
    version && version.trim().length > 0
      ? `${basePath}/${encodeURIComponent(version.trim())}`
      : basePath

  const raw: RawOpenVsxExtension = await fetchJsonObject(url)
  if (typeof raw.error === 'string' && raw.error.length > 0) {
    throw new Error(raw.error)
  }

  const summary = toOpenVsxExtensionSummary(raw)
  if (!summary) {
    throw new Error(`Open VSX extension metadata missing for "${extensionId}"`)
  }

  const dependencies = parseOpenVsxExtensionRefs(raw.dependencies)
  const extensionPack = parseOpenVsxExtensionRefs(raw.bundledExtensions)
  const readmeMarkdown =
    includeReadme && summary.readmeUrl
      ? await fetchTextBounded(summary.readmeUrl, MAX_README_BYTES).catch(() => undefined)
      : undefined

  return {
    ...summary,
    extensionPack,
    dependencies,
    readmeMarkdown
  }
}

export async function downloadOpenVsxVsix(downloadUrl: string): Promise<Uint8Array> {
  const safeUrl = asHttpsUrl(downloadUrl)
  if (!safeUrl) {
    throw new Error('Open VSX VSIX download URL must use HTTPS')
  }

  const response = await openVsxFetch(
    safeUrl,
    {
      Accept: 'application/octet-stream, application/zip, */*',
      'User-Agent': USER_AGENT
    },
    VSIX_DOWNLOAD_TIMEOUT_MS
  )
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download VSIX (${response.status} ${response.statusText})`)
  }

  const declaredLengthHeader = response.headers.get('content-length')
  if (declaredLengthHeader) {
    const declaredLength = Number(declaredLengthHeader)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_VSIX_BYTES) {
      throw new Error(`VSIX exceeds maximum supported size (${MAX_VSIX_BYTES} bytes)`)
    }
  }

  const archive = await readBoundedBytes(response.body, MAX_VSIX_BYTES, true)
  if (archive.byteLength < 4 || archive[0] !== 0x50 || archive[1] !== 0x4b) {
    throw new Error('Downloaded file is not a valid VSIX/ZIP archive')
  }

  return archive
}
