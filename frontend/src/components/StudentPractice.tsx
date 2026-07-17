import { useEffect, useState } from 'react'
import decisionTree from '../lib/decision-tree.json'
import { db } from '../lib/db'

const defaultQuestion = decisionTree.nodes[decisionTree.root]

export function StudentPractice() {
  const [nodeKey, setNodeKey] = useState(decisionTree.root)
  const [answer, setAnswer] = useState('')
  const [message, setMessage] = useState('')
  const [passes, setPasses] = useState(0)

  const node = decisionTree.nodes[nodeKey]

  useEffect(() => {
    setMessage('')
    setAnswer('')
  }, [nodeKey])

  const handleSubmit = async () => {
    if (!answer.trim()) return

    if (node.type === 'diagnostic') {
      if (answer.trim() === node.expected) {
        setMessage('Đúng rồi! Chuyển sang bước tiếp theo.')
        setNodeKey(node.onCorrect)
      } else {
        const nextKey = node.onIncorrect || nodeKey
        setMessage('Chưa chính xác. Quay lại luyện tập nền tảng.')
        setNodeKey(nextKey)

        const error = node.errors?.[answer.trim()]
        if (error) {
          await db.events.add({
            student_id: 'HS01',
            root_cause: error.root_cause,
            status: 'đang học lại',
            timestamp: Date.now()
          })
        }
      }
    }

    if (node.type === 'remediation') {
      const nextPasses = passes + 1
      setPasses(nextPasses)
      if (nextPasses >= node.pass_target) {
        setMessage('Đã hoàn thành phần remedial. Quay lại bài lớn.')
        setNodeKey(decisionTree.root)
        setPasses(0)
      } else {
        setMessage(`Hoàn thành ${nextPasses}/${node.pass_target}. Làm tiếp bài sau.`)
      }
    }
  }

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-slate-900">Student practice</h2>
      <p className="mt-2 text-slate-600">Bài chẩn đoán phân số lớp 7.</p>
      <div className="mt-6 space-y-4">
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
          <div className="font-medium">Câu hỏi:</div>
          <div className="mt-2">{node.question}</div>
          {node.type === 'remediation' && (
            <div className="mt-2 text-slate-500">Root cause: {node.root_cause}</div>
          )}
        </div>

        <input
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
          placeholder="Nhập câu trả lời của em"
        />

        <button
          onClick={handleSubmit}
          className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Nộp đáp án
        </button>

        {message && <div className="rounded-2xl bg-blue-50 p-4 text-sm text-blue-900">{message}</div>}
      </div>
    </div>
  )
}
