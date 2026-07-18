import { useState, useEffect } from 'react'
import { Brain, ChevronRight, TrendingUp, AlertTriangle, ArrowRight } from 'lucide-react'
import type { DiagnosisSession, AttemptResponse, NextAction } from '../../types/api'
import { getDiagnosisSession, submitAttempt } from '../../lib/api'
import { QuestionCard } from './QuestionCard'
import { Card, CardHeader } from '../ui/Card'
import { Button } from '../ui/Button'
import { ProgressBar } from '../ui/ProgressBar'

interface DiagnosticViewProps {
  sessionId: string
  studentId: string
  packageId: string
  onComplete: (nextAction: NextAction, learningPathId?: string) => void
}

export function DiagnosticView({ sessionId, studentId, packageId, onComplete }: DiagnosticViewProps) {
  const [session, setSession] = useState<DiagnosisSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'neutral' | 'error'; message: string } | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [showNextButton, setShowNextButton] = useState(false)
  const [nextAction, setNextAction] = useState<{ action: NextAction; learningPathId?: string } | null>(null)

  useEffect(() => {
    loadSession()
  }, [sessionId])

  async function loadSession() {
    setLoading(true)
    try {
      const s = await getDiagnosisSession(sessionId)
      setSession(s)
    } catch {
      setFeedback({ type: 'error', message: 'Không thể tải phiên chẩn đoán.' })
    }
    setLoading(false)
  }

  async function handleAnswer(answer: string) {
    if (!session?.nextQuestion || submitted) return
    setSubmitted(true)
    setFeedback(null)
    setShowNextButton(false)

    try {
      const response = await submitAttempt({
        eventId: crypto.randomUUID(),
        studentId,
        classId: 'class-7a',
        packageId,
        questionId: session.nextQuestion.id,
        purpose: session.nextQuestion.purpose,
        context: { diagnosisSessionId: session.id },
        answer: { type: session.nextQuestion.type, value: answer },
        responseTimeMs: 4200,
        attemptNumber: 1,
        deviceTimestamp: new Date().toISOString(),
        offlineCreated: !navigator.onLine
      })

      const res = response as AttemptResponse
      if (res.correct) {
        setFeedback({ type: 'success', message: res.feedback.message })
      } else {
        setFeedback({ type: 'neutral', message: res.feedback.message })
      }

      if (res.next.action === 'continue_diagnostic' && res.next.questionId) {
        setNextAction({ action: 'continue_diagnostic' })
        setShowNextButton(true)
      } else if (res.next.action === 'start_learning_path' || res.next.action === 'continue_practice' || res.next.action === 'completed') {
        const completed = await getDiagnosisSession(sessionId)
        setSession(completed)
        setNextAction({ action: res.next.action, learningPathId: res.next.learningPathId ?? completed.learningPath?.id })
        setShowNextButton(true)
      } else {
        setNextAction({ action: res.next.action, learningPathId: res.next.learningPathId })
        setShowNextButton(true)
      }
    } catch {
      setFeedback({ type: 'error', message: 'Có lỗi xảy ra. Vui lòng thử lại.' })
      setSubmitted(false)
    }
  }

  async function handleNextQuestion() {
    if (!nextAction) return

    if (nextAction.action === 'continue_diagnostic') {
      const updated = await getDiagnosisSession(sessionId)
      setSession(updated)
      setSubmitted(false)
      setFeedback(null)
      setShowNextButton(false)
      setNextAction(null)
    } else {
      onComplete(nextAction.action, nextAction.learningPathId)
    }
  }

  if (loading) {
    return (
      <Card className="flex items-center justify-center py-16" role="status" aria-live="polite">
        <div className="flex items-center gap-3 text-slate-500">
          <Brain className="w-6 h-6 animate-pulse" aria-hidden="true" />
          <span>Đang tải phiên chẩn đoán...</span>
        </div>
      </Card>
    )
  }

  if (!session) {
    return (
      <Card role="alert">
        <CardHeader title="Không tìm thấy phiên chẩn đoán" />
        <Button onClick={() => onComplete('continue_practice')}>Quay lại</Button>
      </Card>
    )
  }

  if (session.status === 'completed' && session.diagnosis) {
    const rootGap = session.diagnosis.rootGap
    return (
      <Card>
        <CardHeader title="Kết quả chẩn đoán" subtitle="Hệ thống đã phân tích xong" />

        <div className="space-y-4">
          <div className={`
            p-4 rounded-2xl border
            ${session.diagnosis.classification === 'knowledge_gap' ? 'bg-amber-50 border-amber-100' : 'bg-blue-50 border-blue-100'}
          `}>
            <div className="flex items-center gap-2 mb-2">
              {session.diagnosis.classification === 'knowledge_gap' ? (
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              ) : (
                <TrendingUp className="w-5 h-5 text-blue-600" />
              )}
              <span className="font-semibold text-slate-900">
                {session.diagnosis.classification === 'knowledge_gap' ? 'Phát hiện lỗ hổng kiến thức' : 'Lỗi bất cẩn'}
              </span>
            </div>
            {rootGap && (
              <div className="text-sm text-slate-700">
                <p><strong>Kỹ năng gốc cần củng cố:</strong> {rootGap.name} (Lớp {rootGap.grade})</p>
                <p className="mt-1">Độ tin cậy: {Math.round(session.diagnosis.confidence * 100)}%</p>
              </div>
            )}
          </div>

          {session.learningPath && (
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
              <div className="flex items-center gap-2 text-emerald-800 font-medium mb-1">
                <ChevronRight className="w-5 h-5" />
                Đã tạo lộ trình phục hồi
              </div>
              <p className="text-sm text-emerald-700">
                Thời gian dự kiến: {session.learningPath.estimatedMinutes} phút
              </p>
            </div>
          )}

          <Button onClick={() => onComplete(session.next?.action ?? 'start_learning_path', session.learningPath?.id)}>
            Tiếp tục
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Chẩn đoán kiến thức"
          subtitle={`Câu ${(session.answeredCount ?? 0) + 1} / ${session.maxQuestions}`}
        />
        <ProgressBar
          value={session.answeredCount ?? 0}
          max={session.maxQuestions}
          size="sm"
          color="primary"
          showLabel={false}
        />

        {session.candidates && session.candidates.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium text-slate-700">Các kỹ năng đang điều tra:</p>
            {session.candidates.map(c => (
              <div key={c.skillId} className="flex items-center justify-between text-sm p-2 rounded-xl bg-slate-50">
                <span className="text-slate-700">{c.name}</span>
                <span className="font-medium text-slate-900">{Math.round(c.score * 100)}%</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {session.nextQuestion && (
        <Card>
          <QuestionCard
            question={session.nextQuestion}
            onSubmit={handleAnswer}
            feedback={feedback}
            disabled={submitted}
          />
          
          {showNextButton && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <Button 
                onClick={handleNextQuestion}
                className="w-full"
                size="lg"
              >
                {nextAction?.action === 'continue_diagnostic' ? (
                  <>
                    Câu tiếp theo
                    <ArrowRight className="w-4 h-4" />
                  </>
                ) : nextAction?.action === 'start_learning_path' ? (
                  <>
                    Xem lộ trình phục hồi
                    <ChevronRight className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    Tiếp tục
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
