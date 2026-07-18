import { useState } from 'react'
import { AlertCircle, CheckCircle, Lightbulb, RefreshCw, ShieldCheck, Sparkles, WifiOff } from 'lucide-react'
import type { GenerateDiagnosisHintResponse } from '../../types/api'
import { ApiError, generateDiagnosisHint, getOfflineDiagnosisHint, isOffline } from '../../lib/api'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

interface DiagnosisHintProps {
  packageId: string
  diagnosisSessionId: string
  skillId: string
}

type HintState = 'idle' | 'loading' | 'success' | 'error'

export function DiagnosisHint({ packageId, diagnosisSessionId, skillId }: DiagnosisHintProps) {
  const [state, setState] = useState<HintState>('idle')
  const [hint, setHint] = useState<GenerateDiagnosisHintResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)

  async function requestHint() {
    setState('loading')
    setErrorMessage(null)
    setOffline(false)

    if (isOffline()) {
      const fallbackMessage = await getOfflineDiagnosisHint(packageId, skillId)
      if (fallbackMessage) {
        setHint({
          id: `OFFLINE_HINT_${diagnosisSessionId}`,
          skillId,
          sourceContentId: diagnosisSessionId,
          style: 'short',
          message: fallbackMessage,
          generated: false,
          fallbackUsed: true,
        })
        setOffline(true)
        setState('success')
      } else {
        setErrorMessage('Đang offline và chưa có gợi ý xác thực trong bộ nhớ thiết bị.')
        setState('error')
      }
      return
    }

    try {
      const response = await generateDiagnosisHint({
        packageId,
        diagnosisSessionId,
        style: 'short',
        constraints: { maxSentences: 2, maxWords: 30 },
      })
      setHint(response)
      setState('success')
    } catch (error) {
      if (error instanceof ApiError && error.code === 'OFFLINE') {
        const fallbackMessage = await getOfflineDiagnosisHint(packageId, skillId)
        if (fallbackMessage) {
          setHint({
            id: `OFFLINE_HINT_${diagnosisSessionId}`,
            skillId,
            sourceContentId: diagnosisSessionId,
            style: 'short',
            message: fallbackMessage,
            generated: false,
            fallbackUsed: true,
          })
          setOffline(true)
          setState('success')
          return
        }
      }
      setErrorMessage(error instanceof Error ? error.message : 'Không thể tạo gợi ý lúc này.')
      setState('error')
    }
  }

  if (state === 'idle') {
    return (
      <Card className="border-blue-100 bg-blue-50/50" aria-labelledby="ai-hint-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h3 id="ai-hint-title" className="font-semibold text-slate-900">Muốn xem một gợi ý ngắn?</h3>
              <p className="mt-1 text-sm text-slate-600">Gợi ý chỉ diễn giải kết quả chẩn đoán, không thay đổi kết quả học tập của em.</p>
            </div>
          </div>
          <Button onClick={requestHint} variant="secondary" className="shrink-0">
            Nhận gợi ý AI
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </Card>
    )
  }

  if (state === 'loading') {
    return (
      <Card className="border-blue-100 bg-blue-50/50" role="status" aria-live="polite">
        <div className="flex items-center gap-3 text-blue-800">
          <RefreshCw className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span>Đang tạo gợi ý...</span>
        </div>
      </Card>
    )
  }

  if (state === 'error') {
    return (
      <Card className="border-red-100 bg-red-50" role="alert">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-semibold text-red-900">Chưa thể lấy gợi ý</p>
            <p className="mt-1 text-sm text-red-800">{errorMessage}</p>
            <Button onClick={requestHint} variant="secondary" size="sm" className="mt-3">
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Thử lại
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  if (!hint) return null

  return (
    <Card className="border-emerald-100 bg-emerald-50" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        {offline ? (
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
        ) : hint.generated ? (
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
        ) : (
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
        )}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">Gợi ý cho em</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-xs font-medium text-slate-700">
              {hint.generated ? <Sparkles className="h-3 w-3" aria-hidden="true" /> : <ShieldCheck className="h-3 w-3" aria-hidden="true" />}
              {hint.generated ? 'Gợi ý được tạo bởi AI' : 'Gợi ý xác thực có sẵn'}
            </span>
          </div>
          <p className="mt-2 leading-relaxed text-slate-800">{hint.message}</p>
          {offline && <p className="mt-2 flex items-center gap-1 text-xs text-amber-800"><CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> Đang dùng nội dung đã lưu trên thiết bị.</p>}
        </div>
      </div>
    </Card>
  )
}
