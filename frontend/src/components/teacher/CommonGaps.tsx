import { AlertTriangle, ArrowRight, GraduationCap } from 'lucide-react'
import type { CommonGap } from '../../types/api'
import { Card, CardHeader } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { ProgressBar } from '../ui/ProgressBar'
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'

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

  const gapChartData = gaps.map((gap) => ({
    skillName: gap.skillName,
    percentage: gap.percentage * 100,
    studentCount: gap.studentCount,
    severity: gap.severity
  }))

  return (
    <Card>
      <CardHeader title="Lỗ hổng kiến thức chung" subtitle="Các lỗ hổng ảnh hưởng nhiều học sinh nhất" />

      <div className="mb-6">
        <p className="text-sm font-medium text-slate-700 mb-3">Tỷ lệ học sinh gặp lỗ hổng</p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={gapChartData}
              margin={{ top: 10, right: 20, left: 20, bottom: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                tickLine={false}
                axisLine={false}
                fontSize={12}
              />
              <YAxis
                type="category"
                dataKey="skillName"
                width={160}
                tickLine={false}
                axisLine={false}
                fontSize={12}
                interval={0}
              />
              <Tooltip
                cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                formatter={(value, _name, props) => {
                  const payload = props.payload as typeof gapChartData[number]
                  return [`${Math.round(value as number)}% (${payload.studentCount} học sinh)`, 'Tỷ lệ']
                }}
              />
              <Bar dataKey="percentage" radius={[0, 8, 8, 0]} maxBarSize={40}>
                {gapChartData.map((gap, index) => (
                  <Cell key={`gap-bar-${index}`} fill={gap.severity === 'high' ? '#ef4444' : '#f59e0b'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

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
