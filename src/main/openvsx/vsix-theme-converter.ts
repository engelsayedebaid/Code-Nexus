import path from 'node:path'
import {
  completePluginAppThemeTokens,
  isPluginThemeRegistration,
  type PluginThemeRegistration,
  type PluginThemeTokenColorRule
} from '../../shared/plugins/artifacts/plugin-theme-artifact'
import {
  computeRevisionHash,
  parseJsoncObject,
  readBoundedText,
  resolveContainedExtensionPath,
  resolveNlsString,
  slugifyContribId
} from './vsix-package-manifest'

const MAX_TOKEN_COLORS = 512

type VsCodeThemeContribution = {
  id?: unknown
  label?: unknown
  uiTheme?: unknown
  path?: unknown
}

function normalizeColorHex(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }
  const trimmed = raw.trim()
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return trimmed
  }
  return undefined
}

async function loadThemeDocumentRecursive(
  extensionRootDir: string,
  filePath: string,
  depth = 0,
  visited = new Set<string>()
): Promise<{
  type?: string
  colors: Record<string, string>
  tokenColors: PluginThemeTokenColorRule[]
} | null> {
  if (depth > 4 || visited.has(filePath)) {
    return null
  }
  visited.add(filePath)
  const raw = await readBoundedText(filePath, 4 * 1024 * 1024)
  if (!raw) {
    return null
  }
  const parsed = parseJsoncObject(raw)
  if (!parsed) {
    return null
  }

  let mergedColors: Record<string, string> = {}
  let mergedTokenColors: PluginThemeTokenColorRule[] = []
  let inferredType = typeof parsed.type === 'string' ? parsed.type : undefined

  if (typeof parsed.include === 'string' && parsed.include.trim()) {
    const includeRel = path.relative(
      extensionRootDir,
      path.resolve(path.dirname(filePath), parsed.include.trim())
    )
    const containedInclude = resolveContainedExtensionPath(extensionRootDir, includeRel)
    if (containedInclude) {
      const parentTheme = await loadThemeDocumentRecursive(
        extensionRootDir,
        containedInclude,
        depth + 1,
        visited
      )
      if (parentTheme) {
        mergedColors = { ...parentTheme.colors }
        mergedTokenColors = [...parentTheme.tokenColors]
        inferredType = inferredType ?? parentTheme.type
      }
    }
  }

  if (parsed.colors && typeof parsed.colors === 'object' && !Array.isArray(parsed.colors)) {
    for (const [key, value] of Object.entries(parsed.colors as Record<string, unknown>)) {
      const color = normalizeColorHex(value)
      if (color) {
        mergedColors[key] = color
      }
    }
  }

  if (Array.isArray(parsed.tokenColors)) {
    for (const rawRule of parsed.tokenColors) {
      if (!rawRule || typeof rawRule !== 'object') {
        continue
      }
      const rule = rawRule as { scope?: unknown; settings?: unknown }
      if (!rule.settings || typeof rule.settings !== 'object' || Array.isArray(rule.settings)) {
        continue
      }
      const settingsObj = rule.settings as { foreground?: unknown; fontStyle?: unknown }
      const foreground = normalizeColorHex(settingsObj.foreground)
      const fontStyle =
        typeof settingsObj.fontStyle === 'string' && settingsObj.fontStyle.trim().length > 0
          ? settingsObj.fontStyle.trim()
          : undefined
      if (!foreground && !fontStyle) {
        continue
      }
      const rawScope =
        typeof rule.scope === 'string'
          ? rule.scope.trim()
          : Array.isArray(rule.scope)
            ? rule.scope.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : undefined
      if (!rawScope || (Array.isArray(rawScope) && rawScope.length === 0)) {
        continue
      }
      mergedTokenColors.push({
        scope: rawScope,
        settings: {
          ...(foreground ? { foreground } : {}),
          ...(fontStyle ? { fontStyle } : {})
        }
      })
    }
  }

  return {
    type: inferredType,
    colors: mergedColors,
    tokenColors: mergedTokenColors
  }
}

export async function extractVsixThemes(
  extensionRootDir: string,
  pluginKey: string,
  pluginName: string,
  version: string,
  rawThemes: unknown,
  nls: Record<string, string> | null,
  warnings: string[]
): Promise<PluginThemeRegistration[]> {
  if (!Array.isArray(rawThemes)) {
    return []
  }

  const registrations: PluginThemeRegistration[] = []
  for (let index = 0; index < rawThemes.length; index += 1) {
    const entry = rawThemes[index] as VsCodeThemeContribution
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string') {
      continue
    }
    const fullPath = resolveContainedExtensionPath(extensionRootDir, entry.path)
    if (!fullPath) {
      continue
    }
    const loaded = await loadThemeDocumentRecursive(extensionRootDir, fullPath)
    if (!loaded) {
      warnings.push(`Could not load color theme "${entry.path}"`)
      continue
    }

    const base: 'light' | 'dark' =
      loaded.type === 'light' || entry.uiTheme === 'vs' || entry.uiTheme === 'hc-light'
        ? 'light'
        : 'dark'
    const colors = loaded.colors
    const bg = colors['editor.background'] ?? (base === 'light' ? '#ffffff' : '#18181b')
    const fg = colors['editor.foreground'] ?? (base === 'light' ? '#18181b' : '#f4f4f5')
    const partialTokens: Record<string, string> = {
      '--background': bg,
      '--foreground': fg,
      '--sidebar': colors['sideBar.background'] ?? colors['activityBar.background'] ?? bg,
      '--popover': colors['editorWidget.background'] ?? colors['menu.background'] ?? bg,
      '--muted': colors['tab.inactiveBackground'] ?? colors['sideBar.background'] ?? bg,
      '--secondary':
        colors['button.secondaryBackground'] ?? colors['list.inactiveSelectionBackground'] ?? bg,
      '--accent': colors['list.hoverBackground'] ?? colors['editor.selectionBackground'] ?? bg,
      '--muted-foreground':
        colors['descriptionForeground'] ?? colors['editorLineNumber.foreground'] ?? fg,
      '--border':
        colors['panel.border'] ?? colors['sideBar.border'] ?? colors['editorGroup.border'] ?? bg
    }
    if (colors['focusBorder']) {
      partialTokens['--ring'] = colors['focusBorder']
    }
    if (colors['button.background']) {
      partialTokens['--primary'] = colors['button.background']
    }
    if (colors['button.foreground']) {
      partialTokens['--primary-foreground'] = colors['button.foreground']
    }

    const label = resolveNlsString(entry.label, nls) || `Theme ${index + 1}`
    const slug = slugifyContribId(
      typeof entry.id === 'string' && entry.id.trim() ? entry.id : label,
      `theme-${index}`
    )
    const id: `plugin:${string}` = `plugin:${pluginKey}/${slug}`
    const tokenColors = loaded.tokenColors.slice(0, MAX_TOKEN_COLORS)
    const candidate: PluginThemeRegistration = {
      id,
      pluginKey,
      pluginName,
      label,
      revision: computeRevisionHash(`${version}:${id}:${bg}:${fg}:${tokenColors.length}`),
      base,
      tokens: completePluginAppThemeTokens(partialTokens),
      ...(tokenColors.length > 0 ? { tokenColors } : {})
    }
    if (isPluginThemeRegistration(candidate)) {
      registrations.push(candidate)
    } else {
      warnings.push(`Theme "${label}" did not satisfy Orca theme validation`)
    }
  }

  return registrations
}
