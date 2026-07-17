import { useEffect, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
import { TutorDashboard } from './components/TutorDashboard'
import { StudentPractice } from './components/StudentPractice'

const sampleData = [
  { name: 'Phân số', wrong: 5 },
  { name: 'Quy đổi', wrong: 12 },
  { name: 'Phương trình', wrong: 8 },
  { name: 'Chuyển vế', wrong: 6 }
]

const sampleProgress = [
  { name: 'Phân số', score: 72 },
  { name: 'Quy đồng mẫu số', score: 84 },
  { name: 'Phương trình', score: 63 }
]

export default function App() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    update()
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white/90 py-4 shadow-sm backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6">
          <div>
            <p className="text-sm text-slate-500">PeerStudy</p>
            <h1 className="text-2xl font-semibold text-slate-900">Adaptive Tutor Dashboard</h1>
          </div>
          <div className="rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-700">
            {offline ? 'Offline mode' : 'Online mode'}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Teacher dashboard</h2>
            <p className="mt-2 text-sm text-slate-600">Theo dõi lỗi sai chuỗi kiến thức Phân số và chuyên đề phương trình phân số.</p>
            <TutorDashboard data={sampleData} progress={sampleProgress} />
          </div>
          <div className="space-y-4">
            <div className="rounded-3xl bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-900">Class summary</h3>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                <div>Học sinh đang làm bài offline? <strong>{offline ? 'Có' : 'Không'}</strong></div>
                <div>Ưu tiên can thiệp: Quy đồng mẫu số.</div>
                <div>Bệnh lý core: Cộng tử với tử, mẫu với mẫu.</div>
              </div>
            </div>
            <div className="rounded-3xl bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-900">PWA / Offline</h3>
              <p className="mt-2 text-sm text-slate-600">App này lưu root cause và trạng thái học lại offline rồi đồng bộ lên teacher dashboard khi có mạng.</p>
            </div>
          </div>
        </section>
        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <StudentPractice />
          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Knowledge Graph</h2>
            <p className="mt-2 text-sm text-slate-600">MVP tập trung vào chuỗi Phân số lớp 5 → Số hữu tỉ lớp 6 → Phương trình phân số lớp 7.</p>
            <ul className="mt-4 space-y-3 text-sm text-slate-700">
              <li>• Lớp 7: Giải phương trình chứa phân số</li>
              <li>• Lớp 6: Hiểu chuyển vế, đổi dấu</li>
              <li>• Lớp 5: Quy đồng mẫu số để cộng/trừ phân số khác mẫu</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  )
}
