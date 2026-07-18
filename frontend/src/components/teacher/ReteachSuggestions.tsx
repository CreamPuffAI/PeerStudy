import { Lightbulb, Clock, ListChecks, ChevronRight } from 'lucide-react'
import type { ReteachSuggestion } from '../../types/api'
import { Card, CardHeader } from '../ui/Card'
import { Button } from '../ui/Button'

interface ReteachSuggestionsProps {
  suggestions: ReteachSuggestion[]
  onStartReteach?: (skillId: string) => void
}

export function ReteachSuggestions({ suggestions, onStartReteach }: ReteachSuggestionsProps) {
  if (suggestions.length === 0) {
    return (
      <Card>
        <CardHeader title="Gợi ý dạy lại" />
        <p className="text-sm text-slate-500">Không có gợi ý nào.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {suggestions.map((s, idx) => (
        <Card key={s.skillId}>
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-100 text-amber-700 shrink-0">
              <span className="text-sm font-bold">{idx + 1}</span>
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-slate-900">{s.title}</h4>
              <p className="text-sm text-slate-600 mt-1">{s.reason}</p>

              <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
                <div className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {s.estimatedMinutes} phút
                </div>
                <div className="flex items-center gap-1">
                  <ListChecks className="w-4 h-4" />
                  {s.activities.length} hoạt động
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {s.activities.map((act, aidx) => (
                  <div key={aidx} className="flex items-start gap-2 text-sm text-slate-700 p-2 rounded-xl bg-slate-50">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-white text-xs font-medium text-slate-600 border border-slate-200 shrink-0">
                      {aidx + 1}
                    </span>
                    <span>{act}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <Button 
                  variant="secondary" 
                  size="sm"
                  onClick={() => onStartReteach?.(s.skillId)}
                >
                  <Lightbulb className="w-4 h-4" />
                  Bắt đầu dạy lại
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
