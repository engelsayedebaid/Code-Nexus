import type { OpenVsxExtensionSummary } from '../../shared/openvsx/openvsx-types'

const EXTENSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/

type RawOpenVsxRef = {
  namespace?: unknown
  extension?: unknown
}

export type RawOpenVsxExtension = {
  namespace?: unknown
  name?: unknown
  displayName?: unknown
  description?: unknown
  version?: unknown
  verified?: unknown
  preRelease?: unknown
  downloadCount?: unknown
  averageRating?: unknown
  reviewCount?: unknown
  timestamp?: unknown
  repository?: unknown
  homepage?: unknown
  license?: unknown
  publishedBy?: {
    loginName?: unknown
    fullName?: unknown
  } | null
  files?: Record<string, unknown> | null
  categories?: unknown
  tags?: unknown
  dependencies?: unknown
  bundledExtensions?: unknown
  error?: unknown
}

export type RawOpenVsxSearchResponse = {
  offset?: unknown
  totalSize?: unknown
  extensions?: unknown
  error?: unknown
}

export function splitOpenVsxExtensionId(
  extensionId: string
): { namespace: string; name: string; normalizedId: string } | null {
  const trimmed = extensionId.trim()
  if (!EXTENSION_ID_PATTERN.test(trimmed)) {
    return null
  }
  const dotIndex = trimmed.indexOf('.')
  if (dotIndex <= 0 || dotIndex >= trimmed.length - 1) {
    return null
  }
  const namespace = trimmed.slice(0, dotIndex)
  const name = trimmed.slice(dotIndex + 1)
  return {
    namespace,
    name,
    normalizedId: `${namespace}.${name}`
  }
}

export function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export function asHttpsUrl(value: unknown): string | undefined {
  const str = asTrimmedString(value)
  if (!str) {
    return undefined
  }
  try {
    const parsed = new URL(str)
    return parsed.protocol === 'https:' ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

export function parseOpenVsxExtensionRefs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const refs: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const raw = item as RawOpenVsxRef
    const ns = asTrimmedString(raw.namespace)
    const ext = asTrimmedString(raw.extension)
    if (!ns || !ext) {
      continue
    }
    const id = `${ns}.${ext}`
    const lower = id.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      refs.push(id)
    }
  }
  return refs
}

export function toOpenVsxExtensionSummary(
  raw: RawOpenVsxExtension
): OpenVsxExtensionSummary | null {
  const namespace = asTrimmedString(raw.namespace)
  const name = asTrimmedString(raw.name)
  if (!namespace || !name) {
    return null
  }
  const files = raw.files && typeof raw.files === 'object' ? raw.files : {}
  const publishedBy =
    asTrimmedString(raw.publishedBy?.loginName) ??
    asTrimmedString(raw.publishedBy?.fullName) ??
    namespace
  const dependencies = parseOpenVsxExtensionRefs(raw.dependencies)
  const bundled = parseOpenVsxExtensionRefs(raw.bundledExtensions)

  return {
    id: `${namespace}.${name}`,
    namespace,
    name,
    displayName: asTrimmedString(raw.displayName) ?? name,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    version: asTrimmedString(raw.version) ?? '0.0.0',
    publishedBy,
    verified: raw.verified === true,
    downloadCount: asFiniteNumber(raw.downloadCount) ?? 0,
    averageRating: asFiniteNumber(raw.averageRating),
    reviewCount: asFiniteNumber(raw.reviewCount),
    timestamp: asTrimmedString(raw.timestamp),
    iconUrl: asHttpsUrl(files.icon),
    downloadUrl: asHttpsUrl(files.download),
    readmeUrl: asHttpsUrl(files.readme),
    repositoryUrl: asHttpsUrl(raw.repository),
    homepageUrl: asHttpsUrl(raw.homepage),
    license: asTrimmedString(raw.license),
    categories: asStringArray(raw.categories),
    tags: asStringArray(raw.tags),
    extensionPackCount: bundled.length > 0 ? bundled.length : undefined,
    dependenciesCount: dependencies.length > 0 ? dependencies.length : undefined,
    preRelease: raw.preRelease === true
  }
}
