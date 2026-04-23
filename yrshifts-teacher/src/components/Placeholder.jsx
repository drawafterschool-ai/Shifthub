/** Temporary placeholder shown while a view is being built in a later step. */
export default function Placeholder({ icon, title, step }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-app">
      <div className="text-5xl">{icon}</div>
      <div className="text-center">
        <h2 className="text-lg font-bold text-primary mb-1">{title}</h2>
        <p className="text-sm text-muted">Building this in Step {step}</p>
      </div>
      <div className="flex items-center gap-2 bg-accent-soft border border-accent/30 rounded-xl px-4 py-2">
        <span className="text-accent text-xs font-semibold">✦ Coming next</span>
      </div>
    </div>
  )
}
