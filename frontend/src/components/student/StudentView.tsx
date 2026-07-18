import { useState, useEffect, useCallback, useRef } from 'react'
import { GraduationCap, ArrowLeft, ArrowRight, BookOpen, Target, Trophy, Clock } from 'lucide-react'
import type { NextAction, LearningPackage, LearningPath, Question } from '../../types/api'
import { ApiError, fetchLearningPackage, submitAttempt } from '../../lib/api'
import { QuestionCard } from './QuestionCard'
import { DiagnosticView } from './DiagnosticView'
import { LearningPathView } from './LearningPathView'
import { Card, CardHeader } from '../ui/Card'
import { Button } from '../ui/Button'

interface StudentViewProps {
  studentId: string
  packageId: string
  onBack: () => void
}

export function StudentView({ studentId, packageId, onBack }: StudentViewProps) {
  const [pkg, setPkg] = useState<LearningPackage | null>(null)
  const [loading, setLoading] = useState(true)
  const [packageError, setPackageError] = useState<string | null>(null)
  const [screen, setScreen] = useState<'menu' | 'practice' | 'diagnostic' | 'learning' | 'completed'>('menu')
  const [questionId, setQuestionId] = useState('Q_E01_001')
  const [diagnosisSessionId, setDiagnosisSessionId] = useState<string | null>(null)
  const [learningPathId, setLearningPathId] = useState<string | null>(null)
  const [learningPathData, setLearningPathData] = useState<LearningPath | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'neutral' | 'warning' | 'error'; message: string } | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [nextQuestionId, setNextQuestionId] = useState<string | null>(null)
  const attemptEventIdRef = useRef<string | null>(null)

  const loadPackage = useCallback(async () => {
    setLoading(true)
    setPackageError(null)
    try {
      const data = await fetchLearningPackage(packageId)
      setPkg(data)
    } catch (error) {
      setPkg(null)
      setPackageError(error instanceof Error ? error.message : 'Không thể tải gói học tập.')
    } finally {
      setLoading(false)
    }
  }, [packageId])

  const answerStartRef = useRef(Date.now())
  const attemptCountsRef = useRef<Record<string, number>>({})

  useEffect(() => {
    answerStartRef.current = Date.now()
  }, [questionId])

  useEffect(() => {
    if (screen === 'practice') {
      answerStartRef.current = Date.now()
    }
  }, [screen])

  useEffect(() => {
    void loadPackage()
  }, [loadPackage])

  const getQuestionById = useCallback((id: string): Question | undefined => {
    return pkg?.questions.find(q => q.id === id)
  }, [pkg])

  const question = pkg ? getQuestionById(questionId) : undefined

  async function handleAnswer(answer: string) {
    if (!question || submitted) return
    setSubmitted(true)
    setFeedback(null)

    try {
      const responseTimeMs = Date.now() - answerStartRef.current
      const attemptKey = question.id
      const currentAttempt = attemptCountsRef.current[attemptKey] ?? 0
      attemptCountsRef.current[attemptKey] = currentAttempt + 1

      const response = await submitAttempt({
        eventId: attemptEventIdRef.current ?? (attemptEventIdRef.current = crypto.randomUUID()),
        studentId,
        classId: 'class-7a',
        packageId,
        questionId: question.id,
        purpose: question.purpose,
        context: {},
        answer: { type: question.type, value: answer },
        responseTimeMs,
        attemptNumber: currentAttempt + 1,
        deviceTimestamp: new Date().toISOString(),
        offlineCreated: !navigator.onLine
      })
      attemptEventIdRef.current = null

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
        const lpid = res.next.learningPathId ?? pkg?.learningPaths?.[0]?.id
        setLearningPathId(lpid ?? null)
        setTimeout(() => setScreen('learning'), 1200)
      } else if (res.next.action === 'continue_practice' && res.next.questionId) {
        setNextQuestionId(res.next.questionId)
      } else if (res.next.action === 'completed') {
        setTimeout(() => setScreen('completed'), 1200)
      } else if (res.next.action === 'return_to_target' && res.next.questionId) {
        setNextQuestionId(res.next.questionId)
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'OFFLINE') {
        setFeedback({ type: 'warning', message: error.message })
        return
      }
      attemptEventIdRef.current = null
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Có lỗi xảy ra. Vui lòng thử lại.' })
      setSubmitted(false)
    }
  }

  function handleNextQuestion() {
    if (!nextQuestionId) return
    setQuestionId(nextQuestionId)
    attemptEventIdRef.current = null
    setNextQuestionId(null)
    setSubmitted(false)
    setFeedback(null)
  }

  function handleDiagnosticComplete(nextAction: NextAction, lpid?: string, lp?: LearningPath) {
    if (nextAction === 'start_learning_path' && lpid) {
      setLearningPathId(lpid)
      setLearningPathData(lp ?? null)
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

  if (loading) {
    return (
      <div className="text-center py-12 text-slate-500">Đang tải gói học tập...</div>
    )
  }

  if (!pkg) {
    return (
      <div className="text-center py-12 text-slate-500" role="alert">
        <p>Không thể tải gói học tập.</p>
        {packageError && <p className="text-sm mt-1 text-red-700">{packageError}</p>}
        <Button onClick={() => void loadPackage()} variant="secondary" className="mt-4">
          Thử lại
        </Button>
      </div>
    )
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

      {screen === 'menu' && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-4 mb-6">
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-100 text-blue-700">
                <BookOpen className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Phương trình chứa phân số</h3>
                <p className="text-sm text-slate-500">Toán 7 · Kỹ năng E01</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 mb-6">
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-100 text-blue-600">
                  <Target className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Kỹ năng</p>
                  <p className="text-sm font-semibold text-slate-900">E01</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-100 text-amber-600">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Thời gian</p>
                  <p className="text-sm font-semibold text-slate-900">~10 phút</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600">
                  <Trophy className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Số câu</p>
                  <p className="text-sm font-semibold text-slate-900">4 câu</p>
                </div>
              </div>
            </div>

            <Button
              onClick={() => setScreen('practice')}
              size="lg"
              className="w-full"
            >
              Bắt đầu luyện tập
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Card>

          <Card padding="sm">
            <CardHeader title="Mục tiêu bài học" />
            <p className="text-sm text-slate-600 leading-relaxed">
              Giải phương trình chứa phân số bằng cách tìm giá trị của ẩn x.
              Hệ thống sẽ tự động phát hiện lỗ hổng kiến thức và tạo lộ trình phù hợp nếu em gặp khó khăn.
            </p>
          </Card>
        </div>
      )}

      {screen === 'practice' && question && (
        <Card>
          <QuestionCard
            key={question.id}
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
          path={learningPathData}
          studentId={studentId}
          packageId={packageId}
          learningPackage={pkg}
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
            setScreen('menu')
            setQuestionId('Q_E01_001')
            setSubmitted(false)
            setFeedback(null)
            setNextQuestionId(null)
            setDiagnosisSessionId(null)
            setLearningPathId(null)
            setLearningPathData(null)
          }}>
            Về menu chính
          </Button>
        </Card>
      )}
    </div>
  )
}

function LearningPathWrapper({ pathId, path, studentId, packageId, learningPackage, onComplete }: {
  pathId: string
  path?: LearningPath | null
  studentId: string
  packageId: string
  learningPackage: LearningPackage
  onComplete: () => void
}) {
  const resolvedPath = path ?? learningPackage.learningPaths?.find(p => p.id === pathId)
  if (!resolvedPath) return <Card><p>Không tìm thấy lộ trình.</p></Card>
  return (
    <LearningPathView
      path={resolvedPath}
      studentId={studentId}
      packageId={packageId}
      learningPackage={learningPackage}
      onComplete={onComplete}
    />
  )
}
