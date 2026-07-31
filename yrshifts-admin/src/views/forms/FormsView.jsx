import { useState, useMemo } from 'react'
import useFormsStore from '../../stores/useFormsStore'
import useDirectoryStore from '../../stores/useDirectoryStore'
import Button from '../../components/Button'
import Avatar from '../../components/Avatar'
import Modal, { ModalHeader, ModalFooter } from '../../components/Modal'

export default function FormsView() {
  const { forms, assignments, loading, saveFormTemplate, deleteFormTemplate, assignForm, deleteAssignment } = useFormsStore()
  const { instructors } = useDirectoryStore()

  // Tab state: 'templates' | 'responses'
  const [activeTab, setActiveTab] = useState('templates')

  // Selected template in list
  const [selectedTemplateId, setSelectedTemplateId] = useState(null)

  // Builder states
  const [isBuilding, setIsBuilding] = useState(false)
  const [builderId, setBuilderId] = useState(null) // null for create, string id for edit
  const [builderTitle, setBuilderTitle] = useState('')
  const [builderDesc, setBuilderDesc] = useState('')
  const [builderFields, setBuilderFields] = useState([]) // array of { id, type, label, options }

  // Send modal states
  const [sendModalTemplate, setSendModalTemplate] = useState(null)
  const [sendTeacherSearch, setSendTeacherSearch] = useState('')
  const [sendSelectedTeachers, setSendSelectedTeachers] = useState([]) // array of teacherIds

  // Response dashboard states
  const [respStatusFilter, setRespStatusFilter] = useState('all') // all | pending | completed
  const [respTemplateFilter, setRespTemplateFilter] = useState('all')
  const [respSearch, setRespSearch] = useState('')
  const [respViewMode, setRespViewMode] = useState('table') // 'table' | 'question'
  const [viewingResponseAssignment, setViewingResponseAssignment] = useState(null) // assignment doc

  // Helper stats computer
  const getTemplateStats = (templateId) => {
    const total = assignments.filter(a => a.formId === templateId).length
    const completed = assignments.filter(a => a.formId === templateId && a.status === 'completed').length
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, completed, percent }
  }

  // Retrieve current active template
  const activeTemplate = useMemo(() => {
    if (!selectedTemplateId) return forms[0] || null
    return forms.find(f => f.id === selectedTemplateId) || forms[0] || null
  }, [forms, selectedTemplateId])

  // Start creating new template
  const handleStartCreate = () => {
    setBuilderId(null)
    setBuilderTitle('')
    setBuilderDesc('')
    setBuilderFields([])
    setIsBuilding(true)
  }

  // Start editing existing template
  const handleStartEdit = (template) => {
    setBuilderId(template.id)
    setBuilderTitle(template.title)
    setBuilderDesc(template.description)
    setBuilderFields(JSON.parse(JSON.stringify(template.fields || [])))
    setIsBuilding(true)
  }

  // Builder field management
  const addField = (type) => {
    const newField = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      type,
      label: '',
      options: type === 'select' ? [''] : []
    }
    setBuilderFields([...builderFields, newField])
  }

  const updateFieldLabel = (index, label) => {
    const updated = [...builderFields]
    updated[index].label = label
    setBuilderFields(updated)
  }

  const deleteField = (index) => {
    const updated = [...builderFields]
    updated.splice(index, 1)
    setBuilderFields(updated)
  }

  const moveField = (index, direction) => {
    if (direction === 'up' && index === 0) return
    if (direction === 'down' && index === builderFields.length - 1) return
    const updated = [...builderFields]
    const targetIdx = direction === 'up' ? index - 1 : index + 1
    const temp = updated[index]
    updated[index] = updated[targetIdx]
    updated[targetIdx] = temp
    setBuilderFields(updated)
  }

  const addOption = (fieldIdx) => {
    const updated = [...builderFields]
    updated[fieldIdx].options.push('')
    setBuilderFields(updated)
  }

  const updateOptionText = (fieldIdx, optIdx, text) => {
    const updated = [...builderFields]
    updated[fieldIdx].options[optIdx] = text
    setBuilderFields(updated)
  }

  const deleteOption = (fieldIdx, optIdx) => {
    const updated = [...builderFields]
    updated[fieldIdx].options.splice(optIdx, 1)
    setBuilderFields(updated)
  }

  // Save template in builder
  const handleSaveTemplate = async () => {
    if (!builderTitle.trim()) {
      alert('Please provide a form title.')
      return
    }
    if (builderFields.length === 0) {
      alert('Please add at least one field to the form.')
      return
    }
    const invalid = builderFields.some(f => !f.label.trim())
    if (invalid) {
      alert('Please provide a label for all fields.')
      return
    }
    const selectInvalid = builderFields.some(f => f.type === 'select' && f.options.filter(o => o.trim()).length === 0)
    if (selectInvalid) {
      alert('Please provide at least one option for your dropdown fields.')
      return
    }

    const sanitizedFields = builderFields.map(f => {
      if (f.type === 'select') {
        return { ...f, options: f.options.map(o => o.trim()).filter(Boolean) }
      }
      return f
    })

    const savedId = await saveFormTemplate(builderId, builderTitle, builderDesc, sanitizedFields)
    setSelectedTemplateId(savedId)
    setIsBuilding(false)
  }

  // Delete a template
  const handleDeleteTemplate = async (template) => {
    if (!window.confirm(`Are you sure you want to delete the form template "${template.title}"?`)) return
    await deleteFormTemplate(template.id)
    if (selectedTemplateId === template.id) {
      setSelectedTemplateId(null)
    }
  }

  // Send forms setup
  const openSendModal = (template) => {
    setSendModalTemplate(template)
    setSendTeacherSearch('')
    setSendSelectedTeachers([])
  }

  const handleToggleSelectAll = (filteredTeachers) => {
    const allFilteredIds = filteredTeachers.map(t => t.id)
    const isAllSelected = allFilteredIds.every(id => sendSelectedTeachers.includes(id))
    if (isAllSelected) {
      setSendSelectedTeachers(sendSelectedTeachers.filter(id => !allFilteredIds.includes(id)))
    } else {
      const union = Array.from(new Set([...sendSelectedTeachers, ...allFilteredIds]))
      setSendSelectedTeachers(union)
    }
  }

  const handleSendForms = async () => {
    if (sendSelectedTeachers.length === 0) {
      alert('Please select at least one teacher.')
      return
    }
    await assignForm(
      sendModalTemplate.id,
      sendModalTemplate.title,
      sendModalTemplate.description,
      sendModalTemplate.fields,
      sendSelectedTeachers
    )
    alert(`Successfully dispatched "${sendModalTemplate.title}" to ${sendSelectedTeachers.length} teacher(s)!`)
    setSendModalTemplate(null)
    setActiveTab('responses')
  }

  // Filtered teachers list for send modal
  const filteredTeachersForSend = useMemo(() => {
    if (!sendTeacherSearch.trim()) return instructors
    const q = sendTeacherSearch.toLowerCase()
    return instructors.filter(t => 
      `${t.firstName} ${t.lastName}`.toLowerCase().includes(q)
    )
  }, [instructors, sendTeacherSearch])

  // Filtered responses dashboard list
  const filteredAssignments = useMemo(() => {
    return assignments.filter(a => {
      if (respStatusFilter !== 'all' && a.status !== respStatusFilter) return false
      if (respTemplateFilter !== 'all' && a.formId !== respTemplateFilter) return false
      if (respSearch.trim()) {
        const q = respSearch.toLowerCase()
        const matchName = a.teacherName.toLowerCase().includes(q)
        const matchTitle = a.formTitle.toLowerCase().includes(q)
        if (!matchName && !matchTitle) return false
      }
      return true
    })
  }, [assignments, respStatusFilter, respTemplateFilter, respSearch])

  // Completed list for modal carousel navigation
  const completedAssignmentsList = useMemo(() => {
    return filteredAssignments.filter(a => a.status === 'completed')
  }, [filteredAssignments])

  const currentRespIdx = useMemo(() => {
    if (!viewingResponseAssignment) return -1
    return completedAssignmentsList.findIndex(a => a.id === viewingResponseAssignment.id)
  }, [viewingResponseAssignment, completedAssignmentsList])

  const handleNavigateResp = (direction) => {
    if (currentRespIdx === -1) return
    const newIdx = direction === 'prev' ? currentRespIdx - 1 : currentRespIdx + 1
    if (newIdx >= 0 && newIdx < completedAssignmentsList.length) {
      setViewingResponseAssignment(completedAssignmentsList[newIdx])
    }
  }

  const handleDeleteAssignment = async (assignment) => {
    if (!window.confirm(`Are you sure you want to delete the assignment for ${assignment.teacherName}?`)) return
    await deleteAssignment(assignment.id)
  }

  // Helper date formatter
  const formatDate = (ms) => {
    if (!ms) return '—'
    return new Date(ms).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Export submissions to CSV
  const handleExportCSV = () => {
    const targetAssignments = filteredAssignments.filter(a => a.status === 'completed')
    if (targetAssignments.length === 0) {
      alert('No completed form submissions available to export under current filters.')
      return
    }

    let targetTemplate = null
    if (respTemplateFilter !== 'all') {
      targetTemplate = forms.find(f => f.id === respTemplateFilter)
    }

    let fields = targetTemplate?.fields || []
    if (!fields.length) {
      const fieldsMap = new Map()
      targetAssignments.forEach(a => {
        a.fields?.forEach(f => {
          if (!fieldsMap.has(f.id)) fieldsMap.set(f.id, f)
        })
      })
      fields = Array.from(fieldsMap.values())
    }

    const headers = ['Teacher Name', 'Status', 'Dispatched Date', 'Submitted Date', ...fields.map(f => f.label)]
    
    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""'
      const val = String(str).replace(/"/g, '""')
      return `"${val}"`
    }

    const rows = targetAssignments.map(a => {
      const teacherName = a.teacherName
      const status = a.status
      const dispatchedDate = formatDate(a.assignedAt)
      const submittedDate = formatDate(a.submittedAt)

      const fieldAnswers = fields.map(f => {
        const raw = a.responses?.[f.id]
        if (f.type === 'checkbox') return raw ? 'Yes' : 'No'
        return raw || ''
      })

      return [teacherName, status, dispatchedDate, submittedDate, ...fieldAnswers].map(escapeCsv).join(',')
    })

    const csvContent = [headers.map(escapeCsv).join(','), ...rows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const formTitle = targetTemplate?.title ? targetTemplate.title.replace(/[^a-zA-Z0-9_-]/g, '_') : 'Form_Submissions'
    link.setAttribute('download', `${formTitle}_Submissions_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="flex flex-col h-full bg-app overflow-hidden">
      
      {/* ── Main Header & Tabs ── */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-app bg-surface px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-primary tracking-wide">📝 Forms Center</h1>
          <p className="text-xs text-muted mt-0.5">Design, dispatch, and track custom questionnaires for teachers</p>
        </div>
        <div className="flex items-center bg-card border border-app rounded-xl p-1">
          <button
            onClick={() => { setActiveTab('templates'); setIsBuilding(false); }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer border-none transition-all
              ${activeTab === 'templates' ? 'bg-accent text-white shadow' : 'bg-transparent text-muted hover:text-primary'}`}
          >
            Form Templates
          </button>
          <button
            onClick={() => { setActiveTab('responses'); setIsBuilding(false); }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer border-none transition-all
              ${activeTab === 'responses' ? 'bg-accent text-white shadow' : 'bg-transparent text-muted hover:text-primary'}`}
          >
            Dispatch & Responses
          </button>
        </div>
      </div>

      {/* ── Content Body ── */}
      <div className="flex-1 overflow-hidden min-h-0 relative">
        
        {/* ================== TAB 1: FORM TEMPLATES ================== */}
        {activeTab === 'templates' && (
          isBuilding ? (
            /* Builder view */
            <div className="absolute inset-0 flex flex-col bg-app overflow-hidden">
              <div className="flex flex-shrink-0 items-center justify-between border-b border-app bg-raised px-6 py-3">
                <h2 className="text-sm font-bold text-primary">
                  {builderId ? '✏️ Editing Form Template' : '➕ Creating New Form Template'}
                </h2>
                <div className="flex gap-2">
                  <Button variant="ghost" small onClick={() => setIsBuilding(false)}>Cancel</Button>
                  <Button variant="primary" small onClick={handleSaveTemplate} icon="💾">Save Template</Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-6 max-w-4xl mx-auto w-full flex flex-col gap-6">
                
                {/* Form Basics */}
                <div className="bg-card border border-app rounded-2xl p-5 flex flex-col gap-4">
                  <h3 className="text-xs font-bold text-accent uppercase tracking-wider">Form Information</h3>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-muted">Form Title *</label>
                    <input
                      type="text"
                      value={builderTitle}
                      onChange={e => setBuilderTitle(e.target.value)}
                      placeholder="e.g. Summer Class Availability Check"
                      className="w-full bg-raised border border-app rounded-xl px-4 py-2 text-sm text-primary placeholder:text-dim outline-none focus:border-accent"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-muted">Form Description / Instructions</label>
                    <textarea
                      value={builderDesc}
                      onChange={e => setBuilderDesc(e.target.value)}
                      placeholder="Explain to the instructors what this form is for..."
                      rows={2}
                      className="w-full bg-raised border border-app rounded-xl px-4 py-2 text-sm text-primary placeholder:text-dim outline-none focus:border-accent resize-none"
                    />
                  </div>
                </div>

                {/* Form Fields Builder */}
                <div className="bg-card border border-app rounded-2xl p-5 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-accent uppercase tracking-wider">Form Fields ({builderFields.length})</h3>
                    <div className="flex gap-1.5">
                      <Button variant="ghost" small onClick={() => addField('text')} icon="➕ text">Text Input</Button>
                      <Button variant="ghost" small onClick={() => addField('textarea')} icon="➕ box">Text Area</Button>
                      <Button variant="ghost" small onClick={() => addField('select')} icon="➕ dropdown">Dropdown</Button>
                      <Button variant="ghost" small onClick={() => addField('checkbox')} icon="➕ toggle">Checkbox</Button>
                    </div>
                  </div>

                  {builderFields.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 border border-dashed border-app rounded-xl">
                      <p className="text-3xl">📝</p>
                      <p className="text-xs text-muted font-bold mt-2">No fields added yet</p>
                      <p className="text-2xs text-dim mt-0.5">Click any buttons above to add fields to this form template</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {builderFields.map((field, index) => (
                        <div key={field.id} className="bg-raised border border-app rounded-xl p-4 flex gap-4">
                          <div className="flex flex-col justify-between items-center bg-card border border-app rounded-lg p-1.5 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => moveField(index, 'up')}
                              disabled={index === 0}
                              className="text-muted hover:text-primary disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed bg-transparent border-none text-base"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteField(index)}
                              className="text-danger-soft hover:text-danger bg-transparent border-none text-xs cursor-pointer my-2"
                              title="Delete Field"
                            >
                              🗑️
                            </button>
                            <button
                              type="button"
                              onClick={() => moveField(index, 'down')}
                              disabled={index === builderFields.length - 1}
                              className="text-muted hover:text-primary disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed bg-transparent border-none text-base"
                            >
                              ▼
                            </button>
                          </div>

                          <div className="flex-1 flex flex-col gap-3">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 flex flex-col gap-1">
                                <label className="text-2xs font-bold text-muted">Field Label *</label>
                                <input
                                  type="text"
                                  value={field.label}
                                  onChange={e => updateFieldLabel(index, e.target.value)}
                                  placeholder="e.g. Do you have a preferred teaching site?"
                                  className="w-full bg-card border border-app rounded-lg px-3 py-1.5 text-xs text-primary placeholder:text-dim outline-none focus:border-accent"
                                />
                              </div>
                              <div className="w-32 flex flex-col gap-1 flex-shrink-0">
                                <label className="text-2xs font-bold text-muted">Input Type</label>
                                <div className="bg-card border border-app rounded-lg px-2 py-1.5 text-xs text-muted select-none">
                                  {field.type === 'text' && '✍️ Short Text'}
                                  {field.type === 'textarea' && '📝 Long Text'}
                                  {field.type === 'checkbox' && '☑️ Checkbox'}
                                  {field.type === 'select' && '🔽 Dropdown'}
                                </div>
                              </div>
                            </div>

                            {field.type === 'select' && (
                              <div className="border-t border-app pt-2 mt-1">
                                <div className="flex items-center justify-between mb-2">
                                  <label className="text-2xs font-bold text-accent uppercase tracking-wider">Dropdown Choices</label>
                                  <Button variant="ghost" small onClick={() => addOption(index)} icon="➕">Add Choice</Button>
                                </div>
                                <div className="flex flex-col gap-2">
                                  {field.options.map((opt, optIdx) => (
                                    <div key={optIdx} className="flex items-center gap-2">
                                      <span className="text-2xs text-dim w-4">{optIdx + 1}.</span>
                                      <input
                                        type="text"
                                        value={opt}
                                        onChange={e => updateOptionText(index, optIdx, e.target.value)}
                                        placeholder={`Choice ${optIdx + 1}`}
                                        className="flex-1 bg-card border border-app rounded-lg px-3 py-1 text-xs text-primary placeholder:text-dim outline-none focus:border-accent"
                                      />
                                      {field.options.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => deleteOption(index, optIdx)}
                                          className="text-dim hover:text-danger cursor-pointer bg-transparent border-none text-base font-bold"
                                        >
                                          ×
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Forms Template Dashboard */
            <div className="absolute inset-0 flex bg-app overflow-hidden">
              {/* Left Panel: Templates List */}
              <div className="w-80 border-r border-app bg-surface flex flex-col flex-shrink-0">
                <div className="p-4 border-b border-app flex flex-shrink-0 gap-2 items-center justify-between">
                  <span className="text-xs font-bold text-primary uppercase tracking-wide">Templates ({forms.length})</span>
                  <Button variant="primary" small onClick={handleStartCreate} icon="➕">Create</Button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                  {forms.length === 0 ? (
                    <div className="py-20 text-center text-xs text-dim">
                      No templates created yet. Click "Create" to design one!
                    </div>
                  ) : (
                    forms.map(f => {
                      const isActive = (activeTemplate && activeTemplate.id === f.id)
                      const stats = getTemplateStats(f.id)
                      return (
                        <button
                          key={f.id}
                          onClick={() => setSelectedTemplateId(f.id)}
                          className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-1.5
                            ${isActive ? 'bg-accent-soft border-accent/40' : 'bg-card border-app hover:bg-raised'}`}
                        >
                          <div className="flex items-start justify-between gap-2 w-full">
                            <span className={`text-xs font-bold truncate ${isActive ? 'text-accent' : 'text-primary'}`}>
                              {f.title}
                            </span>
                          </div>
                          <span className="text-2xs text-dim line-clamp-2 w-full leading-normal">
                            {f.description || 'No description provided.'}
                          </span>
                          
                          <div className="flex items-center justify-between mt-1 text-[10px] text-muted font-semibold">
                            <span>{f.fields?.length || 0} fields</span>
                            {stats.total > 0 ? (
                              <span className="text-emerald-400 font-bold">{stats.completed}/{stats.total} Submitted ({stats.percent}%)</span>
                            ) : (
                              <span className="text-dim">Not dispatched</span>
                            )}
                          </div>
                          {stats.total > 0 && (
                            <div className="w-full bg-raised rounded-full h-1 mt-0.5 overflow-hidden border border-app/50">
                              <div className="bg-emerald-400 h-full transition-all duration-300" style={{ width: `${stats.percent}%` }} />
                            </div>
                          )}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Right Panel: Template Details */}
              <div className="flex-1 bg-app overflow-y-auto p-6 flex flex-col gap-6">
                {activeTemplate ? (
                  <div className="max-w-3xl flex flex-col gap-6">
                    {/* Header Details */}
                    <div className="bg-card border border-app rounded-2xl p-6 flex flex-col gap-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h2 className="text-lg font-bold text-primary leading-tight">{activeTemplate.title}</h2>
                          <p className="text-xs text-dim mt-2 leading-relaxed">
                            {activeTemplate.description || 'No description provided for this form template.'}
                          </p>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <Button variant="default" small onClick={() => handleStartEdit(activeTemplate)} icon="✏️">Edit</Button>
                          <Button variant="danger" small onClick={() => handleDeleteTemplate(activeTemplate)} icon="🗑️">Delete</Button>
                        </div>
                      </div>
                      
                      <div className="border-t border-app pt-4 mt-2 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="text-2xs text-muted">Created: {formatDate(activeTemplate.createdAt)}</span>
                          {getTemplateStats(activeTemplate.id).total > 0 && (
                            <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-2xs font-bold border border-emerald-500/30">
                              📊 {getTemplateStats(activeTemplate.id).completed} / {getTemplateStats(activeTemplate.id).total} Submissions ({getTemplateStats(activeTemplate.id).percent}%)
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {getTemplateStats(activeTemplate.id).total > 0 && (
                            <Button
                              variant="default"
                              small
                              onClick={() => {
                                setRespTemplateFilter(activeTemplate.id)
                                setActiveTab('responses')
                              }}
                              icon="👁️"
                            >
                              View Submissions ({getTemplateStats(activeTemplate.id).completed})
                            </Button>
                          )}
                          <Button variant="publish" small onClick={() => openSendModal(activeTemplate)} icon="✉️">Send to Teachers</Button>
                        </div>
                      </div>
                    </div>

                    {/* Preview / Fields Definition */}
                    <div className="bg-card border border-app rounded-2xl p-6 flex flex-col gap-4">
                      <h3 className="text-xs font-bold text-accent uppercase tracking-wider">Form Fields Layout</h3>
                      <div className="flex flex-col gap-4">
                        {activeTemplate.fields?.map((field, idx) => (
                          <div key={field.id} className="border-b border-app/40 pb-4 last:border-none last:pb-0">
                            <label className="block text-xs font-bold text-muted mb-2">
                              {idx + 1}. {field.label}
                            </label>
                            
                            {field.type === 'text' && (
                              <input
                                type="text"
                                disabled
                                placeholder="Text input placeholder..."
                                className="w-full max-w-md bg-raised border border-app rounded-xl px-4 py-2 text-xs text-dim opacity-70 cursor-not-allowed outline-none"
                              />
                            )}

                            {field.type === 'textarea' && (
                              <textarea
                                disabled
                                rows={2}
                                placeholder="Paragraph text placeholder..."
                                className="w-full max-w-lg bg-raised border border-app rounded-xl px-4 py-2 text-xs text-dim opacity-70 cursor-not-allowed outline-none resize-none"
                              />
                            )}

                            {field.type === 'checkbox' && (
                              <div className="flex items-center gap-2 opacity-70">
                                <div className="w-9 h-5 rounded-full bg-raised border border-app flex-shrink-0" />
                                <span className="text-2xs text-dim">Switch toggle control</span>
                              </div>
                            )}

                            {field.type === 'select' && (
                              <div className="relative max-w-xs">
                                <select disabled className="w-full bg-raised border border-app rounded-xl px-4 py-2 text-xs text-dim opacity-70 cursor-not-allowed outline-none appearance-none">
                                  <option>Select choice...</option>
                                  {field.options?.map((o, oidx) => (
                                    <option key={oidx}>{o}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center py-40">
                    <p className="text-5xl mb-4">📋</p>
                    <h3 className="text-base font-bold text-muted">No Template Selected</h3>
                    <p className="text-xs text-dim mt-1">Select a form template on the left, or create a new one to begin</p>
                  </div>
                )}
              </div>
            </div>
          )
        )}

        {/* ================== TAB 2: DISPATCH & RESPONSES ================== */}
        {activeTab === 'responses' && (
          <div className="absolute inset-0 flex flex-col bg-app overflow-hidden">
            {/* Filter & Action Bar */}
            <div className="flex-shrink-0 bg-surface border-b border-app px-6 py-3.5 flex flex-wrap gap-4 items-center justify-between">
              
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  value={respSearch}
                  onChange={e => setRespSearch(e.target.value)}
                  placeholder="🔍 Search by teacher or form..."
                  className="bg-card border border-app rounded-xl px-4 py-1.5 text-xs text-primary placeholder:text-dim outline-none focus:border-accent w-56"
                />
                
                <select
                  value={respTemplateFilter}
                  onChange={e => setRespTemplateFilter(e.target.value)}
                  className="bg-card border border-app rounded-xl px-3 py-1.5 text-xs text-muted outline-none focus:border-accent"
                >
                  <option value="all">All Form Templates</option>
                  {forms.map(f => (
                    <option key={f.id} value={f.id}>{f.title}</option>
                  ))}
                </select>

                <div className="flex bg-card border border-app rounded-lg p-0.5">
                  <button
                    onClick={() => setRespStatusFilter('all')}
                    className={`px-3 py-1 rounded text-2xs font-bold cursor-pointer border-none transition-all
                      ${respStatusFilter === 'all' ? 'bg-accent text-white' : 'bg-transparent text-muted hover:text-primary'}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setRespStatusFilter('pending')}
                    className={`px-3 py-1 rounded text-2xs font-bold cursor-pointer border-none transition-all
                      ${respStatusFilter === 'pending' ? 'bg-accent text-white' : 'bg-transparent text-muted hover:text-primary'}`}
                  >
                    Pending
                  </button>
                  <button
                    onClick={() => setRespStatusFilter('completed')}
                    className={`px-3 py-1 rounded text-2xs font-bold cursor-pointer border-none transition-all
                      ${respStatusFilter === 'completed' ? 'bg-accent text-white' : 'bg-transparent text-muted hover:text-primary'}`}
                  >
                    Completed
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* View Mode Toggle: Table vs Question Breakdown */}
                <div className="flex bg-card border border-app rounded-lg p-0.5">
                  <button
                    onClick={() => setRespViewMode('table')}
                    className={`px-3 py-1 rounded text-2xs font-bold cursor-pointer border-none transition-all flex items-center gap-1.5
                      ${respViewMode === 'table' ? 'bg-accent text-white' : 'bg-transparent text-muted hover:text-primary'}`}
                  >
                    <span>📋</span>
                    <span>Individual List</span>
                  </button>
                  <button
                    onClick={() => setRespViewMode('question')}
                    className={`px-3 py-1 rounded text-2xs font-bold cursor-pointer border-none transition-all flex items-center gap-1.5
                      ${respViewMode === 'question' ? 'bg-accent text-white' : 'bg-transparent text-muted hover:text-primary'}`}
                  >
                    <span>📊</span>
                    <span>Question Breakdown</span>
                  </button>
                </div>

                {/* CSV Export Button */}
                <Button
                  variant="default"
                  small
                  onClick={handleExportCSV}
                  icon="📥"
                >
                  Export CSV
                </Button>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto px-6 py-6">
              
              {/* VIEW 1: INDIVIDUAL TABLE VIEW */}
              {respViewMode === 'table' && (
                <div className="bg-card border border-app rounded-2xl overflow-hidden shadow">
                  {filteredAssignments.length === 0 ? (
                    <div className="py-20 text-center flex flex-col items-center">
                      <span className="text-4xl mb-3">📭</span>
                      <h3 className="text-sm font-semibold text-muted">No dispatches found</h3>
                      <p className="text-2xs text-dim mt-1">Try resetting your filters or dispatching a new form</p>
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-app bg-surface text-2xs font-bold text-muted uppercase tracking-wider">
                          <th className="px-5 py-3">Teacher</th>
                          <th className="px-5 py-3">Form Title</th>
                          <th className="px-5 py-3">Dispatched At</th>
                          <th className="px-5 py-3">Status</th>
                          <th className="px-5 py-3">Submitted At</th>
                          <th className="px-5 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs text-muted divide-y divide-app/40">
                        {filteredAssignments.map(a => {
                          const teacher = instructors.find(i => i.id === a.teacherId)
                          return (
                            <tr key={a.id} className="hover:bg-raised transition-colors">
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-2.5">
                                  <Avatar
                                    firstName={teacher?.firstName || a.teacherName.split(' ')[0] || ''}
                                    lastName={teacher?.lastName || a.teacherName.split(' ')[1] || ''}
                                    color={teacher?.color}
                                    photo={teacher?.photo}
                                    size={24}
                                  />
                                  <span className="font-semibold text-primary">{a.teacherName}</span>
                                </div>
                              </td>
                              <td className="px-5 py-3">
                                <span className="font-medium text-primary line-clamp-1">{a.formTitle}</span>
                              </td>
                              <td className="px-5 py-3 whitespace-nowrap text-dim">
                                {formatDate(a.assignedAt)}
                              </td>
                              <td className="px-5 py-3">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider
                                  ${a.status === 'completed' 
                                    ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' 
                                    : 'text-amber-400 bg-amber-400/10 border-amber-400/30'}`}
                                >
                                  {a.status === 'completed' ? 'Completed' : 'Pending'}
                                </span>
                              </td>
                              <td className="px-5 py-3 whitespace-nowrap text-dim">
                                {formatDate(a.submittedAt)}
                              </td>
                              <td className="px-5 py-3 text-right whitespace-nowrap">
                                <div className="inline-flex gap-2">
                                  {a.status === 'completed' ? (
                                    <Button
                                      variant="ghost"
                                      small
                                      onClick={() => setViewingResponseAssignment(a)}
                                      icon="👁️"
                                    >
                                      View Answers
                                    </Button>
                                  ) : (
                                    <div className="w-24 text-center text-dim italic text-2xs pr-4 select-none">
                                      Awaiting reply
                                    </div>
                                  )}
                                  <Button
                                    variant="danger"
                                    small
                                    onClick={() => handleDeleteAssignment(a)}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* VIEW 2: QUESTION BREAKDOWN MODE */}
              {respViewMode === 'question' && (() => {
                const selectedTemplate = respTemplateFilter !== 'all'
                  ? forms.find(f => f.id === respTemplateFilter)
                  : forms[0] || null

                if (!selectedTemplate) {
                  return (
                    <div className="py-20 text-center flex flex-col items-center bg-card border border-app rounded-2xl">
                      <span className="text-4xl mb-3">📊</span>
                      <h3 className="text-sm font-semibold text-muted">No form template available</h3>
                      <p className="text-2xs text-dim mt-1">Please select or create a form template to see question breakdown</p>
                    </div>
                  )
                }

                const formCompleted = assignments.filter(a => a.formId === selectedTemplate.id && a.status === 'completed')

                return (
                  <div className="flex flex-col gap-6 max-w-4xl mx-auto">
                    <div className="bg-card border border-app rounded-2xl p-5 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-accent tracking-wider">Grouped Question Breakdown</span>
                        <h2 className="text-base font-bold text-primary leading-tight mt-0.5">{selectedTemplate.title}</h2>
                        <p className="text-xs text-dim mt-1">{formCompleted.length} total teacher response(s) submitted</p>
                      </div>
                      <select
                        value={selectedTemplate.id}
                        onChange={e => setRespTemplateFilter(e.target.value)}
                        className="bg-raised border border-app rounded-xl px-3 py-2 text-xs text-primary outline-none focus:border-accent"
                      >
                        {forms.map(f => (
                          <option key={f.id} value={f.id}>{f.title}</option>
                        ))}
                      </select>
                    </div>

                    {selectedTemplate.fields?.map((field, qIdx) => (
                      <div key={field.id} className="bg-card border border-app rounded-2xl p-5 flex flex-col gap-4 shadow-sm">
                        <div className="flex items-center justify-between border-b border-app/60 pb-3">
                          <h3 className="text-sm font-bold text-primary">
                            <span className="text-accent">{qIdx + 1}.</span> {field.label}
                          </h3>
                          <span className="text-3xs font-bold text-muted bg-raised px-2.5 py-1 rounded-full border border-app uppercase">
                            {field.type}
                          </span>
                        </div>
                        <div className="flex flex-col gap-2.5">
                          {formCompleted.length === 0 ? (
                            <p className="text-xs text-dim italic py-2">No completed responses submitted yet for this form template.</p>
                          ) : (
                            formCompleted.map(a => {
                              const val = a.responses?.[field.id]
                              const teacher = instructors.find(i => i.id === a.teacherId)
                              return (
                                <div key={a.id} className="bg-raised border border-app rounded-xl p-3 flex items-start gap-3">
                                  <Avatar
                                    firstName={teacher?.firstName || a.teacherName.split(' ')[0]}
                                    lastName={teacher?.lastName || a.teacherName.split(' ')[1]}
                                    color={teacher?.color}
                                    photo={teacher?.photo}
                                    size={28}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-bold text-primary">{a.teacherName}</span>
                                      <span className="text-3xs text-dim">{formatDate(a.submittedAt)}</span>
                                    </div>
                                    <div className="mt-1 text-xs text-primary font-medium">
                                      {field.type === 'checkbox' ? (
                                        <span className={val ? 'text-emerald-400 font-bold' : 'text-danger font-bold'}>
                                          {val ? '✅ Yes / Agreed' : '❌ No / Disagreed'}
                                        </span>
                                      ) : (
                                        val || <span className="text-dim italic">Blank / No answer</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            })
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}

            </div>
          </div>
        )}
      </div>

      {/* ── MODAL 1: SEND FORM ── */}
      {sendModalTemplate && (
        <Modal onClose={() => setSendModalTemplate(null)} width="max-w-lg">
          <ModalHeader title={`✉️ Send Form: ${sendModalTemplate.title}`} onClose={() => setSendModalTemplate(null)} />
          
          <p className="text-xs text-dim mb-4 leading-normal">
            Select which teachers you want to dispatch this form template to. We will deliver a notification in their Forms tab.
          </p>

          <div className="mb-4 flex gap-2">
            <input
              type="text"
              value={sendTeacherSearch}
              onChange={e => setSendTeacherSearch(e.target.value)}
              placeholder="🔍 Search teachers by name..."
              className="flex-1 bg-raised border border-app rounded-xl px-4 py-2 text-xs text-primary placeholder:text-dim outline-none focus:border-accent"
            />
            <Button
              variant="default"
              small
              onClick={() => handleToggleSelectAll(filteredTeachersForSend)}
            >
              Toggle Visible All
            </Button>
          </div>

          <div className="max-h-60 overflow-y-auto border border-app rounded-xl bg-raised p-2 flex flex-col gap-1.5">
            {filteredTeachersForSend.length === 0 ? (
              <div className="py-8 text-center text-xs text-dim">
                No matching instructors found in directory.
              </div>
            ) : (
              filteredTeachersForSend.map(t => {
                const isSelected = sendSelectedTeachers.includes(t.id)
                return (
                  <label
                    key={t.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-card border border-transparent hover:border-app cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        if (isSelected) {
                          setSendSelectedTeachers(sendSelectedTeachers.filter(id => id !== t.id))
                        } else {
                          setSendSelectedTeachers([...sendSelectedTeachers, t.id])
                        }
                      }}
                      className="w-4 h-4 accent-accent rounded border-app bg-raised cursor-pointer"
                    />
                    <Avatar firstName={t.firstName} lastName={t.lastName} color={t.color} photo={t.photo} size={24} />
                    <span className="text-xs font-semibold text-primary">{t.firstName} {t.lastName}</span>
                  </label>
                )
              })
            )}
          </div>

          <ModalFooter>
            <Button variant="ghost" onClick={() => setSendModalTemplate(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleSendForms}
              disabled={sendSelectedTeachers.length === 0}
              icon="✉️"
            >
              Send Form ({sendSelectedTeachers.length})
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {/* ── MODAL 2: VIEW COMPLETED RESPONSE ANSWERS WITH RAPID CAROUSEL ── */}
      {viewingResponseAssignment && (
        <Modal onClose={() => setViewingResponseAssignment(null)} width="max-w-xl">
          <ModalHeader
            title={`👁️ Answers: ${viewingResponseAssignment.teacherName}`}
            onClose={() => setViewingResponseAssignment(null)}
          />

          {/* Carousel Navigation Header */}
          <div className="flex items-center justify-between mb-3 bg-raised border border-app rounded-xl px-3.5 py-2">
            <span className="text-2xs text-muted font-bold">
              Submission {currentRespIdx + 1} of {completedAssignmentsList.length}
            </span>
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                small
                disabled={currentRespIdx <= 0}
                onClick={() => handleNavigateResp('prev')}
              >
                ‹ Prev
              </Button>
              <Button
                variant="ghost"
                small
                disabled={currentRespIdx >= completedAssignmentsList.length - 1}
                onClick={() => handleNavigateResp('next')}
              >
                Next ›
              </Button>
            </div>
          </div>

          <div className="mb-4 bg-raised border border-app rounded-xl p-3.5">
            <span className="text-[10px] uppercase font-bold text-accent tracking-wider">Form Template Title</span>
            <h4 className="text-sm font-bold text-primary leading-tight mt-0.5">{viewingResponseAssignment.formTitle}</h4>
            {viewingResponseAssignment.formDescription && (
              <p className="text-2xs text-dim mt-1.5 leading-relaxed">{viewingResponseAssignment.formDescription}</p>
            )}
            <div className="border-t border-app/60 pt-2 mt-3 flex items-center justify-between text-3xs text-muted">
              <span>Sent: {formatDate(viewingResponseAssignment.assignedAt)}</span>
              <span>Submitted: {formatDate(viewingResponseAssignment.submittedAt)}</span>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto flex flex-col gap-4">
            {viewingResponseAssignment.fields?.map((field, idx) => {
              const val = viewingResponseAssignment.responses[field.id]
              return (
                <div key={field.id} className="border-b border-app/30 pb-3.5 last:border-none last:pb-0">
                  <label className="block text-2xs font-bold text-muted mb-1.5">
                    {idx + 1}. {field.label}
                  </label>

                  {field.type === 'text' && (
                    <div className="bg-raised border border-app rounded-xl px-3.5 py-1.5 text-xs text-primary font-medium">
                      {val || <span className="text-dim italic">Blank / No answer</span>}
                    </div>
                  )}

                  {field.type === 'textarea' && (
                    <div className="bg-raised border border-app rounded-xl px-3.5 py-2 text-xs text-primary font-medium leading-relaxed whitespace-pre-wrap">
                      {val || <span className="text-dim italic">Blank / No answer</span>}
                    </div>
                  )}

                  {field.type === 'checkbox' && (
                    <div className="flex items-center gap-2">
                      <span className="text-base">{val ? '✅' : '❌'}</span>
                      <span className={`text-xs font-bold ${val ? 'text-emerald-400' : 'text-danger'}`}>
                        {val ? 'Yes / Agreed' : 'No / Disagreed'}
                      </span>
                    </div>
                  )}

                  {field.type === 'select' && (
                    <div className="bg-raised border border-app rounded-xl px-3.5 py-1.5 text-xs text-primary font-medium">
                      {val || <span className="text-dim italic">Blank / None selected</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <ModalFooter>
            <Button variant="default" onClick={() => setViewingResponseAssignment(null)}>Close</Button>
          </ModalFooter>
        </Modal>
      )}

    </div>
  )
}
