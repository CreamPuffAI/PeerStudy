import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({
      error,
      errorInfo
    })

    // Log error to error tracking service in production
    if (import.meta.env.PROD) {
      // TODO: Integrate with Sentry, LogRocket, or similar service
      console.error('[ErrorBoundary] Caught error:', error, errorInfo)
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="max-w-md w-full bg-white rounded-3xl shadow-lg border border-slate-100 p-8">
            <div className="flex items-center justify-center w-12 h-12 mb-4 rounded-full bg-red-100 mx-auto">
              <svg
                className="w-6 h-6 text-red-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>

            <h2 className="text-xl font-bold text-slate-900 text-center mb-2">
              Đã xảy ra lỗi
            </h2>

            <p className="text-sm text-slate-600 text-center mb-6">
              Rất tiếc, ứng dụng đã gặp sự cố. Vui lòng thử tải lại trang.
            </p>

            {import.meta.env.DEV && this.state.error && (
              <details className="mb-6 text-left">
                <summary className="text-xs font-semibold text-slate-700 cursor-pointer hover:text-slate-900 mb-2">
                  Chi tiết lỗi (chỉ hiển thị trong development)
                </summary>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <pre className="text-xs text-slate-700 overflow-x-auto whitespace-pre-wrap break-words">
                    {this.state.error.toString()}
                    {this.state.errorInfo?.componentStack}
                  </pre>
                </div>
              </details>
            )}

            <div className="flex gap-3">
              <button
                onClick={this.handleReset}
                className="flex-1 px-4 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 active:bg-slate-950 transition-all"
              >
                Thử lại
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white text-slate-900 border border-slate-200 font-semibold text-sm hover:bg-slate-50 active:bg-slate-100 transition-all"
              >
                Tải lại trang
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
