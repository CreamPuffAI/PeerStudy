import type {
  LearningPackage,
  ClassInsights,
  AttemptRequest,
  AttemptResponse,
  DiagnosisSession,
  SyncRequest,
  SyncResponse,
} from '../types/api'
import { queueEvent, cachePackage, getCachedPackage, cacheDiagnosis } from './db'

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
).replace(/\/$/, '')

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

  const body = await res.json()

  if (!res.ok || body.success === false) {
    const message = body?.error?.message ?? `API error ${res.status}`
    throw new Error(message)
  }

  return body.data as T
}

export async function fetchLearningPackage(packageId: string): Promise<LearningPackage> {
  const pkg = await apiFetch<LearningPackage>(`/api/v1/learning-packages/${packageId}`)
  await cachePackage(pkg)
  return pkg
}

export async function getCachedLearningPackage(packageId: string): Promise<LearningPackage | null> {
  return getCachedPackage(packageId)
}

export async function submitAttempt(payload: AttemptRequest): Promise<AttemptResponse> {
  await queueEvent(payload)

  if (!navigator.onLine) {
    throw new Error('Offline - sự kiện đã được lưu, sẽ đồng bộ khi có mạng.')
  }

  return apiFetch<AttemptResponse>('/api/v1/attempts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getDiagnosisSession(sessionId: string): Promise<DiagnosisSession> {
  const session = await apiFetch<DiagnosisSession>(`/api/v1/diagnosis-sessions/${sessionId}`)
  await cacheDiagnosis(session)
  return session
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
