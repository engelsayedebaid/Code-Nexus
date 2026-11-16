import { classifySmartPaste, SMART_PASTE_CONFIG } from '../../smart-paste/smart-paste-config'

export const NATIVE_CHAT_PASTED_TEXT_FILE_THRESHOLD = SMART_PASTE_CONFIG.charThreshold

/** A paste this long or multiline becomes a "Pasted text" file attachment instead of prompt text. */
export function isNativeChatLongPaste(text: string): boolean {
  return classifySmartPaste(text).kind !== 'short'
}
