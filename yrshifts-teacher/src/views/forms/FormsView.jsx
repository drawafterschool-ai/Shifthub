import { useState, useMemo } from 'react'
import useFormsStore from '../../stores/useFormsStore'
import useAuthStore from '../../stores/useAuthStore'

const isIOSSafari = /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  /safari/i.test(navigator.userAgent) &&
  !/chrome|crios|fxios/i.test(navigator.userAgent)

export default function FormsView() {
  const { assignments, submitFormResponse, loading } = useFormsStore()
  const { user, userProfile } = useAuthStore()

  // Tab state: 'pending' | 'completed'
  const [activeTab, setActiveTab] = useState('pending')

  // Form filling state
  const [fillingAssignment, setFillingAssignment] = useState(null) // assignment doc
  const [formResponses, setFormResponses] = useState({}) // fieldId -> value
  const [submitting, setSubmitting] = useState(false)

  // Form inspection state
  const [viewingAssignment, setViewingAssignment] = useState(null)

  // Separated list lists
  const pendingForms = useMemo(() => assignments.filter(a => a.status === 'pending'), [assignments])
  const completedForms = useMemo(() => assignments.filter(a => a.status === 'completed'), [assignments])

  // Start filling a form
  const handleStartFill = (assignment) => {
    // Pre-initialize empty values for fields
    const initial = {}
    assignment.fields?.forEach(f => {
      if (f.type === 'checkbox') initial[f.id] = false
      else if (f.type === 'select') initial[f.id] = f.options?.[0] || ''
      else initial[f.id] = ''
    })
    setFormResponses(initial)
    setFillingAssignment(assignment)
  }

  // Handle value inputs
  const handleValueChange = (fieldId, val) => {
    setFormResponses(prev => ({ ...prev, [fieldId]: val }))
  }

  // Submit response
  const handleSubmitResponse = async () => {
    if (submitting) return
    
    // Check basic text/textarea fields validation
    const unfilledText = fillingAssignment.fields?.some(f => 
      (f.type === 'text' || f.type === 'textarea') && !formResponses[f.id]?.trim()
    )
    if (unfilledText) {
      alert('Please fill out all text fields before submitting.')
      return
    }

    setSubmitting(true)
    try {
      const userName = userProfile ? `${userProfile.firstName} ${userProfile.lastName || ''}`.trim() : 'Teacher'
      await submitFormResponse(fillingAssignment.id, formResponses, userName, fillingAssignment.formTitle)
      alert('Thank you! Your responses have been submitted successfully.')
      setFillingAssignment(null)
    } catch (e) {
      console.error(e)
      alert('Failed to submit form responses. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Format date helper
  const formatDate = (ms) => {
    if (!ms) return ''
    return new Date(ms).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  return (
    <div className="h-full flex flex-col bg-app overflow-hidden">
      
      {/* ── Tabs Selector Toggle ── */}
      <div className="flex-shrink-0 bg-surface border-b border-app p-3 flex gap-2 justify-center">
        <button
          onClick={() => setActiveTab('pending')}
          className={`flex-1 max-w-[180px] py-2 rounded-xl text-xs font-bold cursor-pointer border-none transition-all flex items-center justify-center gap-2
            ${activeTab === 'pending' 
              ? 'bg-accent text-white shadow-md' 
              : 'bg-raised text-muted hover:text-primary border border-app'}`}
        >
          <span>⏳</span>
          <span>Pending ({pendingForms.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`flex-1 max-w-[180px] py-2 rounded-xl text-xs font-bold cursor-pointer border-none transition-all flex items-center justify-center gap-2
            ${activeTab === 'completed' 
              ? 'bg-accent text-white shadow-md' 
              : 'bg-raised text-muted hover:text-primary border border-app'}`}
        >
          <span>✅</span>
          <span>Completed ({completedForms.length})</span>
        </button>
      </div>

      {/* ── Scrollable List View ── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-4 py-4 flex flex-col gap-3">
          
          {activeTab === 'pending' ? (
            pendingForms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <span className="text-4xl mb-3">🎉</span>
                <p className="text-base font-bold text-muted">All caught up!</p>
                <p className="text-xs text-dim mt-1.5 leading-relaxed">
                  You have no pending form requests from your admin.
                </p>
              </div>
            ) : (
              pendingForms.map(item => (
                <div key={item.id} className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="inline-block px-2.5 py-0.5 rounded-full bg-accent-soft text-accent text-[9px] font-bold uppercase tracking-wider">
                        Needs Attention
                      </span>
                      <span className="text-3xs text-dim font-medium">{formatDate(item.assignedAt)}</span>
                    </div>
                    <h3 className="text-sm font-bold text-primary leading-snug mt-2">{item.formTitle}</h3>
                    {item.formDescription && (
                      <p className="text-xs text-dim line-clamp-2 mt-1.5 leading-relaxed">
                        {item.formDescription}
                      </p>
                    )}
                  </div>
                  
                  <div className="border-t border-app/60 pt-3 flex justify-end">
                    <button
                      onClick={() => handleStartFill(item)}
                      className="px-4 py-1.5 rounded-xl bg-accent hover:opacity-90 text-white text-xs font-bold cursor-pointer border-none"
                    >
                      ✍️ Fill Out Form
                    </button>
                  </div>
                </div>
              ))
            )
          ) : (
            completedForms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <span className="text-4xl mb-3">📝</span>
                <p className="text-base font-bold text-muted">No completed forms</p>
                <p className="text-xs text-dim mt-1.5 leading-relaxed">
                  Your submitted questionnaires will be archived here.
                </p>
              </div>
            ) : (
              completedForms.map(item => (
                <div key={item.id} className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="inline-block px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[9px] font-bold border border-emerald-500/30 uppercase tracking-wider">
                        Submitted
                      </span>
                      <span className="text-3xs text-dim font-medium">{formatDate(item.submittedAt)}</span>
                    </div>
                    <h3 className="text-sm font-bold text-primary leading-snug mt-2">{item.formTitle}</h3>
                  </div>

                  <div className="border-t border-app/60 pt-3 flex justify-end">
                    <button
                      onClick={() => setViewingAssignment(item)}
                      className="px-4 py-1.5 rounded-xl bg-raised border border-app text-muted hover:text-primary text-xs font-bold cursor-pointer transition-colors"
                    >
                      👁️ View Answers
                    </button>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      </div>

      {/* ── MODAL 1: FORM RESPONSE BUILDER ── */}
      {fillingAssignment && (
        <div 
          className="absolute inset-0 z-50 flex flex-col bg-app" 
          style={isIOSSafari ? { paddingTop: "env(safe-area-inset-top, 44px)" } : {}}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3.5 bg-surface border-b border-app flex-shrink-0">
            <button 
              onClick={() => setFillingAssignment(null)}
              className="text-accent text-lg cursor-pointer bg-transparent border-none leading-none px-1"
            >
              ‹
            </button>
            <p className="text-sm font-bold text-primary truncate flex-1">{fillingAssignment.formTitle}</p>
          </div>

          {/* Form Content Inputs */}
          <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
            <div className="bg-card border border-app rounded-2xl p-4">
              <h2 className="text-base font-bold text-primary leading-tight">{fillingAssignment.formTitle}</h2>
              {fillingAssignment.formDescription && (
                <p className="text-xs text-dim leading-relaxed mt-2">{fillingAssignment.formDescription}</p>
              )}
            </div>

            <div className="flex flex-col gap-5">
              {fillingAssignment.fields?.map((field, idx) => {
                const val = formResponses[field.id]
                return (
                  <div key={field.id} className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-2">
                    <label className="text-xs font-bold text-muted">
                      {idx + 1}. {field.label} *
                    </label>

                    {/* SHORT TEXT INPUT */}
                    {field.type === 'text' && (
                      <input
                        type="text"
                        value={val || ''}
                        onChange={e => handleValueChange(field.id, e.target.value)}
                        placeholder="Write your answer..."
                        className="w-full bg-raised border border-app rounded-xl px-4 py-2.5 text-xs text-primary placeholder:text-dim outline-none focus:border-accent"
                      />
                    )}

                    {/* LONG TEXTAREA */}
                    {field.type === 'textarea' && (
                      <textarea
                        value={val || ''}
                        onChange={e => handleValueChange(field.id, e.target.value)}
                        placeholder="Write your detailed explanation..."
                        rows={3}
                        className="w-full bg-raised border border-app rounded-xl px-4 py-2.5 text-xs text-primary placeholder:text-dim outline-none focus:border-accent resize-none"
                      />
                    )}

                    {/* SELECT DROPDOWN */}
                    {field.type === 'select' && (
                      <div className="relative">
                        <select
                          value={val || ''}
                          onChange={e => handleValueChange(field.id, e.target.value)}
                          className="w-full bg-raised border border-app rounded-xl px-4 py-2.5 text-xs text-primary outline-none focus:border-accent appearance-none cursor-pointer"
                        >
                          {field.options?.map((opt, optidx) => (
                            <option key={optidx} value={opt}>{opt}</option>
                          ))}
                        </select>
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-dim text-2xs pointer-events-none">▼</span>
                      </div>
                    )}

                    {/* CHECKBOX SW-TOGGLE */}
                    {field.type === 'checkbox' && (
                      <div className="flex items-center gap-3.5 mt-1">
                        <button
                          type="button"
                          onClick={() => handleValueChange(field.id, !val)}
                          className={`w-12 h-6.5 rounded-full p-1 cursor-pointer border-none transition-all flex items-center
                            ${val ? 'bg-accent justify-end' : 'bg-raised border border-app justify-start'}`}
                        >
                          <div className={`w-4.5 h-4.5 rounded-full shadow transition-all
                            ${val ? 'bg-white' : 'bg-gray-400'}`} 
                          />
                        </button>
                        <span className={`text-xs font-semibold ${val ? 'text-accent' : 'text-dim'}`}>
                          {val ? 'Selected / Checked' : 'Unchecked'}
                        </span>
                      </div>
                    )}

                  </div>
                )
              })}
            </div>
          </div>

          {/* Form Actions Footer */}
          <div 
            className="px-4 py-3 bg-surface border-t border-app flex gap-3 flex-shrink-0"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
          >
            <button
              onClick={() => setFillingAssignment(null)}
              className="flex-1 py-3 rounded-xl border border-app bg-transparent text-muted hover:text-primary text-xs font-bold cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitResponse}
              disabled={submitting}
              className="flex-1 py-3 rounded-xl bg-accent text-white text-xs font-bold cursor-pointer border-none flex-shrink-0 disabled:opacity-60"
            >
              {submitting ? 'Submitting...' : 'Submit Responses'}
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL 2: ARCHIVED RESPONSE VIEWER ── */}
      {viewingAssignment && (
        <div 
          className="absolute inset-0 z-50 flex flex-col bg-app" 
          style={isIOSSafari ? { paddingTop: "env(safe-area-inset-top, 44px)" } : {}}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3.5 bg-surface border-b border-app flex-shrink-0">
            <button 
              onClick={() => setViewingAssignment(null)}
              className="text-accent text-lg cursor-pointer bg-transparent border-none leading-none px-1"
            >
              ‹
            </button>
            <p className="text-sm font-bold text-primary truncate flex-1">Completed Responses</p>
          </div>

          {/* Form Content Displays */}
          <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
            <div className="bg-card border border-app rounded-2xl p-4">
              <span className="inline-block px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[9px] font-bold border border-emerald-500/30 uppercase tracking-wider">
                Submitted Responses
              </span>
              <h2 className="text-base font-bold text-primary leading-tight mt-3">{viewingAssignment.formTitle}</h2>
              {viewingAssignment.formDescription && (
                <p className="text-xs text-dim leading-relaxed mt-2">{viewingAssignment.formDescription}</p>
              )}
              <div className="border-t border-app/60 pt-2.5 mt-3 flex items-center justify-between text-[10px] text-muted">
                <span>Assigned: {formatDate(viewingAssignment.assignedAt)}</span>
                <span>Submitted: {formatDate(viewingAssignment.submittedAt)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-5">
              {viewingAssignment.fields?.map((field, idx) => {
                const val = viewingAssignment.responses[field.id]
                return (
                  <div key={field.id} className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-2">
                    <label className="text-xs font-bold text-muted">
                      {idx + 1}. {field.label}
                    </label>

                    {/* SHORT TEXT INPUT DISPLAY */}
                    {field.type === 'text' && (
                      <div className="bg-raised border border-app rounded-xl px-4 py-2.5 text-xs text-primary font-medium">
                        {val || <span className="text-dim italic">Blank / No answer</span>}
                      </div>
                    )}

                    {/* LONG TEXTAREA DISPLAY */}
                    {field.type === 'textarea' && (
                      <div className="bg-raised border border-app rounded-xl px-4 py-2.5 text-xs text-primary font-medium leading-relaxed whitespace-pre-wrap">
                        {val || <span className="text-dim italic">Blank / No answer</span>}
                      </div>
                    )}

                    {/* SELECT DROPDOWN DISPLAY */}
                    {field.type === 'select' && (
                      <div className="bg-raised border border-app rounded-xl px-4 py-2.5 text-xs text-primary font-medium">
                        {val || <span className="text-dim italic">Blank / None selected</span>}
                      </div>
                    )}

                    {/* CHECKBOX DISPLAY */}
                    {field.type === 'checkbox' && (
                      <div className="flex items-center gap-2">
                        <span className="text-base">{val ? '✅' : '❌'}</span>
                        <span className={`text-xs font-bold ${val ? 'text-emerald-400' : 'text-danger'}`}>
                          {val ? 'Yes / Agreed' : 'No / Disagreed'}
                        </span>
                      </div>
                    )}

                  </div>
                )
              })}
            </div>
          </div>

          {/* Form Footer */}
          <div 
            className="px-4 py-3 bg-surface border-t border-app flex flex-shrink-0"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
          >
            <button
              onClick={() => setViewingAssignment(null)}
              className="w-full py-3 rounded-xl bg-accent text-white text-xs font-bold cursor-pointer border-none flex-shrink-0"
            >
              Close Viewer
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
