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
const MAX_SCOPE_ITEMS = 64
const VALID_FONT_STYLE_WORDS = new Set(['italic', 'bold', 'underline', 'strikethrough'])

function normalizeTokenFontStyle(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }
  const tokens = raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => VALID_FONT_STYLE_WORDS.has(token))
  return tokens.length > 0 ? Array.from(new Set(tokens)).join(' ') : undefined
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

  if (isPlainRecord(parsed.colors)) {
    for (const [key, value] of Object.entries(parsed.colors)) {
      const color = normalizeColorHex(value)
      if (color) {
        mergedColors[key] = color
      }
    }
  }

  if (Array.isArray(parsed.tokenColors)) {
    for (const rawRule of parsed.tokenColors) {
      if (!isPlainRecord(rawRule)) {
        continue
      }
      if (!isPlainRecord(rawRule.settings)) {
        continue
      }
      const foreground = normalizeColorHex(rawRule.settings.foreground)
      const fontStyle = normalizeTokenFontStyle(rawRule.settings.fontStyle)
      if (!foreground && !fontStyle) {
        continue
      }
      const settings = {
        ...(foreground ? { foreground } : {}),
        ...(fontStyle ? { fontStyle } : {})
      }
      if (typeof rawRule.scope === 'string') {
        const trimmedScope = rawRule.scope.trim().slice(0, 512)
        if (trimmedScope) {
          mergedTokenColors.push({ scope: trimmedScope, settings })
        }
      } else if (Array.isArray(rawRule.scope)) {
        const scopes = rawRule.scope
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim().slice(0, 512))
        for (let offset = 0; offset < scopes.length; offset += MAX_SCOPE_ITEMS) {
          const chunk = scopes.slice(offset, offset + MAX_SCOPE_ITEMS)
          if (chunk.length > 0) {
            mergedTokenColors.push({ scope: chunk, settings })
          }
        }
      }
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
  const usedSlugs = new Set<string>()
  for (let index = 0; index < rawThemes.length; index += 1) {
    const entry: unknown = rawThemes[index]
    if (!isPlainRecord(entry) || typeof entry.path !== 'string') {
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
    const sidebarBg = colors['sideBar.background'] ?? colors['activityBar.background'] ?? bg
    const sidebarFg = colors['sideBar.foreground'] ?? fg
    const widgetBg = colors['editorWidget.background'] ?? colors['dropdown.background'] ?? sidebarBg
    const borderCol =
      colors['panel.border'] ??
      colors['sideBar.border'] ??
      colors['editorGroup.border'] ??
      colors['editorWidget.border'] ??
      sidebarBg
    const partialTokens: Record<string, string> = {
      '--background': bg,
      '--editor-surface': bg,
      '--foreground': fg,
      '--card': widgetBg,
      '--card-foreground': fg,
      '--popover': colors['menu.background'] ?? widgetBg,
      '--popover-foreground': colors['menu.foreground'] ?? fg,
      '--sidebar': sidebarBg,
      '--sidebar-foreground': sidebarFg,
      '--sidebar-border': colors['sideBar.border'] ?? borderCol,
      '--worktree-sidebar': sidebarBg,
      '--worktree-sidebar-foreground': sidebarFg,
      '--muted': colors['tab.inactiveBackground'] ?? sidebarBg,
      '--secondary':
        colors['button.secondaryBackground'] ??
        colors['list.inactiveSelectionBackground'] ??
        widgetBg,
      '--accent':
        colors['list.hoverBackground'] ?? colors['list.activeSelectionBackground'] ?? widgetBg,
      '--muted-foreground':
        colors['descriptionForeground'] ?? colors['editorLineNumber.foreground'] ?? fg,
      '--border': borderCol,
      '--input': colors['input.background'] ?? borderCol,
      '--tab-bar': colors['editorGroupHeader.tabsBackground'] ?? sidebarBg,
      '--tab-active': colors['tab.activeBackground'] ?? bg,
      '--tab-active-foreground': colors['tab.activeForeground'] ?? fg,
      '--tab-inactive': colors['tab.inactiveBackground'] ?? sidebarBg,
      '--tab-inactive-foreground': colors['tab.inactiveForeground'] ?? sidebarFg
    }
    const activeTabIndicator = colors['tab.activeBorderTop'] ?? colors['tab.activeBorder']
    if (activeTabIndicator) {
      partialTokens['--tab-active-indicator'] = activeTabIndicator
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
      `theme-${index}`,
      usedSlugs
    )
    const id: `plugin:${string}` = `plugin:${pluginKey}/${slug}`
    const tokenColors = loaded.tokenColors.slice(0, MAX_TOKEN_COLORS)
    const candidate: PluginThemeRegistration = {
      id,
      pluginKey,
      pluginName,
      label,
      revision: computeRevisionHash(`v3:${version}:${id}:${bg}:${fg}:${tokenColors.length}`),
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
