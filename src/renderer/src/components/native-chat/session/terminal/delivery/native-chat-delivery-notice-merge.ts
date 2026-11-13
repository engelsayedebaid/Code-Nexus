import type { NativeChatDeliveryNotice } from '../../../messages/rows/NativeChatMessageRow'

/** The launch notices win over cached delivery notices for the same message id. */
export function mergeNativeChatDeliveryNotices(
  launchNotices: ReadonlyMap<string, NativeChatDeliveryNotice> | null | undefined,
  deliveryNotices: ReadonlyMap<string, NativeChatDeliveryNotice>
): ReadonlyMap<string, NativeChatDeliveryNotice> | undefined {
  if (deliveryNotices.size === 0) {
    return launchNotices ?? undefined
  }
  return new Map([...(launchNotices ?? []), ...deliveryNotices])
}
