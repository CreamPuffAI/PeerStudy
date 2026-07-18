import { AlertTriangle, ChevronRight } from 'lucide-react'
import type { PriorityStudent } from '../../types/api'
import { Card, CardHeader } from '../ui/Card'
import { Badge } from '../ui/Badge'

interface PriorityStudentsProps {
  students: PriorityStudent[]
}

export function PriorityStudents({ students }: PriorityStudentsProps) {
  if (students.length === 0) {
    return (
      <Card>
        <CardHeader title="Ưu tiên can thiệp" />
        <p className="text-sm text-slate-500">Không có học sinh cần ưu tiên.</p>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader title="Ưu tiên can thiệp" subtitle="Học sinh cần được hỗ trợ ngay" />
      <div className="space-y-3">
        {students.map((s, idx) => (
          <div
            key={s.studentId}
            className={`
              p-4 rounded-2xl border transition-all hover:shadow-sm
              ${s.priorityLevel === 'high'
                ? 'bg-red-50 border-red-100'
                : s.priorityLevel === 'medium'
                  ? 'bg-amber-50 border-amber-100'
                  : 'bg-blue-50 border-blue-100'
              }
            `}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`
                  w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold
                  ${s.priorityLevel === 'high' ? 'bg-red-200 text-red-700' : ''}
                  ${s.priorityLevel === 'medium' ? 'bg-amber-200 text-amber-700' : ''}
                  ${s.priorityLevel === 'low' ? 'bg-blue-200 text-blue-700' : ''}
                `}>
                  {idx + 1}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-slate-900">{s.studentName}</h4>
                    <Badge variant={s.priorityLevel === 'high' ? 'error' : s.priorityLevel === 'medium' ? 'warning' : 'info'} size="sm">
                      {s.priorityLevel === 'high' ? 'Cao' : s.priorityLevel === 'medium' ? 'Trung bình' : 'Thấp'}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Lỗ hổng: {s.rootGapSkillName} · Điểm ưu tiên: {Math.round(s.priorityScore * 100)}%
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-400 shrink-0 mt-1" />
            </div>

            <div className="mt-3 space-y-1">
              {s.reasons.map((reason, ridx) => (
                <div key={ridx} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0" />
                  <span>{reason}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
