import { AlertTriangle, ArrowRight, GraduationCap } from 'lucide-react'
import type { CommonGap } from '../../types/api'
import { Card, CardHeader } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { ProgressBar } from '../ui/ProgressBar'

interface CommonGapsProps {
  gaps: CommonGap[]
}

export function CommonGaps({ gaps }: CommonGapsProps) {
  if (gaps.length === 0) {
    return (
      <Card>
        <CardHeader title="Lỗ hổng chung" />
        <p className="text-sm text-slate-500">Không phát hiện lỗ hổng nào.</p>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader title="Lỗ hổng kiến thức chung" subtitle="Các lỗ hổng ảnh hưởng nhiều học sinh nhất" />
      <div className="space-y-4">
        {gaps.map((gap, idx) => (
          <div
            key={gap.skillId}
            className={`
              p-4 rounded-2xl border transition-all hover:shadow-sm
              ${gap.severity === 'high' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}
            `}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-white text-xs font-bold text-slate-700 border border-slate-200">
                  {idx + 1}
                </span>
                <div>
                  <h4 className="font-semibold text-slate-900">{gap.skillName}</h4>
                  <p className="text-xs text-slate-500">Lớp {gap.grade} · Ảnh hưởng {gap.affectedSkills.length} kỹ năng sau</p>
                </div>
              </div>
              <Badge variant={gap.severity === 'high' ? 'error' : 'warning'} size="sm">
                {gap.severity === 'high' ? 'Nghiêm trọng' : 'Trung bình'}
              </Badge>
            </div>

            <div className="mt-3">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-600">{gap.studentCount} học sinh</span>
                <span className="font-medium text-slate-900">{Math.round(gap.percentage * 100)}%</span>
              </div>
              <ProgressBar
                value={gap.percentage * 100}
                max={100}
                size="sm"
                color={gap.severity === 'high' ? 'danger' : 'warning'}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {gap.affectedSkills.map(skillId => (
                <span key={skillId} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600">
                  <ArrowRight className="w-3 h-3" />
                  {skillId}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
