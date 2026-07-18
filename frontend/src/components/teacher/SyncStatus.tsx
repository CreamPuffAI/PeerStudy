import { Wifi, WifiOff, RefreshCw } from 'lucide-react'
import type { ClassInsights } from '../../types/api'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'

interface SyncStatusProps {
  data: ClassInsights['syncStatus']
  className?: string
  onSync?: () => void
}

export function SyncStatus({ data, className = '', onSync }: SyncStatusProps) {
  const allOnline = data.offlineStudents === 0

  return (
    <Card className={className}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`
            w-10 h-10 rounded-full flex items-center justify-center
            ${allOnline ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}
          `}>
            {allOnline ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
          </div>
          <div>
            <h4 className="font-semibold text-slate-900">
              {allOnline ? 'Tất cả học sinh đã đồng bộ' : `${data.offlineStudents} học sinh offline`}
            </h4>
            <p className="text-xs text-slate-500">
              {data.syncedStudents} / {data.syncedStudents + data.offlineStudents} đã đồng bộ
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onSync}>
          <RefreshCw className="w-4 h-4" />
          Đồng bộ
        </Button>
      </div>
    </Card>
  )
}
