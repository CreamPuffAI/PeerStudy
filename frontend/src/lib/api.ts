import type {
  ApiResponse,
  LearningPackage,
  ClassInsights,
  AttemptRequest,
  AttemptResponse,
  DiagnosisSession,
  SyncRequest,
  SyncResponse,
  GenerateDiagnosisHintRequest,
  GenerateDiagnosisHintResponse,
  RewriteExplanationRequest,
  RewriteExplanationResponse,
  GenerateQuestionVariantRequest,
  GenerateQuestionVariantResponse,
} from '../types/api'
import { queueEvent, cachePackage, getCachedPackage, cacheDiagnosis, getCachedDiagnosis } from './db'

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
).replace(/\/$/, '')

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code = 'API_ERROR',
    public readonly status?: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch (error) {
    if (isOffline()) {
      throw new ApiError('Đang offline. Không thể kết nối tới PeerStudy.', 'OFFLINE')
    }
    throw new ApiError(
      error instanceof Error ? error.message : 'Không thể kết nối tới PeerStudy.',
      'NETWORK_ERROR',
    )
  }

  let body: ApiResponse<unknown>
  try {
    body = await res.json() as ApiResponse<unknown>
  } catch {
    throw new ApiError('PeerStudy trả về phản hồi không hợp lệ.', 'INVALID_RESPONSE', res.status)
  }

  if (!res.ok || body.success === false) {
    const errorBody = body.success === false ? body.error : undefined
    throw new ApiError(
      errorBody?.message ?? `API error ${res.status}`,
      errorBody?.code ?? 'API_ERROR',
      res.status,
      errorBody?.details,
    )
  }

  if (body.success !== true) {
    throw new ApiError('PeerStudy trả về phản hồi không hợp lệ.', 'INVALID_RESPONSE', res.status)
  }

  return body.data as T
}

export async function fetchLearningPackage(packageId: string): Promise<LearningPackage> {
  try {
    const pkg = await apiFetch<LearningPackage>(`/api/v1/learning-packages/${packageId}`)
    await cachePackage(pkg)
    return pkg
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'OFFLINE' || error.code === 'NETWORK_ERROR')) {
      const cached = await getCachedPackage(packageId)
      if (cached) return cached
    }
    throw error
  }
}

export async function getCachedLearningPackage(packageId: string): Promise<LearningPackage | null> {
  return getCachedPackage(packageId)
}

export async function submitAttempt(payload: AttemptRequest): Promise<AttemptResponse> {
  if (isOffline()) {
    await queueEvent(payload)
    throw new ApiError(
      'Đang offline. Đáp án đã được lưu trên thiết bị và sẽ đồng bộ khi có mạng.',
      'OFFLINE',
    )
  }

  return apiFetch<AttemptResponse>('/api/v1/attempts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getDiagnosisSession(sessionId: string): Promise<DiagnosisSession> {
  try {
    const session = await apiFetch<DiagnosisSession>(`/api/v1/diagnosis-sessions/${sessionId}`)
    await cacheDiagnosis(session)
    return session
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'OFFLINE' || error.code === 'NETWORK_ERROR')) {
      const cached = await getCachedDiagnosis(sessionId)
      if (cached) return cached
    }
    throw error
  }
}

export async function getClassInsights(classId: string, packageId?: string): Promise<ClassInsights> {
  const params = packageId ? `?packageId=${encodeURIComponent(packageId)}` : ''
  return apiFetch<ClassInsights>(`/api/v1/classes/${classId}/insights${params}`)
}

export async function syncEvents(request: SyncRequest): Promise<SyncResponse> {
  return apiFetch<SyncResponse>('/api/v1/sync', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function generateDiagnosisHint(
  request: GenerateDiagnosisHintRequest,
): Promise<GenerateDiagnosisHintResponse> {
  if (isOffline()) {
    throw new ApiError('Đang offline. Không thể gọi dịch vụ AI.', 'OFFLINE')
  }

  return apiFetch<GenerateDiagnosisHintResponse>('/api/v1/ai/generate-diagnosis-hint', {
    method: 'POST',
    body: JSON.stringify({
      packageId: request.packageId,
      diagnosisSessionId: request.diagnosisSessionId,
      style: request.style ?? 'short',
      constraints: request.constraints ?? { maxSentences: 2, maxWords: 30 },
    }),
  })
}

export async function rewriteExplanation(
  request: RewriteExplanationRequest,
): Promise<RewriteExplanationResponse> {
  return apiFetch<RewriteExplanationResponse>('/api/v1/ai/rewrite-explanation', {
    method: 'POST',
    body: JSON.stringify({
      packageId: request.packageId,
      skillId: request.skillId,
      contentId: request.contentId,
      style: request.style ?? 'short',
      constraints: request.constraints ?? {},
    }),
  })
}

export async function generateQuestionVariant(
  request: GenerateQuestionVariantRequest,
): Promise<GenerateQuestionVariantResponse> {
  return apiFetch<GenerateQuestionVariantResponse>('/api/v1/ai/generate-question-variant', {
    method: 'POST',
    body: JSON.stringify({
      packageId: request.packageId,
      skillId: request.skillId,
      questionId: request.questionId,
      style: request.style ?? 'step_by_step',
      constraints: request.constraints ?? {},
    }),
  })
}

export async function getOfflineDiagnosisHint(
  packageId: string,
  skillId: string,
): Promise<string | null> {
  const pkg = await getCachedLearningPackage(packageId)
  const explanation = pkg?.explanations.find(item => item.skillId === skillId)
  if (!explanation) return null

  const sentences = explanation.content.match(/[^.!?]+[.!?]+/g) ?? [explanation.content]
  return sentences.slice(0, 2).map(sentence => sentence.trim()).join(' ')
}
