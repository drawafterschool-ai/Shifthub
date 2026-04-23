/** Shown by Suspense while a lazy view chunk is downloading */
export default function ViewLoader() {
  return (
    <div className="flex-1 flex items-center justify-center bg-app">
      <div className="flex flex-col items-center gap-3">
        <div className="w-7 h-7 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        <p className="text-xs text-dim">Loading…</p>
      </div>
    </div>
  )
}
