import { useState } from 'react'
import { CheckCircle, XCircle, HelpCircle } from 'lucide-react'
import type { Question, FeedbackType } from '../../types/api'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'

interface QuestionCardProps {
  question: Question
  onSubmit: (answer: string) => void
  feedback?: { type: FeedbackType; message: string } | null
  disabled?: boolean
}

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

export function QuestionCard({ question, onSubmit, feedback, disabled }: QuestionCardProps) {
  const [answer, setAnswer] = useState('')

  const handleSubmit = () => {
    if (!answer.trim() || disabled) return
    onSubmit(answer.trim())
    setAnswer('')
  }

  const isMultipleChoice = question.type === 'multiple_choice'

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Badge variant="info" size="sm">
          {question.purpose === 'target' && 'Bài chính'}
          {question.purpose === 'diagnostic' && 'Chẩn đoán'}
          {question.purpose === 'practice' && 'Luyện tập'}
          {question.purpose === 'checkpoint' && 'Kiểm tra'}
        </Badge>
        <span className="text-xs text-slate-400 mt-0.5">{question.skillId}</span>
      </div>

      <div className="text-lg font-medium text-slate-900 leading-relaxed">
        {question.prompt}
      </div>

      {isMultipleChoice && question.options && (
        <div className="grid gap-3" role="radiogroup" aria-label="Chọn câu trả lời">
          {question.options.map(opt => {
            const selected = answer === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => setAnswer(opt.id)}
                disabled={disabled}
                role="radio"
                aria-checked={selected}
                className={cn(
                  'flex items-center gap-3 p-4 rounded-2xl border text-left transition-all duration-150',
                  selected && 'border-blue-500 bg-blue-50 text-blue-900',
                  !selected && 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                  disabled && 'opacity-50 cursor-not-allowed'
                )}
              >
                <span className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold shrink-0',
                  selected && 'bg-blue-600 text-white',
                  !selected && 'bg-slate-100 text-slate-600'
                )}>
                  {opt.id}
                </span>
                <span className="font-medium">{opt.text}</span>
              </button>
            )
          })}
        </div>
      )}

      {!isMultipleChoice && (
        <div>
          <label htmlFor="numeric-answer" className="sr-only">Nhập câu trả lời</label>
          <input
            id="numeric-answer"
            type="text"
            inputMode="numeric"
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            disabled={disabled}
            placeholder="Nhập câu trả lời của em..."
            aria-label="Nhập câu trả lời"
            className="w-full p-4 rounded-2xl border border-slate-200 bg-white text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none placeholder:text-slate-400 transition-all"
          />
        </div>
      )}

      <Button
        onClick={handleSubmit}
        disabled={!answer.trim() || disabled}
        size="lg"
        className="w-full"
      >
        Nộp đáp án
      </Button>

      {feedback && (
        <div 
          role="alert"
          aria-live="polite"
          className={cn(
            'flex items-start gap-3 p-4 rounded-2xl text-sm',
            feedback.type === 'success' && 'bg-emerald-50 text-emerald-800 border border-emerald-100',
            feedback.type === 'neutral' && 'bg-slate-50 text-slate-700 border border-slate-100',
            feedback.type === 'warning' && 'bg-amber-50 text-amber-800 border border-amber-100',
            feedback.type === 'error' && 'bg-red-50 text-red-800 border border-red-100'
          )}
        >
          {feedback.type === 'success' && <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />}
          {feedback.type === 'error' && <XCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />}
          {(feedback.type === 'neutral' || feedback.type === 'warning') && <HelpCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />}
          <span>{feedback.message}</span>
        </div>
      )}
    </div>
  )
}
