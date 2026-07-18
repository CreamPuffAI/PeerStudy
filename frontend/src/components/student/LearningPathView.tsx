import { useState, useEffect, useRef } from 'react'
import { BookOpen, PenTool, CheckCircle, ArrowRight, RotateCcw, Lightbulb, Eye } from 'lucide-react'
import type { LearningPath, LearningPackage, NextAction, Question, Explanation, WorkedExample } from '../../types/api'
import { ApiError, submitAttempt } from '../../lib/api'
import { getWorkedExampleById } from '../../lib/learning'
import { QuestionCard } from './QuestionCard'
import { Card, CardHeader } from '../ui/Card'
import { Button } from '../ui/Button'
import { ProgressBar } from '../ui/ProgressBar'

interface LearningPathViewProps {
  path: LearningPath
  studentId: string
  packageId: string
  learningPackage: LearningPackage
  onComplete: (nextAction: NextAction) => void
}

export function LearningPathView({ path, studentId, packageId, learningPackage, onComplete }: LearningPathViewProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'neutral' | 'warning' | 'error'; message: string } | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set())
  const attemptEventIdRef = useRef<string | null>(null)

  const answerStartRef = useRef(Date.now())
  const attemptCountsRef = useRef<Record<string, number>>({})
  const advancingRef = useRef(false)

  const currentStep = path.steps[currentStepIndex]
  const progress = ((completedSteps.size) / path.steps.length) * 100

  useEffect(() => {
    answerStartRef.current = Date.now()
  }, [currentStep?.id, currentQuestionIndex])

  useEffect(() => {
    setCurrentQuestionIndex(0)
  }, [currentStepIndex])

  const getQuestionById = (id: string): Question | undefined =>
    learningPackage.questions.find(q => q.id === id)

  const getExplanationById = (id: string): Explanation | undefined =>
    learningPackage.explanations.find(e => e.id === id)

  const getWorkedExample = (id: string): WorkedExample | undefined =>
    getWorkedExampleById(learningPackage, id)

  const activeQuestionId = currentStep.questionIds?.[currentQuestionIndex]
  const activeQuestion = activeQuestionId ? getQuestionById(activeQuestionId) : undefined

  function handleStepComplete() {
    if (advancingRef.current) return
    advancingRef.current = true

    const newCompleted = new Set(completedSteps)
    newCompleted.add(currentStep.id)
    setCompletedSteps(newCompleted)

    if (currentStepIndex < path.steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1)
      setFeedback(null)
      setSubmitted(false)
      attemptEventIdRef.current = null
      setCurrentQuestionIndex(0)
    } else {
      setTimeout(() => onComplete('completed'), 800)
    }
    advancingRef.current = false
  }

  async function handleAnswer(answer: string) {
    if (!activeQuestion || submitted || advancingRef.current) return
    setSubmitted(true)
    setFeedback(null)

    try {
      const responseTimeMs = Date.now() - answerStartRef.current
      const attemptKey = activeQuestion.id
      const currentAttempt = attemptCountsRef.current[attemptKey] ?? 0
      attemptCountsRef.current[attemptKey] = currentAttempt + 1

      const response = await submitAttempt({
        eventId: attemptEventIdRef.current ?? (attemptEventIdRef.current = crypto.randomUUID()),
        studentId,
        classId: 'class-7a',
        packageId,
        questionId: activeQuestion.id,
        purpose: activeQuestion.purpose,
        context: { learningPathId: path.id, learningStepId: currentStep.id },
        answer: { type: activeQuestion.type, value: answer },
        responseTimeMs,
        attemptNumber: currentAttempt + 1,
        deviceTimestamp: new Date().toISOString(),
        offlineCreated: !navigator.onLine,
      })
      attemptEventIdRef.current = null

      const res = response as { correct: boolean; feedback: { type: string; message: string }; next: { action: NextAction } }
      setFeedback({
        type: res.correct ? 'success' : res.feedback.type === 'neutral' ? 'neutral' : 'error',
        message: res.feedback.message
      })

      if (res.correct || currentStep.type === 'practice') {
        const questionCount = currentStep.questionIds?.length ?? 0
        const hasNextQuestion = currentQuestionIndex < questionCount - 1
        setTimeout(() => {
          if (hasNextQuestion) {
            setCurrentQuestionIndex(index => index + 1)
            setFeedback(null)
            setSubmitted(false)
            attemptEventIdRef.current = null
          } else {
            void handleStepComplete()
          }
        }, 1200)
      } else {
        setSubmitted(false)
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'OFFLINE') {
        setFeedback({ type: 'warning', message: error.message })
        return
      }
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Có lỗi xảy ra. Vui lòng thử lại.' })
      setSubmitted(false)
    }
  }

  function getStepIcon(type: string) {
    switch (type) {
      case 'micro_explanation': return <Lightbulb className="w-4 h-4" />
      case 'worked_example': return <Eye className="w-4 h-4" />
      case 'practice': return <PenTool className="w-4 h-4" />
      case 'checkpoint': return <CheckCircle className="w-4 h-4" />
      case 'return_to_target': return <RotateCcw className="w-4 h-4" />
      default: return <BookOpen className="w-4 h-4" />
    }
  }

  function getStepLabel(type: string) {
    switch (type) {
      case 'micro_explanation': return 'Giải thích'
      case 'worked_example': return 'Ví dụ mẫu'
      case 'practice': return 'Luyện tập'
      case 'checkpoint': return 'Kiểm tra'
      case 'return_to_target': return 'Quay lại bài chính'
      default: return type
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`Lộ trình: ${learningPackage.skills.find(s => s.id === path.rootGapSkillId)?.name ?? 'Phục hồi'}`}
          subtitle={`Thời gian dự kiến: ${path.estimatedMinutes} phút`}
        />
        <ProgressBar value={progress} max={100} showLabel color="success" label="Tiến độ" />

        <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
          {path.steps.map((step, idx) => (
            <div
              key={step.id}
              className={`
                flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap
                ${idx === currentStepIndex ? 'bg-blue-100 text-blue-700 border border-blue-200' : ''}
                ${completedSteps.has(step.id) ? 'bg-emerald-100 text-emerald-700' : ''}
                ${idx > currentStepIndex && !completedSteps.has(step.id) ? 'bg-slate-100 text-slate-500' : ''}
              `}
            >
              {getStepIcon(step.type)}
              {getStepLabel(step.type)}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-4">
          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-sm font-bold">
            {currentStepIndex + 1}
          </span>
          <h3 className="text-lg font-semibold text-slate-900">{getStepLabel(currentStep.type)}</h3>
        </div>

        {currentStep.type === 'micro_explanation' && currentStep.contentId && (
          <ExplanationStep
            explanation={getExplanationById(currentStep.contentId)}
            onComplete={handleStepComplete}
          />
        )}

        {currentStep.type === 'worked_example' && currentStep.contentId && (
          <WorkedExampleStep
            example={getWorkedExample(currentStep.contentId)}
            onComplete={handleStepComplete}
          />
        )}

        {(currentStep.type === 'practice' || currentStep.type === 'checkpoint' || currentStep.type === 'return_to_target') && activeQuestion && (
          <div>
            {(currentStep.questionIds?.length ?? 0) > 1 && (
              <p className="mb-4 text-sm text-slate-500">
                Câu {currentQuestionIndex + 1} / {currentStep.questionIds?.length}
              </p>
            )}
            <QuestionCard
              key={activeQuestion.id}
              question={activeQuestion}
              onSubmit={handleAnswer}
              feedback={feedback}
              disabled={submitted}
            />
          </div>
        )}
      </Card>
    </div>
  )
}

function ExplanationStep({ explanation, onComplete }: { explanation?: Explanation; onComplete: () => void }) {
  return (
    <div className="space-y-4">
      <div className="p-5 rounded-2xl bg-amber-50 border border-amber-100 text-slate-800 leading-relaxed">
        <div className="flex items-center gap-2 mb-3 text-amber-700 font-semibold">
          <Lightbulb className="w-5 h-5" />
          Kiến thức cần nhớ
        </div>
        <p className="text-base">{explanation?.content ?? 'Nội dung giải thích'}</p>
      </div>
      <Button onClick={onComplete}>
        Đã hiểu <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  )
}

function WorkedExampleStep({ example, onComplete }: { example?: WorkedExample; onComplete: () => void }) {
  return (
    <div className="space-y-4">
      <div className="p-5 rounded-2xl bg-blue-50 border border-blue-100">
        <div className="flex items-center gap-2 mb-3 text-blue-700 font-semibold">
          <Eye className="w-5 h-5" />
          Ví dụ mẫu
        </div>
        <div className="space-y-3 text-slate-800">
          {example ? (
            <>
              <p className="font-semibold">{example.title}</p>
              <ol className="list-decimal space-y-2 pl-5 text-base leading-relaxed">
                {example.steps.map(step => <li key={step}>{step}</li>)}
              </ol>
            </>
          ) : (
            <p className="text-red-700">Không tìm thấy dữ liệu ví dụ mẫu trong gói học tập.</p>
          )}
        </div>
      </div>
      <Button onClick={onComplete}>
        Đã hiểu <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  )
}
