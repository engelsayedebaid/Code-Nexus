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
import { getOpenVsxExtensionDetails, searchOpenVsxExtensions } from './openvsx-registry-client'
import {
  readOpenVsxRegistryFile,
  writeOpenVsxRegistryFile,
  type PersistedOpenVsxEntry
} from './openvsx-registry-store'
import { resolveExtractedExtensionRoot } from './vsix-archive-extractor'
import {
  adaptExtractedVsixExtension,
  type AdaptedOpenVsxExtensionAssets
} from './vsix-declarative-adapter'
import { buildFallbackDetailsFromInstalled, runOpenVsxInstallClosure } from './openvsx-installer'

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
    if (this.entries.size > 0) {
      await writeOpenVsxRegistryFile(this.rootDir, this.manifestPath, this.entries.values()).catch(
        () => undefined
      )
    }
    if (this.activeAssets.size > 0) {
      this.emitChanged()
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
      const outcome = await runOpenVsxInstallClosure({
        options,
        packagesDir: this.packagesDir,
        entries: this.entries,
        activeAssets: this.activeAssets
      })
      await writeOpenVsxRegistryFile(this.rootDir, this.manifestPath, this.entries.values())
      this.emitChanged()
      return outcome
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
