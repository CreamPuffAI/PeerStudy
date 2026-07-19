import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./db', () => ({
  cacheDiagnosis: vi.fn(),
  cachePackage: vi.fn(),
  getCachedPackage: vi.fn(),
  queueEvent: vi.fn(),
}))

import { generateDiagnosisHint, getOfflineDiagnosisHint, rewriteExplanation, submitAttempt } from './api'
import { getCachedPackage, queueEvent } from './db'
import { createLearningAttempt, getWorkedExampleById } from './learning'

const fetchMock = vi.fn()

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('generateDiagnosisHint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', { onLine: true })
  })

  it('returns generated content and only sends the approved request fields', async () => {
    fetchMock.mockResolvedValueOnce(response({
      success: true,
      data: {
        id: 'HINT_diag-001__short',
        skillId: 'F11',
        sourceContentId: 'diag-001',
        style: 'short',
        message: 'Hãy tìm mẫu số chung trước.',
        generated: true,
        fallbackUsed: false,
      },
    }))

    const result = await generateDiagnosisHint({
      packageId: 'math-fractions-v1',
      diagnosisSessionId: 'diag-001',
    })

    expect(result.generated).toBe(true)
    expect(result.fallbackUsed).toBe(false)
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(requestBody).toEqual({
      packageId: 'math-fractions-v1',
      diagnosisSessionId: 'diag-001',
      style: 'short',
      constraints: { maxSentences: 2, maxWords: 30 },
    })
    expect(JSON.stringify(requestBody)).not.toMatch(/rootGap|mastery|evidence|source text/i)
  })

  it('preserves a verified fallback response from the backend', async () => {
    fetchMock.mockResolvedValueOnce(response({
      success: true,
      data: {
        id: 'HINT_diag-001',
        skillId: 'F11',
        sourceContentId: 'diag-001',
        style: 'short',
        message: 'Hãy thử tìm mẫu số chung trước.',
        generated: false,
        fallbackUsed: true,
      },
    }))

    const result = await generateDiagnosisHint({
      packageId: 'math-fractions-v1',
      diagnosisSessionId: 'diag-001',
    })

    expect(result.message).toContain('mẫu số chung')
    expect(result.generated).toBe(false)
    expect(result.fallbackUsed).toBe(true)
  })

  it('exposes the contract error code for retry UI', async () => {
    fetchMock.mockResolvedValueOnce(response({
      success: false,
      error: {
        code: 'AI_HINT_NOT_READY',
        message: 'Phiên chẩn đoán chưa hoàn tất.',
        details: { diagnosisSessionId: 'diag-001' },
      },
    }, 409))

    await expect(generateDiagnosisHint({
      packageId: 'math-fractions-v1',
      diagnosisSessionId: 'diag-001',
    })).rejects.toMatchObject({
      code: 'AI_HINT_NOT_READY',
      status: 409,
    })
  })

  it('does not call the backend while offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })

    await expect(generateDiagnosisHint({
      packageId: 'math-fractions-v1',
      diagnosisSessionId: 'diag-001',
    })).rejects.toMatchObject({ code: 'OFFLINE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('can read a concise verified explanation from the offline package cache', async () => {
    vi.mocked(getCachedPackage).mockResolvedValueOnce({
      explanations: [{
        id: 'EXP_F11_BASIC',
        skillId: 'F11',
        style: 'step_by_step',
        content: 'Tìm mẫu số chung trước. Sau đó quy đồng từng phân số.',
      }],
    } as never)

    await expect(getOfflineDiagnosisHint('math-fractions-v1', 'F11'))
      .resolves.toBe('Tìm mẫu số chung trước. Sau đó quy đồng từng phân số.')
  })
})

describe('rewriteExplanation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', { onLine: true })
  })

  it('sends the contract URL, method, and approved request body', async () => {
    fetchMock.mockResolvedValueOnce(response({
      success: true,
      data: {
        id: 'EXP_F11_BASIC__step_by_step',
        skillId: 'F11',
        sourceContentId: 'EXP_F11_BASIC',
        style: 'step_by_step',
        content: 'Bước một: tìm mẫu số chung. Bước hai: quy đồng từng phân số.',
        generated: true,
        fallbackUsed: false,
      },
    }))

    await rewriteExplanation({
      packageId: 'math-fractions-v1',
      skillId: 'F11',
      contentId: 'EXP_F11_BASIC',
      style: 'step_by_step',
      constraints: { maxSentences: 2, maxWords: 40 },
    })

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/api/v1/ai/rewrite-explanation')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      packageId: 'math-fractions-v1',
      skillId: 'F11',
      contentId: 'EXP_F11_BASIC',
      style: 'step_by_step',
      constraints: { maxSentences: 2, maxWords: 40 },
    })
  })

  it('returns generated and deterministic fallback responses without changing their flags', async () => {
    fetchMock
      .mockResolvedValueOnce(response({
        success: true,
        data: {
          id: 'EXP_F11_BASIC__short',
          skillId: 'F11',
          sourceContentId: 'EXP_F11_BASIC',
          style: 'short',
          content: 'Tìm mẫu số chung trước.',
          generated: true,
          fallbackUsed: false,
        },
      }))
      .mockResolvedValueOnce(response({
        success: true,
        data: {
          id: 'EXP_F11_BASIC__visual',
          skillId: 'F11',
          sourceContentId: 'EXP_F11_BASIC',
          style: 'visual',
          content: 'Hãy tưởng tượng các phân số cùng đứng trên một mẫu số.',
          generated: false,
          fallbackUsed: true,
        },
      }))

    const generated = await rewriteExplanation({
      packageId: 'math-fractions-v1',
      skillId: 'F11',
      contentId: 'EXP_F11_BASIC',
      style: 'short',
    })
    const fallback = await rewriteExplanation({
      packageId: 'math-fractions-v1',
      skillId: 'F11',
      contentId: 'EXP_F11_BASIC',
      style: 'visual',
    })

    expect(generated.generated).toBe(true)
    expect(generated.fallbackUsed).toBe(false)
    expect(fallback.generated).toBe(false)
    expect(fallback.fallbackUsed).toBe(true)
  })

  it('surfaces the API error envelope for retry UI', async () => {
    fetchMock.mockResolvedValueOnce(response({
      success: false,
      error: {
        code: 'AI_CONTENT_ERROR',
        message: 'Không có nội dung giải thích hợp lệ.',
        details: { contentId: 'EXP_UNKNOWN' },
      },
    }, 422))

    await expect(rewriteExplanation({
      packageId: 'math-fractions-v1',
      skillId: 'F11',
      contentId: 'EXP_UNKNOWN',
      style: 'short',
    })).rejects.toMatchObject({
      code: 'AI_CONTENT_ERROR',
      status: 422,
    })
  })
})

describe('submitAttempt queue boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', { onLine: true })
  })

  it('does not queue an online attempt before sending it to the backend', async () => {
    fetchMock.mockResolvedValueOnce(response({
      success: true,
      data: { correct: true },
    }))

    await submitAttempt({
      eventId: 'online-1',
      studentId: 'student-001',
      classId: 'class-7a',
      packageId: 'math-fractions-v1',
      questionId: 'Q_E01_001',
      purpose: 'target',
      context: {},
      answer: { type: 'multiple_choice', value: 'B' },
      responseTimeMs: 4200,
      attemptNumber: 1,
      deviceTimestamp: '2026-07-19T00:00:00Z',
      offlineCreated: false,
    })

    expect(queueEvent).not.toHaveBeenCalled()
  })

  it('queues an offline attempt once and exposes an offline state to the UI', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const payload = {
      eventId: 'offline-1',
      studentId: 'student-001',
      classId: 'class-7a',
      packageId: 'math-fractions-v1',
      questionId: 'Q_E01_001',
      purpose: 'target' as const,
      context: {},
      answer: { type: 'multiple_choice' as const, value: 'B' },
      responseTimeMs: 4200,
      attemptNumber: 1,
      deviceTimestamp: '2026-07-19T00:00:00Z',
      offlineCreated: true,
    }

    await expect(submitAttempt(payload)).rejects.toMatchObject({ code: 'OFFLINE' })
    expect(queueEvent).toHaveBeenCalledWith(payload)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('learning path data boundaries', () => {
  it('reads worked examples and preserves the active question contract', () => {
    const learningPackage = {
      packageId: 'math-fractions-v1',
      version: 3,
      name: 'Fractions',
      updatedAt: '2026-07-17T10:00:00Z',
      skills: [],
      questions: [{
        id: 'P_F11_001',
        skillId: 'F11',
        purpose: 'practice' as const,
        type: 'numeric' as const,
        prompt: 'Tìm BCNN của 3 và 5',
      }],
      explanations: [],
      workedExamples: [{
        id: 'EXAMPLE_F11_001',
        skillId: 'F11',
        title: 'Quy đồng 1/2 và 1/3',
        steps: ['Tìm mẫu số chung là 6.'],
      }],
    }

    expect(getWorkedExampleById(learningPackage, 'EXAMPLE_F11_001')?.steps).toEqual([
      'Tìm mẫu số chung là 6.',
    ])
    const attempt = createLearningAttempt({
      eventId: 'learning-question-1',
      studentId: 'student-001',
      classId: 'class-7a',
      packageId: 'math-fractions-v1',
      question: learningPackage.questions[0],
      answer: '15',
      learningPathId: 'lp-001',
      learningStepId: 'step-3',
      responseTimeMs: 4200,
      deviceTimestamp: '2026-07-19T00:00:00Z',
      offlineCreated: false,
    })

    expect(attempt.questionId).toBe('P_F11_001')
    expect(attempt.purpose).toBe('practice')
    expect(attempt.answer).toEqual({ type: 'numeric', value: '15' })
  })
})
