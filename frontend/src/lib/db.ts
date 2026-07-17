import Dexie from 'dexie'

export interface OfflineEvent {
  id?: number
  student_id: string
  root_cause: string
  status: string
  timestamp: number
}

export class PeerStudyDB extends Dexie {
  events!: Dexie.Table<OfflineEvent, number>

  constructor() {
    super('PeerStudyDB')
    this.version(1).stores({
      events: '++id,student_id,root_cause,status,timestamp'
    })
  }
}

export const db = new PeerStudyDB()
