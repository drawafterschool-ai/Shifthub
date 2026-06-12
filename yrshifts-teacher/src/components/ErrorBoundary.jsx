import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)

    const msg = error?.message || ''
    const isChunkError = msg.includes('Failed to fetch dynamically imported module') || msg.includes('chunk') || msg.includes('dynamic')
    if (isChunkError) {
      const storageKey = 'shifthub_teacher_chunk_reload'
      const reloadCount = parseInt(sessionStorage.getItem(storageKey) || '0', 10)
      if (reloadCount < 1) {
        sessionStorage.setItem(storageKey, '1')
        window.location.reload()
      }
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex-1 flex items-center justify-center bg-app p-6">
        <div className="max-w-sm w-full bg-card border border-app rounded-2xl p-7 text-center">
          <p className="text-4xl mb-3">⚠️</p>
          <h2 className="text-base font-bold text-primary mb-2">Something went wrong</h2>
          <p className="text-sm text-muted mb-5 leading-relaxed">
            This section ran into an error. Tap below to try again.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => this.setState({ error: null })}
              className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-bold cursor-pointer border-none"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-raised border border-app text-muted rounded-xl text-sm font-semibold cursor-pointer"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
