import { Users, Wifi, WifiOff, TrendingUp, AlertTriangle, Trophy } from 'lucide-react'
import type { ClassInsights } from '../../types/api'
import { Card, CardHeader } from '../ui/Card'
import { Badge } from '../ui/Badge'

interface ClassOverviewProps {
  data: ClassInsights
}

export function ClassOverview({ data }: ClassOverviewProps) {
  const { summary, syncStatus, class: cls } = data

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card padding="md" className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-red-50 rounded-bl-full" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-xs font-medium text-slate-500">Cần hỗ trợ</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">{summary.studentsNeedSupport}</div>
            <div className="text-xs text-slate-500">/ {cls.studentCount} học sinh</div>
          </div>
        </Card>

        <Card padding="md" className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-blue-50 rounded-bl-full" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-medium text-slate-500">Đúng tiến độ</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">{summary.studentsOnTrack}</div>
            <div className="text-xs text-slate-500">/ {cls.studentCount} học sinh</div>
          </div>
        </Card>

        <Card padding="md" className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-50 rounded-bl-full" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-medium text-slate-500">Vượt trội</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">{summary.studentsReadyForAdvanced}</div>
            <div className="text-xs text-slate-500">/ {cls.studentCount} học sinh</div>
          </div>
        </Card>

        <Card padding="md" className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-amber-50 rounded-bl-full" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              {syncStatus.offlineStudents > 0 ? (
                <WifiOff className="w-4 h-4 text-amber-500" />
              ) : (
                <Wifi className="w-4 h-4 text-emerald-500" />
              )}
              <span className="text-xs font-medium text-slate-500">Đồng bộ</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">{syncStatus.syncedStudents}</div>
            <div className="text-xs text-slate-500">
              {syncStatus.offlineStudents > 0 ? `${syncStatus.offlineStudents} offline` : 'Tất cả online'}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title={`${cls.name} · Tổng quan`} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-slate-50">
            <p className="text-sm text-slate-500 mb-1">Điểm trung bình trước</p>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-slate-900">{Math.round(summary.averagePreTestScore * 100)}%</span>
              <Badge variant="warning" size="sm">Trước</Badge>
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-slate-50">
            <p className="text-sm text-slate-500 mb-1">Điểm trung bình sau</p>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-slate-900">{Math.round(summary.averagePostTestScore * 100)}%</span>
              <Badge variant="success" size="sm">Sau</Badge>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
