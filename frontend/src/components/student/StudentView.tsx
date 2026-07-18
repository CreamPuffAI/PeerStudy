import { useState } from 'react'
import { GraduationCap, ArrowLeft, ArrowRight } from 'lucide-react'
import type { NextAction } from '../../types/api'
import { getQuestionById, demoLearningPaths } from '../../lib/mockData'
import { submitAttempt } from '../../lib/api'
import { QuestionCard } from './QuestionCard'
import { DiagnosticView } from './DiagnosticView'
import { LearningPathView } from './LearningPathView'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'

interface StudentViewProps {
  studentId: string
  packageId: string
  onBack: () => void
}

export function StudentView({ studentId, packageId, onBack }: StudentViewProps) {
  const [screen, setScreen] = useState<'practice' | 'diagnostic' | 'learning' | 'completed'>('practice')
  const [questionId, setQuestionId] = useState('Q_E01_001')
  const [diagnosisSessionId, setDiagnosisSessionId] = useState<string | null>(null)
  const [learningPathId, setLearningPathId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'neutral' | 'error'; message: string } | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [nextQuestionId, setNextQuestionId] = useState<string | null>(null)

  const question = getQuestionById(questionId)

  async function handleAnswer(answer: string) {
    if (!question || submitted) return
    setSubmitted(true)
    setFeedback(null)

    try {
      const response = await submitAttempt({
        eventId: crypto.randomUUID(),
        studentId,
        classId: 'class-7a',
        packageId,
        questionId: question.id,
        purpose: question.purpose,
        context: {},
        answer: { type: question.type, value: answer },
        responseTimeMs: 4200,
        attemptNumber: 1,
        deviceTimestamp: new Date().toISOString(),
        offlineCreated: !navigator.onLine
      })

      const res = response as {
        correct: boolean
        feedback: { type: string; message: string }
        next: { action: NextAction; questionId?: string; diagnosisSessionId?: string; learningPathId?: string }
        diagnosisSession?: { id: string }
      }

      setFeedback({
        type: res.correct ? 'success' : res.feedback.type === 'neutral' ? 'neutral' : 'error',
        message: res.feedback.message
      })

      if (res.next.action === 'continue_diagnostic') {
        const dsid = res.diagnosisSession?.id ?? res.next.diagnosisSessionId ?? `diag-${Date.now()}`
        setDiagnosisSessionId(dsid)
        setTimeout(() => setScreen('diagnostic'), 1200)
      } else if (res.next.action === 'start_learning_path') {
        const lpid = res.next.learningPathId ?? demoLearningPaths[0]?.id
        setLearningPathId(lpid ?? null)
        setTimeout(() => setScreen('learning'), 1200)
      } else if (res.next.action === 'continue_practice' && res.next.questionId) {
        setNextQuestionId(res.next.questionId)
      } else if (res.next.action === 'completed') {
        setTimeout(() => setScreen('completed'), 1200)
      } else if (res.next.action === 'return_to_target') {
        setNextQuestionId('Q_E01_RETRY_001')
      }
    } catch {
      setFeedback({ type: 'error', message: 'Có lỗi xảy ra. Vui lòng thử lại.' })
      setSubmitted(false)
    }
  }

  function handleNextQuestion() {
    if (!nextQuestionId) return
    setQuestionId(nextQuestionId)
    setNextQuestionId(null)
    setSubmitted(false)
    setFeedback(null)
  }

  function handleDiagnosticComplete(nextAction: NextAction, lpid?: string) {
    if (nextAction === 'start_learning_path' && lpid) {
      setLearningPathId(lpid)
      setScreen('learning')
    } else if (nextAction === 'continue_practice') {
      setScreen('practice')
      setSubmitted(false)
      setFeedback(null)
    } else {
      setScreen('completed')
    }
  }

  function handleLearningComplete() {
    setScreen('completed')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Quay lại
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-100 text-blue-700">
          <GraduationCap className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Học sinh: Minh</h2>
          <p className="text-sm text-slate-500">Lớp 7A · Bài: Phương trình chứa phân số</p>
        </div>
      </div>

      {screen === 'practice' && question && (
        <Card>
          <QuestionCard
            question={question}
            onSubmit={handleAnswer}
            feedback={feedback}
            disabled={submitted}
          />
          {nextQuestionId && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <Button
                onClick={handleNextQuestion}
                size="lg"
                className="w-full flex items-center justify-center gap-2"
              >
                Câu tiếp theo
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </Card>
      )}

      {screen === 'diagnostic' && diagnosisSessionId && (
        <DiagnosticView
          sessionId={diagnosisSessionId}
          studentId={studentId}
          packageId={packageId}
          onComplete={handleDiagnosticComplete}
        />
      )}

      {screen === 'learning' && learningPathId && (
        <LearningPathWrapper
          pathId={learningPathId}
          studentId={studentId}
          packageId={packageId}
          onComplete={handleLearningComplete}
        />
      )}

      {screen === 'completed' && (
        <Card className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
            <GraduationCap className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">Hoàn thành!</h3>
          <p className="text-slate-600 mb-6">Em đã hoàn thành lộ trình phục hồi kiến thức.</p>
          <Button onClick={() => {
            setScreen('practice')
            setQuestionId('Q_E01_RETRY_001')
            setSubmitted(false)
            setFeedback(null)
          }}>
            Làm bài tiếp theo
          </Button>
        </Card>
      )}
    </div>
  )
}

function LearningPathWrapper({ pathId, studentId, packageId, onComplete }: {
  pathId: string
  studentId: string
  packageId: string
  onComplete: () => void
}) {
  const path = demoLearningPaths.find(p => p.id === pathId)
  if (!path) return <Card><p>Không tìm thấy lộ trình.</p></Card>
  return (
    <LearningPathView
      path={path}
      studentId={studentId}
      packageId={packageId}
      onComplete={onComplete}
    />
  )
}
