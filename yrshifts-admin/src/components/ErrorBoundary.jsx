import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('ErrorBoundary caught:', error, info)

    const msg = error?.message || ''
    const isChunkError = msg.includes('Failed to fetch dynamically imported module') || msg.includes('chunk') || msg.includes('dynamic')
    if (isChunkError) {
      const storageKey = 'shifthub_admin_chunk_reload'
      const reloadCount = parseInt(sessionStorage.getItem(storageKey) || '0', 10)
      if (reloadCount < 1) {
        sessionStorage.setItem(storageKey, '1')
        window.location.reload()
      }
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    const msg     = this.state.error?.message || 'Unknown error'
    const isFirestore = msg.includes('firestore') || msg.includes('permission') || msg.includes('PERMISSION_DENIED')

    return (
      <div className="flex-1 flex items-center justify-center bg-app p-8">
        <div className="max-w-md w-full bg-card border border-app rounded-2xl p-8 text-center">
          <p className="text-4xl mb-4">⚠️</p>
          <h2 className="text-lg font-bold text-primary mb-2">Something went wrong</h2>

          {isFirestore ? (
            <p className="text-sm text-muted mb-6 leading-relaxed">
              A database error occurred. This is usually a Firestore rules issue or a missing index.
              Check the browser console for details.
            </p>
          ) : (
            <p className="text-sm text-muted mb-6 leading-relaxed">
              An unexpected error occurred in this view.
            </p>
          )}

          <div className="bg-raised border border-app rounded-xl px-4 py-3 mb-6 text-left">
            <p className="text-xs font-mono text-danger break-all">{msg}</p>
          </div>

          <div className="flex gap-3 justify-center">
            <button
              onClick={() => this.setState({ error: null, info: null })}
              className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-semibold cursor-pointer border-none hover:opacity-90 transition-opacity"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-raised border border-app text-muted rounded-xl text-sm font-semibold cursor-pointer hover:text-primary transition-colors"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    )
  }
}
