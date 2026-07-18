import { useState } from 'react'
import { LayoutDashboard, BarChart3, Users, AlertCircle, Lightbulb } from 'lucide-react'
import type { ClassInsights } from '../../types/api'
import { ClassOverview } from './ClassOverview'
import { CommonGaps } from './CommonGaps'
import { PriorityStudents } from './PriorityStudents'
import { ReteachSuggestions } from './ReteachSuggestions'

type TabKey = 'overview' | 'gaps' | 'priority' | 'reteach'

interface TeacherDashboardProps {
  data: ClassInsights
}

const tabs: { key: TabKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  { key: 'gaps', label: 'Lỗ hổng', icon: BarChart3 },
  { key: 'priority', label: 'Ưu tiên', icon: AlertCircle },
  { key: 'reteach', label: 'Dạy lại', icon: Lightbulb }
]

export function TeacherDashboard({ data }: TeacherDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl overflow-x-auto" role="tablist" aria-label="Bảng điều khiển giáo viên">
        {tabs.map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              role="tab"
              aria-selected={active}
              aria-controls={`tabpanel-${tab.key}`}
              id={`tab-${tab.key}`}
              className={`
                flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap
                transition-all duration-150
                ${active
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                }
              `}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      <div id="tabpanel-overview" role="tabpanel" aria-labelledby="tab-overview" hidden={activeTab !== 'overview'}>
        {activeTab === 'overview' && <ClassOverview data={data} />}
      </div>
      <div id="tabpanel-gaps" role="tabpanel" aria-labelledby="tab-gaps" hidden={activeTab !== 'gaps'}>
        {activeTab === 'gaps' && <CommonGaps gaps={data.commonGaps} />}
      </div>
      <div id="tabpanel-priority" role="tabpanel" aria-labelledby="tab-priority" hidden={activeTab !== 'priority'}>
        {activeTab === 'priority' && <PriorityStudents students={data.priorityStudents} />}
      </div>
      <div id="tabpanel-reteach" role="tabpanel" aria-labelledby="tab-reteach" hidden={activeTab !== 'reteach'}>
        {activeTab === 'reteach' && <ReteachSuggestions suggestions={data.reteachSuggestions} />}
      </div>
    </div>
  )
}
