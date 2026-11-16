import { ipcMain } from 'electron'
import { z } from 'zod'
import { ensureOpenVsxService, getOpenVsxService } from '../openvsx/open-vsx-runtime'

const searchOptionsSchema = z.object({
  query: z.string().max(200),
  category: z.string().max(80).optional(),
  sortBy: z.enum(['relevance', 'downloadCount', 'rating', 'timestamp']).optional(),
  size: z.number().int().min(1).max(60).optional(),
  offset: z.number().int().min(0).optional()
})

const detailsRequestSchema = z.object({
  extensionId: z.string().min(3).max(200),
  version: z.string().max(64).optional()
})

const installRequestSchema = z.object({
  extensionId: z.string().min(3).max(200),
  version: z.string().max(64).optional(),
  includePackAndDependencies: z.boolean().optional()
})

const setEnabledSchema = z.object({
  extensionId: z.string().min(3).max(200),
  enabled: z.boolean()
})

export function registerOpenVsxHandlers(): void {
  ipcMain.handle('openvsx:search', async (_event, rawOptions: unknown) => {
    const options = searchOptionsSchema.parse(rawOptions)
    const service = await ensureOpenVsxService()
    return service.search(options)
  })

  ipcMain.handle('openvsx:getDetails', async (_event, rawRequest: unknown) => {
    const request = detailsRequestSchema.parse(rawRequest)
    const service = await ensureOpenVsxService()
    return service.getDetails(request.extensionId, request.version)
  })

  ipcMain.handle('openvsx:listInstalled', async () => {
    const service = getOpenVsxService() ?? (await ensureOpenVsxService())
    return service.listInstalled()
  })

  ipcMain.handle('openvsx:install', async (_event, rawRequest: unknown) => {
    const request = installRequestSchema.parse(rawRequest)
    const service = await ensureOpenVsxService()
    return service.install(request)
  })

  ipcMain.handle('openvsx:uninstall', async (_event, rawExtensionId: unknown) => {
    const extensionId = z.string().min(3).max(200).parse(rawExtensionId)
    const service = await ensureOpenVsxService()
    return service.uninstall(extensionId)
  })

  ipcMain.handle('openvsx:setEnabled', async (_event, rawRequest: unknown) => {
    const request = setEnabledSchema.parse(rawRequest)
    const service = await ensureOpenVsxService()
    return service.setEnabled(request.extensionId, request.enabled)
  })

  ipcMain.handle('openvsx:listSnippets', async () => {
    const service = getOpenVsxService() ?? (await ensureOpenVsxService())
    return service.listSnippets()
  })
}
