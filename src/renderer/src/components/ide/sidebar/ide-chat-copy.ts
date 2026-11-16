import { formatArabicCount } from '../../../../../shared/ide-agent/ide-language'
import type {
  IdeExecutionMode,
  IdePlanFileAction,
  IdeRunStatus,
  IdeTaskPlan
} from '../../../../../shared/ide-agent/ide-agent-types'

export function formatIdeFileCount(count: number, arabic: boolean): string {
  if (arabic) {
    return formatArabicCount(count, {
      singular: 'ملف',
      dual: 'ملفان',
      plural: 'ملفات',
      accusative: 'ملفًا'
    })
  }
  return count === 1 ? '1 file' : `${count} files`
}

export function formatIdeStepCount(count: number, arabic: boolean): string {
  if (arabic) {
    return formatArabicCount(count, {
      singular: 'خطوة',
      dual: 'خطوتان',
      plural: 'خطوات',
      accusative: 'خطوة'
    })
  }
  return count === 1 ? '1 step' : `${count} steps`
}

export function getIdeModeLabel(mode: IdeExecutionMode, arabic: boolean): string {
  if (!arabic) {
    return mode === 'ask'
      ? 'Ask'
      : mode === 'plan'
        ? 'Plan'
        : mode === 'review'
          ? 'Review'
          : 'Agent'
  }
  switch (mode) {
    case 'ask':
      return 'سؤال'
    case 'plan':
      return 'خطة'
    case 'review':
      return 'مراجعة'
    default:
      return 'وكيل'
  }
}

export function getIdeFileActionLabel(
  action: IdePlanFileAction['action'],
  arabic: boolean
): string {
  if (!arabic) {
    return action === 'create' ? 'Create' : action === 'delete' ? 'Delete' : 'Edit'
  }
  return action === 'create' ? 'إنشاء' : action === 'delete' ? 'حذف' : 'تعديل'
}

export function getIdeComplexityLabel(
  complexity: IdeTaskPlan['estimatedComplexity'],
  arabic: boolean
): string {
  if (!arabic) {
    return complexity === 'low' ? 'Low' : complexity === 'medium' ? 'Medium' : 'High'
  }
  return complexity === 'low' ? 'بسيط' : complexity === 'medium' ? 'متوسط' : 'متقدم'
}

export function getIdeRunStageLabel(
  status: IdeRunStatus,
  arabic: boolean,
  isAnswering = false
): string {
  if (status === 'executing' && isAnswering) {
    return arabic ? 'جارٍ صياغة الرد' : 'Writing response'
  }
  const labels: Record<IdeRunStatus, readonly [string, string]> = {
    idle: ['Ready', 'جاهز'],
    analyzing: ['Inspecting project', 'جارٍ فحص المشروع'],
    planning: ['Drafting plan', 'جارٍ إعداد الخطة'],
    awaiting_approval: ['Awaiting approval', 'بانتظار الموافقة'],
    awaiting_permission: ['Permission needed', 'بانتظار الإذن'],
    executing: ['Applying changes', 'جارٍ تنفيذ التغييرات'],
    paused: ['Paused', 'متوقف مؤقتًا'],
    verifying: ['Verifying changes', 'جارٍ التحقق من التغييرات'],
    completed: ['Completed', 'اكتمل'],
    failed: ['Failed', 'تعذر الإكمال'],
    canceled: ['Stopped', 'تم الإيقاف']
  }
  return labels[status][arabic ? 1 : 0]
}

export function getIdeChatCopy(arabic: boolean) {
  if (arabic) {
    return {
      thinking: 'جارٍ التفكير وصياغة الرد...',
      answeringDetail: 'يتم إعداد رد واضح ومباشر على سؤالك.',
      analyzingDetail: 'قراءة بنية المشروع والملفات ذات الصلة.',
      planningDetail: 'تحديد الملفات المطلوبة وخطوات التنفيذ.',
      executingFallbackDetail: 'سيظهر كل ملف وخطوة هنا فور بدء تطبيقها.',
      modifiedFilesTitle: 'الملفات المعدّلة',
      commandsTitle: 'الأوامر والتحقق',
      passed: 'ناجح',
      failed: 'فشل',
      running: 'قيد التشغيل',
      canceled: 'ملغى',
      denied: 'مرفوض',
      copyMessage: 'نسخ الرد',
      copied: 'تم النسخ',
      sensitiveFile: 'ملف حساس',
      planTitle: 'خطة التنفيذ',
      filesTitle: 'الملفات المستهدفة',
      stepsTitle: 'خطوات العمل',
      showAllFiles: (count: number) => `عرض كل الملفات (${count})`,
      showStepDetails: 'عرض التفاصيل',
      hideStepDetails: 'إخفاء التفاصيل',
      notesAndVerification: (count: number) => `ملاحظات والتحقق (${count})`,
      risksLabel: 'ملاحظات ومخاطر',
      verificationLabel: 'خطوات التحقق',
      decisionApproved: 'تمت الموافقة',
      decisionRejected: 'تم الرفض',
      decisionRevision: 'طُلب تعديل',
      revisionPlaceholder: 'اكتب التعديلات التي تريدها على الخطة أو أضف متطلبات جديدة...',
      submitRevision: 'إرسال التعديل',
      cancel: 'إلغاء',
      approveAndExecute: 'موافقة وتنفيذ',
      reject: 'رفض',
      revisePlan: 'تعديل الخطة',
      viewChanges: 'عرض التغييرات',
      changeModel: 'تغيير النموذج',
      pause: 'إيقاف مؤقت',
      resume: 'استئناف',
      stop: 'إيقاف',
      retry: 'إعادة المحاولة',
      resumeHint: 'اضغط استئناف للمتابعة',
      autoContinueHint: 'التنفيذ مستمر تلقائيًا'
    }
  }
  return {
    thinking: 'Thinking...',
    answeringDetail: 'Preparing a clear, direct response.',
    analyzingDetail: 'Reading workspace structure and relevant files.',
    planningDetail: 'Mapping target files and implementation steps.',
    executingFallbackDetail: 'Each file and step will appear here as it starts.',
    modifiedFilesTitle: 'Modified files',
    commandsTitle: 'Checks & commands',
    passed: 'Passed',
    failed: 'Failed',
    running: 'Running',
    canceled: 'Canceled',
    denied: 'Denied',
    copyMessage: 'Copy response',
    copied: 'Copied',
    sensitiveFile: 'Sensitive file',
    planTitle: 'Implementation Plan',
    filesTitle: 'Target files',
    stepsTitle: 'Steps',
    showAllFiles: (count: number) => `Show all (${count})`,
    showStepDetails: 'Show details',
    hideStepDetails: 'Hide details',
    notesAndVerification: (count: number) => `Notes & checks (${count})`,
    risksLabel: 'Notes & risks',
    verificationLabel: 'Verification',
    decisionApproved: 'Approved',
    decisionRejected: 'Rejected',
    decisionRevision: 'Revision requested',
    revisionPlaceholder: 'Describe what to change, add requirements, or adjust the approach...',
    submitRevision: 'Submit Revision',
    cancel: 'Cancel',
    approveAndExecute: 'Approve & Execute',
    reject: 'Reject',
    revisePlan: 'Revise',
    viewChanges: 'View Changes',
    changeModel: 'Change model',
    pause: 'Pause',
    resume: 'Resume',
    stop: 'Stop',
    retry: 'Retry',
    resumeHint: 'Resume to continue',
    autoContinueHint: 'Running steps automatically'
  }
}
