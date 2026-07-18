import { useState, useEffect, useRef, useCallback } from 'react'
import { GraduationCap, LayoutDashboard, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import type { ClassInsights } from './types/api'
import { TeacherDashboard } from './components/teacher/TeacherDashboard'
import { StudentView } from './components/student/StudentView'
import { getUnsyncedEvents, markEventsSynced, clearSyncedEvents } from './lib/db'
import { syncEvents, getClassInsights } from './lib/api'

export default function App() {
  const [offline, setOffline] = useState(!navigator.onLine)
  const [activeRole, setActiveRole] = useState<'student' | 'teacher'>('teacher')
  const [syncing, setSyncing] = useState(false)
  const [pendingEvents, setPendingEvents] = useState(0)
  const [classInsights, setClassInsights] = useState<ClassInsights | null>(null)
  const [classInsightsError, setClassInsightsError] = useState<string | null>(null)
  const syncingRef = useRef(false)

  const syncPendingEvents = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return
    
    try {
      syncingRef.current = true
      setSyncing(true)
      
      const unsynced = await getUnsyncedEvents('student-001')
      
      if (unsynced.length > 0) {
        const response = await syncEvents({
          deviceId: 'device-001',
          studentId: 'student-001',
          packageId: 'math-fractions-v1',
          packageVersion: 3,
          events: unsynced.map(e => ({
            eventId: e.eventId,
            type: e.type as 'question_attempted' | 'learning_step_completed' | 'checkpoint_completed' | 'learning_path_completed',
            createdAt: new Date(e.createdAt).toISOString(),
            payload: JSON.parse(e.payload)
          }))
        })

        if (response.acceptedEventIds.length > 0) {
          await markEventsSynced(response.acceptedEventIds)
          await clearSyncedEvents()
        }
      }
      
      const remaining = await getUnsyncedEvents('student-001')
      setPendingEvents(remaining.length)
    } catch (error) {
      console.error('[Sync] Failed to sync events:', error)
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    const handleOnline = () => {
      setOffline(false)
      syncPendingEvents()
    }
    
    const handleOffline = () => {
      setOffline(true)
    }
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [syncPendingEvents])

  useEffect(() => {
    const loadPendingCount = async () => {
      try {
        const unsynced = await getUnsyncedEvents('student-001')
        setPendingEvents(unsynced.length)
      } catch {
        setPendingEvents(0)
      }
    }
    
    loadPendingCount()
    const interval = setInterval(loadPendingCount, 30000)
    
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getClassInsights('class-7a', 'math-fractions-v1')
        if (!cancelled) setClassInsights(data)
      } catch (err) {
        if (!cancelled) setClassInsightsError(err instanceof Error ? err.message : 'Lỗi tải dữ liệu')
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-600 text-white">
                <GraduationCap className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900 leading-tight">PeerStudy</h1>
                <p className="text-xs text-slate-500">Adaptive Tutoring System</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex p-1 bg-slate-100 rounded-xl" role="tablist" aria-label="Chọn vai trò">
                <button
                  onClick={() => setActiveRole('student')}
                  role="tab"
                  aria-selected={activeRole === 'student'}
                  className={`
                    flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all
                    ${activeRole === 'student'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                    }
                  `}
                >
                  <GraduationCap className="w-4 h-4" aria-hidden="true" />
                  Học sinh
                </button>
                <button
                  onClick={() => setActiveRole('teacher')}
                  role="tab"
                  aria-selected={activeRole === 'teacher'}
                  className={`
                    flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all
                    ${activeRole === 'teacher'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                    }
                  `}
                >
                  <LayoutDashboard className="w-4 h-4" aria-hidden="true" />
                  Giáo viên
                </button>
              </div>

              <button
                onClick={syncPendingEvents}
                disabled={syncing || offline}
                className={`
                  flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all
                  ${offline
                    ? 'bg-amber-100 text-amber-700 cursor-not-allowed'
                    : syncing
                      ? 'bg-blue-100 text-blue-700'
                      : pendingEvents > 0
                        ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        : 'bg-emerald-100 text-emerald-700'
                  }
                `}
                aria-label={offline ? 'Đang offline' : syncing ? 'Đang đồng bộ' : `Đồng bộ${pendingEvents > 0 ? ` (${pendingEvents} sự kiện chờ)` : ''}`}
              >
                {offline ? (
                  <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                ) : syncing ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                {offline ? 'Offline' : syncing ? 'Đang đồng bộ' : pendingEvents > 0 ? `${pendingEvents} chờ` : 'Online'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {activeRole === 'teacher' && (
          classInsights ? (
            <TeacherDashboard data={classInsights} />
          ) : classInsightsError ? (
            <div className="text-center py-12 text-slate-500">
              <p>Không thể tải dữ liệu lớp học.</p>
              <p className="text-sm mt-1">{classInsightsError}</p>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500">Đang tải dữ liệu lớp học...</div>
          )
        )}

        {activeRole === 'student' && (
          <StudentView
            studentId="student-001"
            packageId="math-fractions-v1"
            onBack={() => setActiveRole('teacher')}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white mt-8">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 flex items-center justify-between text-xs text-slate-500">
          <span>PeerStudy · Chương trình GDPT 2018</span>
          <span>PWA · Hoạt động offline</span>
        </div>
      </footer>
    </div>
  )
}
