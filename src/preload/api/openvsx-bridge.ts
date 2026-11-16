import { ipcRenderer } from 'electron'
import type { OpenVsxApi } from './openvsx-api'

export const openVsxApi: OpenVsxApi = {
  search: (options) => ipcRenderer.invoke('openvsx:search', options),
  getDetails: (extensionId, version) =>
    ipcRenderer.invoke('openvsx:getDetails', { extensionId, version }),
  listInstalled: () => ipcRenderer.invoke('openvsx:listInstalled'),
  install: (options) => ipcRenderer.invoke('openvsx:install', options),
  uninstall: (extensionId) => ipcRenderer.invoke('openvsx:uninstall', extensionId),
  setEnabled: (extensionId, enabled) =>
    ipcRenderer.invoke('openvsx:setEnabled', { extensionId, enabled }),
  listSnippets: () => ipcRenderer.invoke('openvsx:listSnippets'),
  onChanged: (callback) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on('openvsx:changed', listener)
    return () => {
      ipcRenderer.removeListener('openvsx:changed', listener)
    }
  }
}
