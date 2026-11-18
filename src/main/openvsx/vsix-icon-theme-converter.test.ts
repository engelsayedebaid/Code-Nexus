import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { toOpenVsxPluginKey } from '../../shared/openvsx/openvsx-types'
import { normalizePluginThemeSettings } from '../../shared/plugin-theme-settings'
import { extractVsixIconThemes } from './vsix-icon-theme-converter'

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true })
  }
})

describe('extractVsixIconThemes', () => {
  it('maps VS Code languageIds, lowercases names, and prioritizes core icons ahead of 512+ obscure dotfiles', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'orca-vsix-icons-'))
    tempDirs.push(root)
    const iconsDir = path.join(root, 'icons')
    await mkdir(iconsDir, { recursive: true })

    const iconDefinitions: Record<string, { iconPath: string }> = {
      _file: { iconPath: './icons/file.svg' },
      _folder: { iconPath: './icons/folder.svg' },
      html: { iconPath: './icons/html.svg' },
      css: { iconPath: './icons/css.svg' },
      docker: { iconPath: './icons/docker.svg' },
      'folder-src': { iconPath: './icons/folder-src.svg' }
    }

    await writeFile(
      path.join(iconsDir, 'file.svg'),
      '<svg viewBox="0 0 16 16"><path fill="#999" d="M1 1h14v14H1z"/></svg>'
    )
    await writeFile(
      path.join(iconsDir, 'folder.svg'),
      '<svg viewBox="0 0 16 16"><path fill="#888" d="M1 2h14v12H1z"/></svg>'
    )
    await writeFile(
      path.join(iconsDir, 'html.svg'),
      '<svg viewBox="0 0 16 16"><style>.c{fill:#e44d26}</style><path class="c" d="M2 2h12v12H2z"/></svg>'
    )
    await writeFile(
      path.join(iconsDir, 'css.svg'),
      '<svg viewBox="0 0 16 16"><path fill="#1572b6" d="M2 2h12v12H2z"/></svg>'
    )
    await writeFile(
      path.join(iconsDir, 'docker.svg'),
      '<svg viewBox="0 0 16 16"><path fill="#2496ed" d="M2 2h12v12H2z"/></svg>'
    )
    await writeFile(
      path.join(iconsDir, 'folder-src.svg'),
      '<svg viewBox="0 0 16 16"><path fill="#4caf50" d="M2 2h12v12H2z"/></svg>'
    )

    const fileNames: Record<string, string> = {}
    const fileExtensions: Record<string, string> = {}
    for (let i = 0; i < 530; i += 1) {
      const defKey = `obscure_${i}`
      const svgName = `obscure-${i}.svg`
      iconDefinitions[defKey] = { iconPath: `./icons/${svgName}` }
      fileNames[`.obscure-config-${i}`] = defKey
      fileExtensions[`x${i}`] = defKey
      await writeFile(
        path.join(iconsDir, svgName),
        `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="${(i % 6) + 1}" fill="#123456"/></svg>`
      )
    }
    fileNames.Dockerfile = 'docker'

    const themeJson = {
      iconDefinitions,
      file: '_file',
      folder: '_folder',
      languageIds: {
        html: 'html',
        css: 'css'
      },
      fileExtensions,
      fileNames,
      folderNames: {
        Src: 'folder-src'
      }
    }
    await writeFile(path.join(root, 'material-icons.json'), JSON.stringify(themeJson))

    const warnings: string[] = []
    const pluginKey = toOpenVsxPluginKey('PKief.material-icon-theme')
    const extracted = await extractVsixIconThemes(
      root,
      pluginKey,
      '5.0.0',
      [
        {
          id: 'material_icon_theme',
          label: 'Material Icon Theme',
          path: './material-icons.json'
        }
      ],
      null,
      warnings
    )

    expect(extracted).toHaveLength(1)
    expect(extracted[0].metadata.id).toBe(
      'plugin:ovsx-pkief.material-icon-theme/material-icon-theme'
    )
    expect(normalizePluginThemeSettings({ pluginIconTheme: extracted[0].metadata.id })).toEqual({
      pluginIconTheme: 'plugin:ovsx-pkief.material-icon-theme/material-icon-theme'
    })
    const reg = extracted[0].registration

    // `html` and `css` from VS Code `languageIds` must resolve into `fileExtensions` and NOT fall back to `_file`.
    expect(reg.fileExtensions.html).toBeDefined()
    expect(reg.fileExtensions.html).not.toBe(reg.icons.file)
    expect(reg.svgs[reg.fileExtensions.html]).toContain('fill:#e44d26')
    expect(reg.fileExtensions.css).toBeDefined()
    expect(reg.svgs[reg.fileExtensions.css]).toContain('#1572b6')

    // Mixed-case `Dockerfile` and `Src` must be normalized to lowercase and survive 530+ obscure dotfiles.
    expect(reg.fileNames.dockerfile).toBeDefined()
    expect(reg.svgs[reg.fileNames.dockerfile]).toContain('#2496ed')
    expect(reg.folderNames.src).toBeDefined()
    expect(reg.svgs[reg.folderNames.src]).toContain('#4caf50')
  })
})
