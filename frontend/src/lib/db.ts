import Dexie, { type Table } from 'dexie'
import type {
  AttemptRequest,
  LearningPackage,
  DiagnosisSession,
  LearningPath,
  SyncEvent,
  Student
} from '../types/api'

export interface OfflineEventRecord {
  id?: number
  eventId: string
  studentId: string
  type: string
  payload: string
  createdAt: number
  synced: boolean
}

export interface CachedPackage {
  packageId: string
  version: number
  data: string
  cachedAt: number
}

export interface CachedDiagnosis {
  sessionId: string
  studentId: string
  data: string
  updatedAt: number
}

export interface CachedLearningPath {
  pathId: string
  studentId: string
  data: string
  updatedAt: number
}

export interface CachedStudent {
  studentId: string
  data: string
  updatedAt: number
}

const DB_NAME = 'PeerStudyDB'
const DB_VERSION = 3

export class PeerStudyDB extends Dexie {
  events!: Table<OfflineEventRecord, number>
  packages!: Table<CachedPackage, string>
  diagnoses!: Table<CachedDiagnosis, string>
  learningPaths!: Table<CachedLearningPath, string>
  students!: Table<CachedStudent, string>

  constructor() {
    super(DB_NAME)
    this.version(DB_VERSION).stores({
      events: '++id,eventId,studentId,synced,createdAt',
      packages: 'packageId',
      diagnoses: 'sessionId,studentId',
      learningPaths: 'pathId,studentId',
      students: 'studentId'
    })
  }
}

let dbInstance: PeerStudyDB | null = null

async function getDB(): Promise<PeerStudyDB> {
  if (dbInstance) return dbInstance

  const instance = new PeerStudyDB()
  
  instance.on('versionchange', (event) => {
    console.warn('[PeerStudyDB] Version change detected, closing database...')
    instance.close()
    dbInstance = null
    if (event.newVersion === null) {
      window.location.reload()
    }
  })

  try {
    await instance.open()
    dbInstance = instance
    return instance
  } catch (error) {
    if (error instanceof Dexie.VersionError) {
      console.warn('[PeerStudyDB] Version conflict detected, recreating database...')
      await instance.delete()
      const fresh = new PeerStudyDB()
      await fresh.open()
      dbInstance = fresh
      return fresh
    }
    throw error
  }
}

export async function getDatabase(): Promise<PeerStudyDB> {
  return getDB()
}

export async function queueEvent(event: AttemptRequest | SyncEvent) {
  const db = await getDB()
  const payload = 'payload' in event ? event.payload : event
  const type = 'type' in event ? event.type : 'question_attempted'
  const eventId = 'eventId' in event ? event.eventId : crypto.randomUUID()
  const studentId = 'studentId' in event ? event.studentId : 'unknown'
  const timestamp = 'createdAt' in event ? event.createdAt : event.deviceTimestamp

  const existing = await db.events.where('eventId').equals(eventId).first()
  if (existing) return

  await db.events.add({
    eventId,
    studentId,
    type,
    payload: JSON.stringify(payload),
    createdAt: new Date(timestamp).getTime(),
    synced: false
  })
}

export async function getUnsyncedEvents(studentId: string): Promise<OfflineEventRecord[]> {
  const db = await getDB()
  return db.events.where({ studentId, synced: 0 }).sortBy('createdAt')
}

export async function markEventsSynced(eventIds: string[]) {
  const db = await getDB()
  await db.events.where('eventId').anyOf(eventIds).modify({ synced: true })
}

export async function clearSyncedEvents() {
  const db = await getDB()
  await db.events.where({ synced: 1 }).delete()
}

export async function cachePackage(pkg: LearningPackage) {
  const db = await getDB()
  await db.packages.put({
    packageId: pkg.packageId,
    version: pkg.version,
    data: JSON.stringify(pkg),
    cachedAt: Date.now()
  })
}

export async function getCachedPackage(packageId: string): Promise<LearningPackage | null> {
  const db = await getDB()
  const record = await db.packages.get(packageId)
  return record ? JSON.parse(record.data) : null
}

export async function cacheDiagnosis(session: DiagnosisSession) {
  const db = await getDB()
  await db.diagnoses.put({
    sessionId: session.id,
    studentId: session.studentId,
    data: JSON.stringify(session),
    updatedAt: Date.now()
  })
}

export async function getCachedDiagnosis(sessionId: string): Promise<DiagnosisSession | null> {
  const db = await getDB()
  const record = await db.diagnoses.get(sessionId)
  return record ? JSON.parse(record.data) : null
}

export async function cacheLearningPath(studentId: string, path: LearningPath) {
  const db = await getDB()
  await db.learningPaths.put({
    pathId: path.id,
    studentId,
    data: JSON.stringify(path),
    updatedAt: Date.now()
  })
}

export async function getCachedLearningPath(pathId: string): Promise<LearningPath | null> {
  const db = await getDB()
  const record = await db.learningPaths.get(pathId)
  return record ? JSON.parse(record.data) : null
}
