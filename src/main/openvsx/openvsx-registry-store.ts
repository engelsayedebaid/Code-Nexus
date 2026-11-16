import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  OpenVsxExtensionDetails,
  OpenVsxInstalledExtension
} from '../../shared/openvsx/openvsx-types'
import type { AdaptedOpenVsxExtensionAssets } from './vsix-declarative-adapter'

export type PersistedOpenVsxEntry = {
  folderName: string
  record: OpenVsxInstalledExtension
}

type PersistedRegistryFile = {
  schemaVersion: 1
  extensions: PersistedOpenVsxEntry[]
}

export function toSafeOpenVsxFolderName(extensionId: string): string {
  return extensionId.toLowerCase().replace(/[^a-z0-9._-]+/g, '_')
}

export function mergeUniqueExtensionIds(
  first: readonly string[],
  second: readonly string[]
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of [...first, ...second]) {
    const cleaned = raw.trim()
    const key = cleaned.toLowerCase()
    if (cleaned && !seen.has(key)) {
      seen.add(key)
      result.push(cleaned)
    }
  }
  return result
}

export async function readOpenVsxRegistryFile(
  manifestPath: string
): Promise<PersistedOpenVsxEntry[]> {
  try {
    const raw = await readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedRegistryFile>
    if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.extensions)) {
      return parsed.extensions
    }
  } catch {
    // Missing or invalid manifest starts empty
  }
  return []
}

export async function writeOpenVsxRegistryFile(
  rootDir: string,
  manifestPath: string,
  entries: Iterable<PersistedOpenVsxEntry>
): Promise<void> {
  await mkdir(rootDir, { recursive: true })
  const payload: PersistedRegistryFile = {
    schemaVersion: 1,
    extensions: Array.from(entries)
  }
  await writeFile(manifestPath, JSON.stringify(payload, null, 2), 'utf8')
}

export function buildInstalledExtensionRecord(params: {
  remote: OpenVsxExtensionDetails
  adapted: AdaptedOpenVsxExtensionAssets
  existing?: PersistedOpenVsxEntry
  direct: boolean
  extensionPack: string[]
  dependencies: string[]
}): OpenVsxInstalledExtension {
  const { remote, adapted, existing, direct, extensionPack, dependencies } = params
  return {
    id: remote.id,
    namespace: remote.namespace,
    name: remote.name,
    displayName: adapted.displayName || remote.displayName,
    description: adapted.description || remote.description,
    version: remote.version || adapted.version,
    publisher: remote.publishedBy || adapted.publisher,
    verified: remote.verified,
    enabled: existing ? existing.record.enabled : true,
    installedAt: new Date().toISOString(),
    downloadCount: remote.downloadCount,
    averageRating: remote.averageRating,
    iconDataUrl: adapted.iconDataUrl ?? existing?.record.iconDataUrl,
    repositoryUrl: adapted.repositoryUrl ?? remote.repositoryUrl,
    homepageUrl: adapted.homepageUrl ?? remote.homepageUrl,
    license: adapted.license ?? remote.license,
    categories: adapted.categories.length > 0 ? adapted.categories : remote.categories,
    extensionPack,
    dependencies,
    installedDirectly: Boolean(direct || existing?.record.installedDirectly),
    runtimeSupport: {
      ...adapted.runtimeSupport,
      extensionPackCount: extensionPack.length
    },
    contributions: adapted.contributions,
    readmeMarkdown: adapted.readmeMarkdown ?? remote.readmeMarkdown,
    warnings: adapted.warnings
  }
}
