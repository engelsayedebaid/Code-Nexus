import path from 'node:path'
import type {
  OpenVsxExtensionDetails,
  OpenVsxInstallOptions,
  OpenVsxInstallOutcome,
  OpenVsxInstalledExtension
} from '../../shared/openvsx/openvsx-types'
import {
  downloadOpenVsxVsix,
  getOpenVsxExtensionDetails,
  splitOpenVsxExtensionId
} from './openvsx-registry-client'
import {
  buildInstalledExtensionRecord,
  mergeUniqueExtensionIds,
  toSafeOpenVsxFolderName,
  type PersistedOpenVsxEntry
} from './openvsx-registry-store'
import { extractVsixArchive } from './vsix-archive-extractor'
import {
  adaptExtractedVsixExtension,
  type AdaptedOpenVsxExtensionAssets
} from './vsix-declarative-adapter'

const MAX_INSTALL_CLOSURE = 25

export function buildFallbackDetailsFromInstalled(
  installed: OpenVsxInstalledExtension
): OpenVsxExtensionDetails {
  return {
    id: installed.id,
    namespace: installed.namespace,
    name: installed.name,
    displayName: installed.displayName,
    description: installed.description,
    version: installed.version,
    publishedBy: installed.publisher,
    verified: installed.verified,
    downloadCount: installed.downloadCount ?? 0,
    averageRating: installed.averageRating,
    iconUrl: installed.iconDataUrl,
    repositoryUrl: installed.repositoryUrl,
    homepageUrl: installed.homepageUrl,
    license: installed.license,
    categories: installed.categories,
    tags: [],
    extensionPack: installed.extensionPack,
    dependencies: installed.dependencies,
    readmeMarkdown: installed.readmeMarkdown,
    runtimeSupportHint: installed.runtimeSupport
  }
}

export async function runOpenVsxInstallClosure(params: {
  options: OpenVsxInstallOptions
  packagesDir: string
  entries: Map<string, PersistedOpenVsxEntry>
  activeAssets: Map<string, AdaptedOpenVsxExtensionAssets>
}): Promise<OpenVsxInstallOutcome> {
  const { options, packagesDir, entries, activeAssets } = params
  const parsedPrimary = splitOpenVsxExtensionId(options.extensionId)
  if (!parsedPrimary) {
    throw new Error(`Invalid extension id "${options.extensionId}"`)
  }

  const includePackAndDeps = options.includePackAndDependencies !== false
  const queue: { id: string; version?: string; direct: boolean }[] = [
    { id: parsedPrimary.normalizedId, version: options.version, direct: true }
  ]
  const queuedOrVisited = new Set<string>([parsedPrimary.normalizedId.toLowerCase()])
  const installedList: OpenVsxInstalledExtension[] = []
  const failedList: { id: string; error: string }[] = []
  const skippedList: string[] = []
  let primaryRecord: OpenVsxInstalledExtension | undefined

  const enqueueRefs = (refs: readonly string[]): void => {
    if (!includePackAndDeps) {
      return
    }
    for (const childId of refs) {
      const splitChild = splitOpenVsxExtensionId(childId)
      if (!splitChild) {
        continue
      }
      const childKey = splitChild.normalizedId.toLowerCase()
      if (!queuedOrVisited.has(childKey) && queuedOrVisited.size < MAX_INSTALL_CLOSURE) {
        queuedOrVisited.add(childKey)
        queue.push({ id: splitChild.normalizedId, direct: false })
      }
    }
  }

  while (queue.length > 0 && queuedOrVisited.size <= MAX_INSTALL_CLOSURE) {
    const current = queue.shift()!
    const existing = entries.get(current.id.toLowerCase())

    if (!current.direct && existing) {
      skippedList.push(existing.record.id)
      enqueueRefs(
        mergeUniqueExtensionIds(existing.record.extensionPack, existing.record.dependencies)
      )
      continue
    }

    try {
      const remote = await getOpenVsxExtensionDetails(current.id, current.version, true)
      const downloadUrl =
        remote.downloadUrl ??
        `https://open-vsx.org/api/${encodeURIComponent(remote.namespace)}/${encodeURIComponent(remote.name)}/${encodeURIComponent(remote.version)}/file/${encodeURIComponent(`${remote.namespace}.${remote.name}-${remote.version}.vsix`)}`

      const archiveBytes = await downloadOpenVsxVsix(downloadUrl)
      const folderName = toSafeOpenVsxFolderName(remote.id)
      const { extensionRootDir } = await extractVsixArchive(
        archiveBytes,
        path.join(packagesDir, folderName)
      )
      const adapted = await adaptExtractedVsixExtension(extensionRootDir, remote.id)
      const extensionPack = mergeUniqueExtensionIds(adapted.extensionPack, remote.extensionPack)
      const dependencies = mergeUniqueExtensionIds(adapted.dependencies, remote.dependencies)
      const record = buildInstalledExtensionRecord({
        remote,
        adapted,
        existing,
        direct: current.direct,
        extensionPack,
        dependencies
      })

      const key = remote.id.toLowerCase()
      entries.set(key, { folderName, record })
      if (record.enabled) {
        activeAssets.set(key, adapted)
      } else {
        activeAssets.delete(key)
      }

      installedList.push(record)
      if (current.direct) {
        primaryRecord = record
      }
      enqueueRefs(mergeUniqueExtensionIds(extensionPack, dependencies))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (current.direct && installedList.length === 0) {
        throw error
      }
      failedList.push({ id: current.id, error: message })
    }
  }

  return {
    installed: installedList,
    failed: failedList,
    skipped: skippedList,
    primaryExtension: primaryRecord
  }
}
