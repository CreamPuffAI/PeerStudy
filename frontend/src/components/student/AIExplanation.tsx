import { useEffect, useState } from 'react'
import { AlertCircle, RefreshCw, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react'
import type { AIExplanationStyle, Explanation, RewriteExplanationResponse } from '../../types/api'
import { ApiError, rewriteExplanation } from '../../lib/api'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

interface AIExplanationProps {
  packageId: string
  skillId: string
  contentId: string
  explanation?: Explanation
}

const styles: { value: AIExplanationStyle; label: string }[] = [
  { value: 'short', label: 'Ngắn gọn' },
  { value: 'step_by_step', label: 'Từng bước' },
  { value: 'visual', label: 'Dễ hình dung' },
]

export function AIExplanation({ packageId, skillId, contentId, explanation }: AIExplanationProps) {
  const [selectedStyle, setSelectedStyle] = useState<AIExplanationStyle>('short')
  const [rewrite, setRewrite] = useState<RewriteExplanationResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    setSelectedStyle('short')
    setRewrite(null)
    setErrorMessage(null)
  }, [packageId, skillId, contentId])

  async function handleRewrite() {
    setLoading(true)
    setErrorMessage(null)

    try {
      const response = await rewriteExplanation({
        packageId,
        skillId,
        contentId,
        style: selectedStyle,
        constraints: { maxSentences: 2, maxWords: 40 },
      })
      setRewrite(response)
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError && error.code === 'OFFLINE'
          ? 'Đang offline. Em có thể thử lại khi có kết nối.'
          : 'Chưa thể tạo giải thích lúc này. Em hãy thử lại nhé.',
      )
    } finally {
      setLoading(false)
    }
  }

  function resetToOriginal() {
    setRewrite(null)
    setErrorMessage(null)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5 text-slate-800 leading-relaxed">
        <div className="mb-3 flex items-center gap-2 font-semibold text-amber-700">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
          Kiến thức cần nhớ
        </div>
        <p className="text-base">{explanation?.content ?? 'Nội dung giải thích chưa có trong gói học tập.'}</p>
      </div>

      <Card className="border-blue-100 bg-blue-50/50" padding="sm">
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-700" aria-hidden="true" />
              <h4 className="font-semibold text-slate-900">Cá nhân hóa bằng AI</h4>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Chọn cách diễn giải phù hợp. AI chỉ viết lại nội dung đã kiểm duyệt.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Kiểu giải thích">
            {styles.map(style => (
              <button
                key={style.value}
                type="button"
                aria-pressed={selectedStyle === style.value}
                disabled={loading}
                onClick={() => {
                  setSelectedStyle(style.value)
                  setRewrite(null)
                  setErrorMessage(null)
                }}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                  selectedStyle === style.value
                    ? 'border-blue-500 bg-blue-100 text-blue-800'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {style.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button onClick={handleRewrite} disabled={loading} className="sm:w-auto">
              {loading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  FPT AI đang tạo giải thích...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Giải thích theo cách khác
                </>
              )}
            </Button>
            {rewrite && (
              <Button onClick={resetToOriginal} variant="ghost" disabled={loading}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Quay về giải thích gốc
              </Button>
            )}
          </div>

          {loading && (
            <p className="text-sm text-blue-800" role="status" aria-live="polite">
              FPT AI đang tạo giải thích...
            </p>
          )}
          {errorMessage && (
            <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-800" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
              <button type="button" className="ml-auto font-semibold underline" onClick={handleRewrite} disabled={loading}>
                Thử lại
              </button>
            </div>
          )}
        </div>
      </Card>

      {rewrite && (
        <div className="animate-fade-in rounded-2xl border border-blue-100 bg-blue-50 p-5 text-slate-800 leading-relaxed" role="status" aria-live="polite">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-blue-900">Cách giải thích khác</h4>
            {rewrite.generated && !rewrite.fallbackUsed && (
              <Badge variant="info" size="sm">
                <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
                Được tạo bởi FPT AI
              </Badge>
            )}
            {rewrite.fallbackUsed && (
              <Badge variant="warning" size="sm">
                <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
                Nội dung xác thực dự phòng
              </Badge>
            )}
          </div>
          <p className="text-base">{rewrite.content}</p>
        </div>
      )}
    </div>
  )
}
