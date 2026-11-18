import { describe, expect, it } from 'vitest'
import {
  isClarificationOrQuestionPrompt,
  isExplicitPlanRequestPrompt
} from './ide-agent-plan-formatting'

describe('isClarificationOrQuestionPrompt', () => {
  it('recognizes conversational Arabic questions without punctuation', () => {
    expect(isClarificationOrQuestionPrompt('شايف اي')).toBe(true)
    expect(isClarificationOrQuestionPrompt('ايه رأيك في الملف')).toBe(true)
  })

  it('keeps Arabic edit requests in the planning path', () => {
    expect(isClarificationOrQuestionPrompt('عدل الملف وصلح الخطأ')).toBe(false)
  })
})

describe('isExplicitPlanRequestPrompt', () => {
  it('requires a direct Arabic or English request for a plan', () => {
    expect(isExplicitPlanRequestPrompt('اعمل خطة لتعديل الواجهة')).toBe(true)
    expect(isExplicitPlanRequestPrompt('make a plan for the refactor')).toBe(true)
    expect(isExplicitPlanRequestPrompt('عدل الواجهة وصلح الأخطاء')).toBe(false)
  })
})
