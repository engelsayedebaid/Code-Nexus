import type {
  CouncilMessage,
  CouncilMode,
  CouncilParticipant
} from '../../../../shared/council/council-contract'

const MAX_MESSAGE_CONTEXT = 12_000
const MAX_TRANSCRIPT_CONTEXT = 48_000
const MAX_CONTEXT_NOTE = 16_000

function clip(value: string, limit = MAX_MESSAGE_CONTEXT): string {
  if (value.length <= limit) {
    return value
  }
  return `${value.slice(0, limit)}\n\n[truncated by Carver]`
}

function transcript(
  messages: readonly CouncilMessage[],
  participantId: string,
  mode?: CouncilMode
): string {
  const visible = messages
    .filter(
      (message) =>
        (message.kind === 'response' || message.kind === 'user') &&
        message.status === 'completed' &&
        message.content.trim().length > 0
    )
    .map((message) => {
      if (message.kind === 'user') {
        const replyTag = message.replyToLabel ? ` (replying to ${message.replyToLabel})` : ''
        return `### You${replyTag}\n${clip(message.content)}`
      }
      if (participantId && message.participantId === participantId) {
        return `### ${message.participantLabel} (You earlier · Round ${message.round})\n${clip(message.content)}`
      }
      const roleTag = mode === 'code-review' && message.role ? ` · ${message.role}` : ''
      const modelTag = message.model ? ` (${message.model})` : ''
      const replyTag = message.replyToLabel ? ` · replying to ${message.replyToLabel}` : ''
      return `### ${message.participantLabel}${modelTag}${roleTag} · Round ${message.round}${replyTag}\n${clip(message.content)}`
    })
    .join('\n\n')
  return clip(visible, MAX_TRANSCRIPT_CONTEXT)
}

export function buildCouncilTurnPrompt(input: {
  originalPrompt: string
  mode: CouncilMode
  round: number
  participant: CouncilParticipant
  messages: readonly CouncilMessage[]
  queuedUserMessages: readonly string[]
  /** The first round of a chat exchange opens independently; later turns reply in thread. */
  isOpeningRound?: boolean
  contextNote?: string
  participants?: readonly CouncilParticipant[]
  replyToLabel?: string
}): string {
  const {
    originalPrompt,
    mode,
    round,
    participant,
    messages,
    queuedUserMessages,
    isOpeningRound = round === 1,
    contextNote,
    participants,
    replyToLabel
  } = input
  const intervention = queuedUserMessages.length
    ? `\n\nUser intervention for this turn:\n${queuedUserMessages.map((item) => `- ${clip(item, 4_000)}`).join('\n')}`
    : ''
  const earlierContext = contextNote?.trim()
    ? `\n\nEarlier single-model conversation shared with the group (text only, no tool output or hidden reasoning):\n${clip(contextNote, MAX_CONTEXT_NOTE)}`
    : ''
  const rosterLine =
    participants && participants.length > 1
      ? `\nParticipants in this conversation: ${participants.map((member) => `${member.label} (${member.modelLabel})`).join(', ')}.`
      : ''
  const threadHistory = transcript(messages, participant.id, mode)
  const languageRule =
    "Match the language of the user's latest message (for instance, write natural, fluent Arabic when the user writes in Arabic, keeping code and technical identifiers accurate)."
  const safetyRule =
    'This is a strictly read-only discussion turn: do not edit files, run destructive commands, install dependencies, or reveal hidden chain-of-thought.'
  const codeReviewGuidance =
    mode === 'code-review'
      ? `\nAssigned code review focus (${participant.role}): inspect only permitted read-only workspace files when needed, cite exact workspace file references (path or path:line) for findings, explicitly separate inspected code from uninspected assumptions, and never invent file inspection results or line numbers.${!isOpeningRound || threadHistory ? " Confirm, refine, or challenge fellow reviewers' findings by name instead of repeating the same points." : ''}`
      : ''
  const consensusGuidance =
    mode === 'consensus'
      ? '\nWork constructively toward practical convergence: name clear agreement, clarify genuine trade-offs with decision criteria ("choose A if X, B if Y"), and never fabricate consensus.'
      : ''

  if (isOpeningRound) {
    const styleLine =
      mode === 'parallel'
        ? "Answer the user's request clearly, directly, and concisely from your own perspective without boilerplate."
        : mode === 'code-review'
          ? 'Give a focused, honest review from your lens. Cite only real verified details and skip fluff.'
          : 'Share your opening take directly and naturally like an experienced colleague in a group conversation: give your clearest recommendation, concrete reasoning, and main caveat or trade-off without stiff essay templates.'
    return `You are ${participant.label} (${participant.modelLabel})${mode === 'code-review' ? `, serving as ${participant.role}` : ''} in a Carver multi-model chat.

${styleLine}
${languageRule}
${safetyRule}${rosterLine}${codeReviewGuidance}${consensusGuidance}

Discussion mode: ${mode} · Round ${round}

User request:
${clip(originalPrompt, 32_000)}${earlierContext}${threadHistory ? `\n\nConversation so far:\n${threadHistory}` : ''}${intervention}`
  }

  const replyLead = replyToLabel
    ? `You are responding right after ${replyToLabel}. Engage directly with their message and the thread below`
    : 'Engage directly with the conversation below'
  return `You are ${participant.label} (${participant.modelLabel})${mode === 'code-review' ? `, serving as ${participant.role}` : ''} in round ${round} of a live Carver group discussion.

${replyLead} as a sharp colleague in a real conversation—not a standalone essay:
- Address the user's latest prompt directly while engaging peers by name where helpful: state briefly where you agree and why, push back with specific reasoning or edge cases where you disagree, and update or concede your earlier point if someone raised a better one.
- Skip repeating agreed basics or restating your full previous message; focus on new nuance, corrections, or decisive trade-offs.
- Distinguish verified facts from hypotheses.
${languageRule}
${safetyRule}${rosterLine}${codeReviewGuidance}${consensusGuidance}

Discussion mode: ${mode}

Latest user request:
${clip(originalPrompt, 24_000)}${earlierContext}

Thread so far:
${threadHistory || '[No completed peer output was available.]'}${intervention}`
}

export function buildCouncilDecisionPrompt(input: {
  originalPrompt: string
  mode: CouncilMode
  messages: readonly CouncilMessage[]
  contextNote?: string
}): string {
  return `You are the moderator producing the final Carver group synthesis. Summarize the public transcript truthfully: never fabricate agreement where participants disagreed, and never claim that consensus guarantees correctness. Do not reveal hidden chain-of-thought. Keep verified evidence separate from inference. Write the explanations in the same language as the original request while keeping the exact section headings below.

Original request:
${clip(input.originalPrompt, 24_000)}
${input.contextNote?.trim() ? `\nEarlier single-model conversation (text only):\n${clip(input.contextNote, MAX_CONTEXT_NOTE)}\n` : ''}
Transcript:
${transcript(input.messages, '', input.mode)}

Return these exact sections:
## Recommended solution
## Agreement points
## Remaining disagreements
## Technical trade-offs
## Risks
## Evidence
## Next steps

Discussion mode: ${input.mode}`
}

function extractParticipantMentions(message: string): string[] {
  const results: string[] = []
  // Consume slashes inside unquoted tokens so @my-dir/codex.ts never backtracks into @my.
  const pattern = /@"([^"]+)"|@([\w\u0600-\u06FF/·.-]+)/gu
  for (const match of message.matchAll(pattern)) {
    const raw = (match[1] ?? match[2] ?? '').trim()
    if (!raw) {
      continue
    }
    const token = match[1] ? raw : raw.replace(/[.,!?;:)]+$/, '')
    if (!token) {
      continue
    }
    if (!match[1] && (token.includes('/') || /\.[a-z0-9]{1,6}$/i.test(token))) {
      continue
    }
    results.push(token.toLowerCase())
  }
  return results
}

export function messageTargetsParticipant(
  message: string,
  participant: CouncilParticipant
): boolean {
  const mentions = extractParticipantMentions(message)
  if (mentions.length === 0) {
    return true
  }
  const normalizedValues = [
    participant.label,
    participant.agent,
    participant.role,
    participant.modelLabel,
    `${participant.label} · ${participant.modelLabel}`
  ].flatMap((value) => {
    const lowered = value.trim().toLowerCase()
    if (!lowered) {
      return []
    }
    return [
      lowered,
      lowered.replace(/\s+/g, '-'),
      lowered.replace(/\s+/g, ''),
      ...lowered.split(/\s+/).filter((token) => token.length > 1)
    ]
  })
  const aliases = new Set(normalizedValues)
  return mentions.some((mention) => aliases.has(mention))
}
