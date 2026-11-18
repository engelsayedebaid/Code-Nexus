import type { IdeTaskPlan } from '../../shared/ide-agent/ide-agent-types'

const EDIT_COMMAND_VERB_PATTERN =
  /\b(?:build|bulid|create|implement|refactor|delete|remove|add|update|fix|change|modify|edit|rewrite|improve|optimize|clean|move|rename|install|setup|scaffold|make|convert|apply|execute|run|style|design|wire|upgrade|configure|migrate|redesign)\b|(?:ابني|ابنِ|تبني|بناء|اعمل|تعمل|انشئ|أنشئ|تنشئ|إنشاء|انشاء|عدل|عدّل|تعدل|تعديل|صلح|صلّح|تصلح|إصلاح|اصلاح|غير|غيّر|تغير|تغيير|امسح|تمسح|مسح|احذف|تحذف|حذف|اكتب|تكتب|كتابة|ضيف|أضف|اضف|تضيف|إضافة|اضافة|نفذ|نفّذ|تنفذ|تنفيذ|ابدأ|طبق|طبّق|تطبق|تطبيق|ثبّت|تثبيت|شغّل|تشغيل|ظبط|زبط|تظبط|تزبط|حسن|حسّن|تحسن|تحسين|رتب|رتّب|ترتب|ترتيب|نظف|نظّف|صمم|صمّم|تصمم|تصميم|اربط|تربط|انقل|تنقل|حدث|حدّث|تحدث|تحديث|طور|طوّر|تطور|تطوير)/i

const GREETING_OR_PING_PATTERN =
  /^(?:hi|hello|hey|yo|test|testing|ping|ok|okay|thanks|thank\s+you|سلام|السلام\s+عليكم|اهلا|أهلا|مرحبا|مرحبًا|هلا|ازيك|إزيك|عامل\s+[اإ]يه|كيفك|شكرا|شكراً|تمام|تجربة|تيست)[!.?؟\s]*$/i

const CLARIFICATION_PHRASE_PATTERN =
  /(?:مش\s*فاهم|ما\s*فهمت|لم\s*أفهم|غير\s*واضح|مش\s*واضح|وضح(?:\s*لي)?|وضّح(?:\s*لي)?|اشرح(?:\s*لي)?|اشرحلي|يعني\s*[اإ]يه|ايش\s*(?:هذا|ده|المقصود)|[اإ]يه\s*ده|ما\s*معنى|ممكن\s*توضح|ممكن\s*تشرح|i\s+don'?t\s+understand|don'?t\s+understand|not\s+clear|unclear|clarify|explain(?:\s+(?:this|that|more|please|the\s+plan))?|what\s+does\s+(?:this|that)\s+mean|tell\s+me\s+more)/i

const QUESTION_STARTER_PATTERN =
  /^(?:ايه|إيه|اي|إي|ليه|لماذا|ما\s+هو|ما\s+هي|ماذا|هل|فين|أين|كيف|إزاي|ازاي|شايف(?:\s+(?:ايه|إيه|اي))?|رأيك|إيه\s+رأيك|ايه\s+رأيك|ممكن\s+(?:تقول|تشرح|توضح)|what|why|where|which|who|when|how|can\s+you\s+(?:tell|explain|show)|do\s+you\s+(?:see|think|know)|is\s+there|are\s+there)(?:\s|$)/i

const EXPLICIT_PLAN_REQUEST_PATTERN =
  /^(?:(?:اعمل|اكتب|جهز|جهّز|حضر|حضّر|أنشئ|انشئ)\s+(?:لي\s+)?(?:خطة|خطه)|(?:خطط|خطّط)\s+(?:لي\s+)?|(?:make|create|write|draft|prepare|show)\s+(?:me\s+)?(?:a\s+)?plan|give\s+me\s+(?:a\s+)?plan|plan\s+(?:this|the\s+work|the\s+implementation|it))(?:\s|$)/i

export function isExplicitPlanRequestPrompt(text: string): boolean {
  return EXPLICIT_PLAN_REQUEST_PATTERN.test(text.trim())
}

/** Detects when a user prompt is asking for explanation/clarification/chat rather than requesting code edits. */
export function isClarificationOrQuestionPrompt(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }
  if (GREETING_OR_PING_PATTERN.test(trimmed)) {
    return true
  }
  if (EDIT_COMMAND_VERB_PATTERN.test(trimmed)) {
    return false
  }
  if (CLARIFICATION_PHRASE_PATTERN.test(trimmed)) {
    return true
  }
  return QUESTION_STARTER_PATTERN.test(trimmed) || trimmed.endsWith('?') || trimmed.endsWith('؟')
}

/** Returns a concise human-readable intro above the interactive plan card without duplicating card contents. */
export function formatPlanIntroMarkdown(plan: IdeTaskPlan): string {
  if (plan.intro?.trim()) {
    return plan.intro.trim()
  }
  return `Prepared a ${plan.steps.length}-step plan across ${plan.affectedFiles.length} file(s). Review the card below and choose **Approve & Execute** to apply changes.`
}

export function formatPlanAsMarkdown(plan: IdeTaskPlan): string {
  const actions = {
    create: 'Create',
    modify: 'Modify',
    delete: 'Delete',
    mkdir: 'Create folder',
    rename: 'Move/Rename',
    delete_folder: 'Delete folder'
  } as const
  const complexityValues = { low: 'Low', medium: 'Medium', high: 'High' } as const
  const filesSection = plan.affectedFiles
    .map((f) => `- \`${f.path}\` — ${actions[f.action]}${f.summary ? ` (${f.summary})` : ''}`)
    .join('\n')
  const stepsSection = plan.steps
    .map((s, idx) => {
      const cleanTitle = s.title.replace(/^\s*\d+[.)]\s*/, '').trim() || s.title
      return `${idx + 1}. **${cleanTitle}**${s.detail && s.detail !== s.title ? ` — ${s.detail}` : ''}`
    })
    .join('\n')
  const risksSection =
    plan.risks.length > 0 ? plan.risks.map((r) => `- ${r}`).join('\n') : '- None flagged'

  return [
    `### Proposed Implementation Plan (v${plan.version})`,
    `**Objective:** ${plan.objective}`,
    filesSection ? `**Affected files:**\n${filesSection}` : '',
    `**Steps:**\n${stepsSection}`,
    `**Risk assessment:**\n${risksSection}`,
    `**Estimated execution complexity:** ${complexityValues[plan.estimatedComplexity]}`
  ]
    .filter(Boolean)
    .join('\n\n')
}
