import { formatArabicCount, hasArabicText } from '../../shared/ide-agent/ide-language'
import type { IdeTaskPlan } from '../../shared/ide-agent/ide-agent-types'

const EDIT_COMMAND_VERB_PATTERN =
  /\b(?:build|bulid|create|implement|refactor|delete|remove|add|update|fix|change|modify|generate|write|rename|install|setup|scaffold|make|convert|apply|execute|run)\b|(?:ابني|ابنِ|اعمل|انشئ|أنشئ|عدل|عدّل|صلح|صلّح|غير|غيّر|امسح|احذف|اكتب|ضيف|أضف|نفذ|نفّذ|ابدأ|طبق|طبّق|ثبّت|شغّل)/i

const CLARIFICATION_PHRASE_PATTERN =
  /(?:مش\s*فاهم|ما\s*فهمت|لم\s*أفهم|غير\s*واضح|مش\s*واضح|وضح(?:\s*لي)?|وضّح(?:\s*لي)?|اشرح(?:\s*لي)?|اشرحلي|يعني\s*[اإ]يه|ايش\s*(?:هذا|ده|المقصود)|[اإ]يه\s*ده|ما\s*معنى|ممكن\s*توضح|ممكن\s*تشرح|i\s+don'?t\s+understand|don'?t\s+understand|not\s+clear|unclear|clarify|explain(?:\s+(?:this|that|more|please|the\s+plan))?|what\s+does\s+(?:this|that)\s+mean|tell\s+me\s+more)/i

const QUESTION_STARTER_PATTERN =
  /^(?:ايه|إيه|ليه|لماذا|ما\s+هو|ما\s+هي|ماذا|هل|فين|أين|كيف|إزاي|ازاي|what|why|where|which|who|when|how)\b/i

/** Detects when a user prompt is asking for explanation/clarification rather than requesting code edits. */
export function isClarificationOrQuestionPrompt(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || EDIT_COMMAND_VERB_PATTERN.test(trimmed)) {
    return false
  }
  if (CLARIFICATION_PHRASE_PATTERN.test(trimmed)) {
    return true
  }
  return QUESTION_STARTER_PATTERN.test(trimmed) && (trimmed.includes('?') || trimmed.includes('؟'))
}

/** Returns a concise human-readable intro above the interactive plan card without duplicating card contents. */
export function formatPlanIntroMarkdown(plan: IdeTaskPlan): string {
  if (plan.intro?.trim()) {
    return plan.intro.trim()
  }
  const arabic = hasArabicText(`${plan.requestSummary ?? ''}\n${plan.objective}`)
  if (arabic) {
    const filesText = formatArabicCount(plan.affectedFiles.length, {
      singular: 'ملف',
      dual: 'ملفان',
      plural: 'ملفات',
      accusative: 'ملفًا'
    })
    const stepsText = formatArabicCount(plan.steps.length, {
      singular: 'خطوة',
      dual: 'خطوتان',
      plural: 'خطوات',
      accusative: 'خطوة'
    })
    return `جهّزت لك خطة العمل (${filesText} · ${stepsText}). راجع الملخص بالأسفل ثم اضغط **موافقة وتنفيذ** للبدء، أو اطلب تعديلها.`
  }
  return `Prepared a ${plan.steps.length}-step plan across ${plan.affectedFiles.length} file(s). Review the card below and choose **Approve & Execute** to apply changes.`
}

export function formatPlanAsMarkdown(plan: IdeTaskPlan): string {
  const arabic = hasArabicText(`${plan.requestSummary ?? ''}\n${plan.objective}`)
  const copy = arabic
    ? {
        title: 'خطة التنفيذ المقترحة',
        objective: 'الهدف',
        files: 'الملفات المتأثرة',
        steps: 'الخطوات',
        risks: 'تقييم المخاطر',
        complexity: 'تعقيد التنفيذ المتوقع',
        none: 'لا توجد مخاطر محددة',
        actions: { create: 'إنشاء', modify: 'تعديل', delete: 'حذف' } as const,
        complexityValues: { low: 'منخفض', medium: 'متوسط', high: 'مرتفع' } as const
      }
    : {
        title: 'Proposed Implementation Plan',
        objective: 'Objective',
        files: 'Affected files',
        steps: 'Steps',
        risks: 'Risk assessment',
        complexity: 'Estimated execution complexity',
        none: 'None flagged',
        actions: { create: 'Create', modify: 'Modify', delete: 'Delete' } as const,
        complexityValues: { low: 'Low', medium: 'Medium', high: 'High' } as const
      }
  const filesSection = plan.affectedFiles
    .map((f) => `- \`${f.path}\` — ${copy.actions[f.action]}${f.summary ? ` (${f.summary})` : ''}`)
    .join('\n')
  const stepsSection = plan.steps
    .map(
      (s, idx) =>
        `${idx + 1}. **${s.title}**${s.detail && s.detail !== s.title ? ` — ${s.detail}` : ''}`
    )
    .join('\n')
  const risksSection =
    plan.risks.length > 0 ? plan.risks.map((r) => `- ${r}`).join('\n') : `- ${copy.none}`

  return [
    `### ${copy.title} (v${plan.version})`,
    `**${copy.objective}:** ${plan.objective}`,
    filesSection ? `**${copy.files}:**\n${filesSection}` : '',
    `**${copy.steps}:**\n${stepsSection}`,
    `**${copy.risks}:**\n${risksSection}`,
    `**${copy.complexity}:** ${copy.complexityValues[plan.estimatedComplexity]}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

