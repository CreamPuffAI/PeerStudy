import type {
  LearningPackage,
  ClassInsights,
  AttemptRequest,
  AttemptResponse,
  DiagnosisSession,
  SyncRequest,
  SyncResponse,
  NextAction,
  FeedbackType,
  DiagnosisClassification
} from '../types/api'
import {
  learningPackage,
  classInsights,
  getQuestionById,
  getExplanationById,
  getSkillById,
  demoLearningPaths
} from './mockData'
import { queueEvent, getUnsyncedEvents, markEventsSynced, cachePackage, getCachedPackage, cacheDiagnosis, getCachedDiagnosis, cacheLearningPath } from './db'

const MOCK_LATENCY = 300

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Question sequence for practice flow
const questionSequence: Record<string, string> = {
  'Q_E01_001': 'Q_E01_RETRY_001',
  'Q_E01_RETRY_001': 'P_F11_001',
  'P_F11_001': 'CP_F11_001',
  'CP_F11_001': 'Q_E01_001',
}

function getNextQuestionId(currentQuestionId: string): string {
  return questionSequence[currentQuestionId] ?? currentQuestionId
}

interface DiagnosisSessionState {
  id: string
  answeredQuestionIds: string[]
  currentQuestionIndex: number
  status: 'in_progress' | 'completed'
}

const diagnosticQuestionSequence: string[] = [
  'DQ_F11_002',
  'DQ_F08_001',
  'DQ_F14_001',
]

const diagnosisSessions = new Map<string, DiagnosisSessionState>()

function getOrCreateDiagnosisSession(sessionId: string): DiagnosisSessionState {
  let state = diagnosisSessions.get(sessionId)
  if (!state) {
    state = {
      id: sessionId,
      answeredQuestionIds: [],
      currentQuestionIndex: 0,
      status: 'in_progress'
    }
    diagnosisSessions.set(sessionId, state)
  }
  return state
}

function getNextDiagnosticQuestion(sessionState: DiagnosisSessionState): string | null {
  const { currentQuestionIndex } = sessionState
  if (currentQuestionIndex >= diagnosticQuestionSequence.length) {
    return null // No more questions
  }
  return diagnosticQuestionSequence[currentQuestionIndex]
}

export async function fetchLearningPackage(packageId: string): Promise<LearningPackage> {
  await delay(MOCK_LATENCY)
  if (packageId !== learningPackage.packageId) throw new Error('Package not found')
  await cachePackage(learningPackage)
  return learningPackage
}

export async function getCachedLearningPackage(packageId: string): Promise<LearningPackage | null> {
  return getCachedPackage(packageId)
}

export async function submitAttempt(payload: AttemptRequest): Promise<AttemptResponse> {
  await delay(MOCK_LATENCY)
  const question = getQuestionById(payload.questionId)
  if (!question) throw new Error('Question not found')

  const isCorrect =
    payload.answer.type === 'multiple_choice'
      ? payload.answer.value === question.validation.correctAnswer
      : question.validation.acceptedAnswers
        ? question.validation.acceptedAnswers.includes(payload.answer.value)
        : payload.answer.value === question.validation.correctAnswer

  await queueEvent(payload)

  const errorPattern = isCorrect
    ? undefined
    : (question.errorMappings?.[payload.answer.value] ?? 'UNKNOWN_ERROR')

  if (payload.purpose === 'diagnostic') {
    const diagSessionId = payload.context.diagnosisSessionId ?? `diag-${Date.now()}`
    const diagState = getOrCreateDiagnosisSession(diagSessionId)
    diagState.answeredQuestionIds.push(payload.questionId)
    diagState.currentQuestionIndex += 1
    const nextQId = getNextDiagnosticQuestion(diagState)

    if (!nextQId) {
      diagState.status = 'completed'
      if (isCorrect) {
        return {
          attemptId: `attempt-${Date.now()}`,
          correct: true,
          skillUpdate: {
            skillId: question.skillId,
            previousMastery: 0.4,
            currentMastery: 0.65,
            status: 'learning'
          },
          next: {
            action: 'start_learning_path' as NextAction,
            learningPathId: 'lp-F11'
          },
          feedback: {
            type: 'success' as FeedbackType,
            message: 'Đúng rồi! Đã hoàn thành chẩn đoán.'
          }
        }
      }
      return {
        attemptId: `attempt-${Date.now()}`,
        correct: false,
        detectedErrorPattern: {
          code: errorPattern ?? 'UNKNOWN_ERROR',
          label: mapErrorLabel(errorPattern ?? 'UNKNOWN_ERROR'),
          confidence: 0.78
        },
        candidateSkills: [
          { skillId: question.skillId, name: getSkillById(question.skillId)?.name ?? '', suspicionScore: 0.72 }
        ],
        diagnosisSession: {
          id: diagSessionId,
          status: 'completed',
          answeredCount: diagState.answeredQuestionIds.length,
          maxQuestions: diagnosticQuestionSequence.length
        },
        next: {
          action: 'start_learning_path' as NextAction,
          learningPathId: 'lp-F11'
        },
        feedback: {
          type: 'neutral' as FeedbackType,
          message: 'Đã hoàn thành chẩn đoán. Xem lộ trình phục hồi nhé.'
        }
      }
    }

    if (isCorrect) {
      return {
        attemptId: `attempt-${Date.now()}`,
        correct: true,
        skillUpdate: {
          skillId: question.skillId,
          previousMastery: 0.4,
          currentMastery: 0.65,
          status: 'learning'
        },
        next: {
          action: 'continue_diagnostic' as NextAction,
          questionId: nextQId,
          diagnosisSessionId: diagSessionId
        },
        feedback: {
          type: 'success' as FeedbackType,
          message: 'Đúng rồi! Tiếp tục nhé.'
        }
      }
    }

    return {
      attemptId: `attempt-${Date.now()}`,
      correct: false,
      detectedErrorPattern: {
        code: errorPattern ?? 'UNKNOWN_ERROR',
        label: mapErrorLabel(errorPattern ?? 'UNKNOWN_ERROR'),
        confidence: 0.78
      },
      candidateSkills: [
        { skillId: question.skillId, name: getSkillById(question.skillId)?.name ?? '', suspicionScore: 0.72 }
      ],
      diagnosisSession: {
        id: diagSessionId,
        status: 'in_progress',
        answeredCount: diagState.answeredQuestionIds.length,
        maxQuestions: diagnosticQuestionSequence.length
      },
      next: {
        action: 'continue_diagnostic' as NextAction,
        questionId: nextQId,
        diagnosisSessionId: diagSessionId
      },
      feedback: {
        type: 'neutral' as FeedbackType,
        message: 'Chưa chính xác. Hãy thử câu tiếp theo.'
      }
    }
  }

  if (isCorrect) {
    const skill = getSkillById(question.skillId)
    return {
      attemptId: `attempt-${Date.now()}`,
      correct: true,
      skillUpdate: {
        skillId: question.skillId,
        previousMastery: 0.4,
        currentMastery: 0.65,
        status: 'learning'
      },
      next: {
        action: payload.purpose === 'checkpoint'
          ? 'return_to_target'
          : 'continue_practice',
        questionId: getNextQuestionId(question.id)
      },
      feedback: {
        type: 'success' as FeedbackType,
        message: 'Đúng rồi! Tiếp tục nhé.'
      }
    }
  }

  if (payload.purpose === 'target' || payload.purpose === 'practice') {
    const diagSessionId = `diag-${Date.now()}`
    const diagState = getOrCreateDiagnosisSession(diagSessionId)
    diagState.currentQuestionIndex = 0
    const nextQId = getNextDiagnosticQuestion(diagState)

    return {
      attemptId: `attempt-${Date.now()}`,
      correct: false,
      detectedErrorPattern: {
        code: errorPattern ?? 'UNKNOWN_ERROR',
        label: mapErrorLabel(errorPattern ?? 'UNKNOWN_ERROR'),
        confidence: 0.78
      },
      candidateSkills: [
        { skillId: question.skillId, name: getSkillById(question.skillId)?.name ?? '', suspicionScore: 0.72 },
        { skillId: 'F08', name: 'Phân số tương đương', suspicionScore: 0.3 }
      ],
      diagnosisSession: {
        id: diagSessionId,
        status: 'in_progress',
        answeredCount: diagState.answeredQuestionIds.length,
        maxQuestions: diagnosticQuestionSequence.length
      },
      next: {
        action: 'continue_diagnostic' as NextAction,
        questionId: nextQId ?? diagnosticQuestionSequence[0],
        diagnosisSessionId: diagSessionId
      },
      feedback: {
        type: 'neutral' as FeedbackType,
        message: 'Hãy trả lời một vài câu ngắn để hệ thống tìm phần kiến thức em cần củng cố.'
      }
    }
  }

  return {
    attemptId: `attempt-${Date.now()}`,
    correct: false,
    detectedErrorPattern: {
      code: errorPattern ?? 'UNKNOWN_ERROR',
      label: mapErrorLabel(errorPattern ?? 'UNKNOWN_ERROR'),
      confidence: 0.78
    },
    candidateSkills: [
      { skillId: question.skillId, name: getSkillById(question.skillId)?.name ?? '', suspicionScore: 0.5 }
    ],
    diagnosisSession: {
      id: `diag-fallback-${Date.now()}`,
      status: 'in_progress',
      answeredCount: 0,
      maxQuestions: 3
    },
    next: {
      action: 'continue_practice',
      questionId: getNextQuestionId(question.id)
    },
    feedback: {
      type: 'neutral' as FeedbackType,
      message: 'Chưa chính xác. Hãy thử lại nhé.'
    }
  }
}

function mapErrorLabel(code: string): string {
  const labels: Record<string, string> = {
    ADD_DENOMINATORS: 'Cộng trực tiếp hai mẫu số',
    INCOMPLETE_MULTIPLE: 'Chưa hiểu bội số',
    USES_PRODUCT_INSTEAD_OF_LCM: 'Dùng tích thay vì BCNN',
    SIGN_ERROR: 'Sai quy tắc dấu',
    UNKNOWN_ERROR: 'Lỗi chưa xác định'
  }
  return labels[code] ?? code
}

export async function getDiagnosisSession(sessionId: string): Promise<DiagnosisSession> {
  await delay(200)

  const state = getOrCreateDiagnosisSession(sessionId)
  const nextQId = getNextDiagnosticQuestion(state)
  const nextQuestion = nextQId ? getQuestionById(nextQId) : undefined

  const session: DiagnosisSession = {
    id: sessionId,
    studentId: 'student-001',
    triggerQuestionId: 'Q_E01_001',
    triggerSkillId: 'E01',
    status: state.status,
    answeredCount: state.answeredQuestionIds.length,
    maxQuestions: diagnosticQuestionSequence.length,
    candidates: [
      { skillId: 'F11', name: 'Quy đồng mẫu số', score: 0.77 },
      { skillId: 'F08', name: 'Phân số tương đương', score: 0.31 }
    ],
    nextQuestion
  }
  await cacheDiagnosis(session)
  return session
}

export async function completeDiagnosis(sessionId: string, rootGapSkillId: string): Promise<DiagnosisSession> {
  await delay(300)
  const skill = getSkillById(rootGapSkillId)
  const path = demoLearningPaths.find(p => p.rootGapSkillId === rootGapSkillId)

  const session: DiagnosisSession = {
    id: sessionId,
    studentId: 'student-001',
    triggerQuestionId: 'Q_E01_001',
    triggerSkillId: 'E01',
    status: 'completed',
    answeredCount: 3,
    maxQuestions: 4,
    candidates: [
      { skillId: rootGapSkillId, name: skill?.name ?? '', score: 0.87 }
    ],
    diagnosis: {
      rootGap: skill ? { skillId: skill.id, name: skill.name, grade: skill.grade } : null,
      confidence: 0.87,
      classification: 'knowledge_gap' as DiagnosisClassification,
      evidence: [
        { type: 'incorrect_diagnostic_answer', skillId: rootGapSkillId, message: 'Học sinh tìm sai mẫu số chung.' },
        { type: 'repeated_error_pattern', message: 'Lỗi quy đồng xuất hiện trong hai câu liên tiếp.' }
      ]
    },
    learningPath: path ?? undefined,
    next: {
      action: 'start_learning_path' as NextAction,
      learningPathId: path?.id
    }
  }
  await cacheDiagnosis(session)
  if (path) await cacheLearningPath('student-001', path)
  return session
}

export async function getClassInsights(classId: string, packageId?: string): Promise<ClassInsights> {
  await delay(MOCK_LATENCY)
  if (classId !== 'class-7a') throw new Error('Class not found')
  return {
    ...classInsights,
    commonGaps: packageId
      ? classInsights.commonGaps.filter(g => classInsights.groups.some(gr => gr.skillId === g.skillId))
      : classInsights.commonGaps
  }
}

export async function syncEvents(request: SyncRequest): Promise<SyncResponse> {
  await delay(500)
  const unsynced = await getUnsyncedEvents(request.studentId)
  const eventIds = request.events.map(e => e.eventId)
  const accepted = eventIds.filter(id => unsynced.some(u => u.eventId === id))
  await markEventsSynced(accepted)
  return {
    acceptedEventIds: accepted,
    duplicateEventIds: [],
    rejectedEvents: [],
    serverTimestamp: new Date().toISOString()
  }
}
