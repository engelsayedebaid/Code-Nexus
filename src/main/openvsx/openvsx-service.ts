import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type {
  PluginIconThemeMetadata,
  PluginIconThemeRegistration
} from '../../shared/plugins/artifacts/plugin-icon-theme-artifact'
import type {
  PluginSyntaxMetadata,
  PluginSyntaxPayload
} from '../../shared/plugins/artifacts/plugin-syntax-artifact'
import type { PluginThemeRegistration } from '../../shared/plugins/artifacts/plugin-theme-artifact'
import type {
  OpenVsxExtensionDetails,
  OpenVsxInstallOptions,
  OpenVsxInstallOutcome,
  OpenVsxInstalledExtension,
  OpenVsxSearchOptions,
  OpenVsxSearchResult,
  OpenVsxSnippetItem
} from '../../shared/openvsx/openvsx-types'
import {
  downloadOpenVsxVsix,
  getOpenVsxExtensionDetails,
  searchOpenVsxExtensions,
  splitOpenVsxExtensionId
} from './openvsx-registry-client'
import {
  buildInstalledExtensionRecord,
  mergeUniqueExtensionIds,
  readOpenVsxRegistryFile,
  toSafeOpenVsxFolderName,
  writeOpenVsxRegistryFile,
  type PersistedOpenVsxEntry
} from './openvsx-registry-store'
import { extractVsixArchive, resolveExtractedExtensionRoot } from './vsix-archive-extractor'
import {
  adaptExtractedVsixExtension,
  type AdaptedOpenVsxExtensionAssets
} from './vsix-declarative-adapter'

const MAX_INSTALL_CLOSURE = 25

function buildFallbackDetailsFromInstalled(
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

export class OpenVsxService {
  private readonly rootDir: string
  private readonly packagesDir: string
  private readonly manifestPath: string

  private readonly entries = new Map<string, PersistedOpenVsxEntry>()
  private readonly activeAssets = new Map<string, AdaptedOpenVsxExtensionAssets>()
  private readonly listeners = new Set<() => void>()
  private mutationQueue: Promise<unknown> = Promise.resolve()

  constructor(userDataDir: string) {
    this.rootDir = path.join(userDataDir, 'openvsx-extensions')
    this.packagesDir = path.join(this.rootDir, 'packages')
    this.manifestPath = path.join(this.rootDir, 'installed.json')
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emitChanged(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // Ignore individual listener errors
      }
    }
  }

  private runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(task, task)
    this.mutationQueue = next.catch(() => undefined)
    return next
  }

  async initialize(): Promise<void> {
    await mkdir(this.packagesDir, { recursive: true })
    const persisted = await readOpenVsxRegistryFile(this.manifestPath)
    this.entries.clear()
    this.activeAssets.clear()

    for (const entry of persisted) {
      if (!entry || typeof entry !== 'object' || !entry.record?.id || !entry.folderName) {
        continue
      }
      const key = entry.record.id.toLowerCase()
      this.entries.set(key, entry)
      if (entry.record.enabled) {
        await this.hydrateExtensionAssets(key, entry).catch(() => undefined)
      }
    }
  }

  private async hydrateExtensionAssets(
    key: string,
    entry: PersistedOpenVsxEntry
  ): Promise<AdaptedOpenVsxExtensionAssets> {
    const extDir = path.join(this.packagesDir, path.basename(entry.folderName))
    const rootDir = await resolveExtractedExtensionRoot(extDir)
    const assets = await adaptExtractedVsixExtension(rootDir, entry.record.id)
    entry.record = {
      ...entry.record,
      runtimeSupport: assets.runtimeSupport,
      contributions: assets.contributions,
      warnings: assets.warnings,
      iconDataUrl: entry.record.iconDataUrl ?? assets.iconDataUrl,
      readmeMarkdown: entry.record.readmeMarkdown ?? assets.readmeMarkdown
    }
    this.activeAssets.set(key, assets)
    return assets
  }

  async search(options: OpenVsxSearchOptions): Promise<OpenVsxSearchResult> {
    return searchOpenVsxExtensions(options)
  }

  async getDetails(extensionId: string, version?: string): Promise<OpenVsxExtensionDetails> {
    const installed = this.entries.get(extensionId.trim().toLowerCase())?.record
    try {
      const remote = await getOpenVsxExtensionDetails(extensionId, version, true)
      return {
        ...remote,
        readmeMarkdown: remote.readmeMarkdown ?? installed?.readmeMarkdown,
        runtimeSupportHint: installed?.runtimeSupport
      }
    } catch (error) {
      if (installed) {
        return buildFallbackDetailsFromInstalled(installed)
      }
      throw error
    }
  }

  listInstalled(): OpenVsxInstalledExtension[] {
    return Array.from(this.entries.values())
      .map((entry) => entry.record)
      .sort((a, b) => {
        if (a.installedDirectly !== b.installedDirectly) {
          return a.installedDirectly ? -1 : 1
        }
        return a.displayName.localeCompare(b.displayName)
      })
  }

  async install(options: OpenVsxInstallOptions): Promise<OpenVsxInstallOutcome> {
    return this.runSerialized(async () => {
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
        const existing = this.entries.get(current.id.toLowerCase())

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
            path.join(this.packagesDir, folderName)
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
          this.entries.set(key, { folderName, record })
          if (record.enabled) {
            this.activeAssets.set(key, adapted)
          } else {
            this.activeAssets.delete(key)
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

      await writeOpenVsxRegistryFile(this.rootDir, this.manifestPath, this.entries.values())
      this.emitChanged()
      return {
        installed: installedList,
        failed: failedList,
        skipped: skippedList,
        primaryExtension: primaryRecord
      }
    })
  }

  async uninstall(extensionId: string): Promise<boolean> {
    return this.runSerialized(async () => {
      const key = extensionId.trim().toLowerCase()
      const existing = this.entries.get(key)
      if (!existing) {
        return false
      }
      this.entries.delete(key)
      this.activeAssets.delete(key)
      const extDir = path.join(this.packagesDir, path.basename(existing.folderName))
      await rm(extDir, { recursive: true, force: true }).catch(() => undefined)
      await writeOpenVsxRegistryFile(this.rootDir, this.manifestPath, this.entries.values())
      this.emitChanged()
      return true
    })
  }

  async setEnabled(
    extensionId: string,
    enabled: boolean
  ): Promise<OpenVsxInstalledExtension | null> {
    return this.runSerialized(async () => {
      const key = extensionId.trim().toLowerCase()
      const existing = this.entries.get(key)
      if (!existing) {
        return null
      }
      if (existing.record.enabled === enabled) {
        return existing.record
      }
      existing.record = { ...existing.record, enabled }
      if (enabled) {
        await this.hydrateExtensionAssets(key, existing).catch(() => undefined)
      } else {
        this.activeAssets.delete(key)
      }
      await writeOpenVsxRegistryFile(this.rootDir, this.manifestPath, this.entries.values())
      this.emitChanged()
      return existing.record
    })
  }

  listSyntaxes(): PluginSyntaxMetadata[] {
    return Array.from(this.activeAssets.values()).flatMap((assets) =>
      assets.syntaxes.map((syntax) => syntax.metadata)
    )
  }

  loadSyntax(id: string): PluginSyntaxPayload | null {
    for (const assets of this.activeAssets.values()) {
      const found = assets.syntaxes.find((syntax) => syntax.metadata.id === id)
      if (found) {
        return found.payload
      }
    }
    return null
  }

  listThemes(): PluginThemeRegistration[] {
    return Array.from(this.activeAssets.values()).flatMap((assets) => assets.themes)
  }

  listIconThemes(): PluginIconThemeMetadata[] {
    return Array.from(this.activeAssets.values()).flatMap((assets) =>
      assets.iconThemes.map((iconTheme) => iconTheme.metadata)
    )
  }

  loadIconTheme(id: string): PluginIconThemeRegistration | null {
    for (const assets of this.activeAssets.values()) {
      const found = assets.iconThemes.find((iconTheme) => iconTheme.metadata.id === id)
      if (found) {
        return found.registration
      }
    }
    return null
  }

  listSnippets(): OpenVsxSnippetItem[] {
    return Array.from(this.activeAssets.values()).flatMap((assets) => assets.snippets)
  }
}
