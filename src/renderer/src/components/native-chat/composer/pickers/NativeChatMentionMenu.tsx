import { memo, useEffect, useRef } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import { FilenameFirstPath } from '@/components/file-path-cursor-tooltip'
import { FileTypeIcon } from '@/components/FileTypeIcon'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import type { NativeChatMentionFiles } from './use-native-chat-mention-files'
import type { NativeChatMentionParticipant } from '../../group-chat/multi-model-chat-state'
import { MultiModelAvatar } from '../../group-chat/MultiModelAvatar'
import { PickerListbox, PickerOptionButton, PickerStatus } from './NativeChatAutocompleteMenus'

const EMPTY_MENTION_PARTICIPANTS: readonly NativeChatMentionParticipant[] = []

export const NativeChatMentionMenu = memo(function NativeChatMentionMenu({
  mention,
  participants = EMPTY_MENTION_PARTICIPANTS,
  activeIndex,
  listboxId,
  onChoose,
  onChooseParticipant
}: {
  mention: NativeChatMentionFiles
  participants?: readonly NativeChatMentionParticipant[]
  activeIndex: number
  listboxId: string
  onChoose: (path: string) => void
  onChooseParticipant?: (mentionToken: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  useUiLanguageRevision()
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  const totalCount = participants.length + mention.files.length
  const selectedIndex = totalCount > 0 ? Math.min(activeIndex, totalCount - 1) : -1

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, mention.files, participants])

  const statusText =
    totalCount > 0
      ? null
      : mention.loading
        ? t('components.native-chat.composer.loadingFiles', 'Loading files...')
        : mention.failed
          ? t('components.native-chat.composer.filesLoadFailed', "Couldn't load files")
          : t('components.native-chat.composer.noFiles', 'No matching files')

  return (
    <PickerListbox id={listboxId}>
      {participants.map((participant, index) => (
        <PickerOptionButton
          key={`participant:${participant.id}`}
          id={`${listboxId}-option-${index}`}
          selected={index === selectedIndex}
          activeItemRef={activeItemRef}
          onChoose={() => onChooseParticipant?.(participant.mentionToken)}
        >
          <MultiModelAvatar agent={participant.agent} size={18} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-popover-foreground">
            @{participant.label}
          </span>
          <span className="shrink-0 truncate text-2xs text-muted-foreground">
            {participant.modelLabel}
          </span>
        </PickerOptionButton>
      ))}
      {mention.files.map((path, fileIndex) => {
        const index = participants.length + fileIndex
        return (
          <PickerOptionButton
            key={path}
            id={`${listboxId}-option-${index}`}
            selected={index === selectedIndex}
            activeItemRef={activeItemRef}
            onChoose={() => onChoose(path)}
          >
            <FileTypeIcon
              filePath={path}
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            />
            <FilenameFirstPath path={path} />
          </PickerOptionButton>
        )
      })}
      {statusText ? (
        <PickerStatus>
          {mention.loading ? <LoadingSpinner className="size-3.5" /> : null}
          {statusText}
        </PickerStatus>
      ) : null}
      <div aria-live="polite" className="sr-only">
        {statusText ?? ''}
      </div>
    </PickerListbox>
  )
})

