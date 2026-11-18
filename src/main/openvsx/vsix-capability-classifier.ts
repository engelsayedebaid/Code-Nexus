import type { OpenVsxUnsupportedCapability } from '../../shared/openvsx/openvsx-types'
import { extractStringList, type VsCodePackageManifest } from './vsix-package-manifest'

export function classifyUnsupportedCapabilities(
  manifest: VsCodePackageManifest,
  description: string
): { hasMainEntrypoint: boolean; unsupportedCapabilities: OpenVsxUnsupportedCapability[] } {
  const unsupported = new Set<OpenVsxUnsupportedCapability>()
  const hasMainEntrypoint =
    (typeof manifest.main === 'string' && manifest.main.trim().length > 0) ||
    (typeof manifest.browser === 'string' && manifest.browser.trim().length > 0)

  if (hasMainEntrypoint) {
    unsupported.add('js-runtime')
  }

  const contributes = manifest.contributes
  if (contributes && typeof contributes === 'object') {
    if (
      (Array.isArray(contributes.debuggers) && contributes.debuggers.length > 0) ||
      (Array.isArray(contributes.breakpoints) && contributes.breakpoints.length > 0)
    ) {
      unsupported.add('debugger')
    }
    if (
      (contributes.views && Object.keys(contributes.views).length > 0) ||
      (contributes.viewsContainers && Object.keys(contributes.viewsContainers).length > 0) ||
      (Array.isArray(contributes.viewsWelcome) && contributes.viewsWelcome.length > 0)
    ) {
      unsupported.add('views')
    }
    if (Array.isArray(contributes.commands) && contributes.commands.length > 0) {
      unsupported.add('commands')
    }
    if (Array.isArray(contributes.keybindings) && contributes.keybindings.length > 0) {
      unsupported.add('keybindings')
    }
    if (
      (contributes.menus && Object.keys(contributes.menus).length > 0) ||
      (contributes.submenus && Object.keys(contributes.submenus).length > 0)
    ) {
      unsupported.add('menus')
    }
    if (
      (Array.isArray(contributes.customEditors) && contributes.customEditors.length > 0) ||
      (Array.isArray(contributes.notebookRenderer) && contributes.notebookRenderer.length > 0)
    ) {
      unsupported.add('webviews')
    }
  }

  if (hasMainEntrypoint) {
    const deps =
      manifest.dependencies && typeof manifest.dependencies === 'object'
        ? Object.keys(manifest.dependencies)
        : []
    const keywords = extractStringList(manifest.keywords).map((k) => k.toLowerCase())
    const categories = extractStringList(manifest.categories).map((c) => c.toLowerCase())
    const combinedText = `${description.toLowerCase()} ${keywords.join(' ')}`
    if (
      deps.includes('vscode-languageclient') ||
      categories.includes('programming languages') ||
      categories.includes('linters') ||
      categories.includes('formatters') ||
      /\b(language server|lsp|intellisense|autocomplete|code completion)\b/.test(combinedText)
    ) {
      unsupported.add('lsp')
    }
  }

  return {
    hasMainEntrypoint,
    unsupportedCapabilities: Array.from(unsupported)
  }
}
