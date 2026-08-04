import { create } from 'zustand'
import {
  collection, onSnapshot, doc,
  setDoc, updateDoc, deleteDoc,
  writeBatch, query, where, getDocs,
} from 'firebase/firestore'
import { db }              from '../utils/firebase'
import { uid }             from '../utils/helpers'
import { makeShift, groupShifts, UNASSIGNED } from '../utils/schedule'
import { createNotification } from '../utils/notifications'

let shiftsUnsub = null
let settingsUnsub = null
let visibilityHandlerAttached = false

function setupVisibilityHandler(get) {
  if (visibilityHandlerAttached || typeof window === 'undefined') return
  visibilityHandlerAttached = true

  const handleWake = () => {
    if (document.visibilityState === 'visible') {
      const state = get()
      if (state._initialized) {
        state.init(true) // Force re-sync listeners
      }
    }
  }

  window.addEventListener('visibilitychange', handleWake)
  window.addEventListener('online', handleWake)
}

const useScheduleStore = create((set, get) => ({
  rawShifts:      [],
  schedule:       {},   // grouped: { [ownerId]: { [dateKey]: Shift[] } }
  jobs:           [],
  savedTemplates: [],
  loading:        true,
  _initialized:   false,

  init(force = false) {
    setupVisibilityHandler(get)
    if (get()._initialized && !force) return
    set({ _initialized: true })

    // Load from cache if exists
    try {
      const cachedShifts = localStorage.getItem('shifthub_rawShifts')
      const cachedJobs = localStorage.getItem('shifthub_jobs')
      const cachedTemplates = localStorage.getItem('shifthub_savedTemplates')
      
      const updateObj = {}
      let hasCachedData = false
      if (cachedShifts && !force) {
        const shifts = JSON.parse(cachedShifts)
        updateObj.rawShifts = shifts
        updateObj.schedule = groupShifts(shifts)
        hasCachedData = true
      }
      if (cachedJobs) {
        updateObj.jobs = JSON.parse(cachedJobs)
      }
      if (cachedTemplates) {
        updateObj.savedTemplates = JSON.parse(cachedTemplates)
      }
      if (hasCachedData) {
        updateObj.loading = false
      }
      if (Object.keys(updateObj).length > 0) {
        set(updateObj)
      }
    } catch (e) {
      console.warn('Error loading cached schedule settings:', e)
    }

    if (shiftsUnsub) try { shiftsUnsub() } catch {}
    if (settingsUnsub) try { settingsUnsub() } catch {}

    // Listen to shifts
    shiftsUnsub = onSnapshot(collection(db, 'shifts'), (snap) => {
      const shifts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      set({ rawShifts: shifts, schedule: groupShifts(shifts), loading: false })
      try {
        localStorage.setItem('shifthub_rawShifts', JSON.stringify(shifts))
      } catch (e) {
        console.warn('Error saving shifts to cache:', e)
      }
    }, (err) => {
      console.error('Error listening to shifts collection:', err)
    })

    // Listen to company settings (jobs + templates)
    settingsUnsub = onSnapshot(doc(db, 'settings', 'company'), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        const jobs = d.jobs || []
        const templates = d.templates || []
        set({ jobs, savedTemplates: templates })
        try {
          localStorage.setItem('shifthub_jobs', JSON.stringify(jobs))
          localStorage.setItem('shifthub_savedTemplates', JSON.stringify(templates))
        } catch (e) {
          console.warn('Error saving company settings to cache:', e)
        }
      }
    })
  },

  cleanup() {
    if (shiftsUnsub) { try { shiftsUnsub() } catch {}; shiftsUnsub = null }
    if (settingsUnsub) { try { settingsUnsub() } catch {}; settingsUnsub = null }
    set({ _initialized: false, rawShifts: [], schedule: {}, loading: true })
  },

  // ── Series lookup ──────────────────────────────────────────────────
  async getRelatedShifts(ref) {
    const rawShifts = get().rawShifts || []
    if (ref.seriesId) {
      const siblings = rawShifts.filter(s => s.seriesId === ref.seriesId)
      if (siblings.length > 0) {
        return siblings.map(s => ({
          id: s.id,
          ref: doc(db, 'shifts', s.id),
          data: () => s
        }))
      }
    }
    if (ref.title && ref.start) {
      const matching = rawShifts.filter(s => s.title === ref.title && s.start === ref.start)
      if (matching.length > 0) {
        return matching.map(s => ({
          id: s.id,
          ref: doc(db, 'shifts', s.id),
          data: () => s
        }))
      }
    }
    const single = rawShifts.filter(s => s.id === ref.id)
    if (single.length > 0) {
      return single.map(s => ({
        id: s.id,
        ref: doc(db, 'shifts', s.id),
        data: () => s
      }))
    }
    const snap = await getDocs(query(collection(db, 'shifts'), where('id', '==', ref.id)))
    return snap.docs
  },

  // ── Move (drag & drop) ─────────────────────────────────────────────
  async moveShift(shiftId, toOwner, toDate, notify, instructors, sms) {
    const prevShifts = get().rawShifts
    const isUnassigned = toOwner === UNASSIGNED

    // 1. Instant optimistic update (0ms)
    const nextShifts = prevShifts.map(s => {
      if (s.id !== shiftId) return s
      return {
        ...s,
        date: toDate,
        instructorId: isUnassigned ? null : toOwner,
        claimable: false,
        confirmationStatus: isUnassigned ? null : 'pending',
      }
    })
    set({ rawShifts: nextShifts, schedule: groupShifts(nextShifts) })

    try {
      await updateDoc(doc(db, 'shifts', shiftId), {
        date:                toDate,
        instructorId:        isUnassigned ? null : toOwner,
        claimable:           false,
        confirmationStatus:  isUnassigned ? null : 'pending',
      })
      if (notify) {
        Promise.resolve().then(() => {
          get()._sendNotifications({ toOwner, toDate, shiftId, isUnassigned, instructors, sms })
        }).catch(e => console.warn('Non-fatal notify error:', e))
      }
    } catch (err) {
      console.error('moveShift error:', err)
      // Rollback
      set({ rawShifts: prevShifts, schedule: groupShifts(prevShifts) })
      throw err
    }
  },

  // ── Confirm Shift (on behalf of teacher) ───────────────────────────
  async confirmShift(shiftId) {
    const prevShifts = get().rawShifts
    const nextShifts = prevShifts.map(s => {
      if (s.id !== shiftId) return s
      return { ...s, status: 'published', confirmationStatus: 'confirmed' }
    })
    set({ rawShifts: nextShifts, schedule: groupShifts(nextShifts) })

    try {
      await updateDoc(doc(db, 'shifts', shiftId), {
        status:             'published',
        confirmationStatus: 'confirmed',
      })
    } catch (err) {
      console.error('confirmShift error:', err)
      set({ rawShifts: prevShifts, schedule: groupShifts(prevShifts) })
      throw err
    }
  },

  // ── Save (from ShiftPanel) ─────────────────────────────────────────
  async saveShift(updatedShift, dates, action, scope, ctxShift, ctxDateKey, isNew, instructors, sms) {
    const prevShifts = get().rawShifts
    const batch = writeBatch(db)

    const wasConfirmed = ctxShift && ctxShift.confirmationStatus === 'confirmed'
    const timeChanged = ctxShift && (updatedShift.start !== ctxShift.start || updatedShift.end !== ctxShift.end)
    const dayChanged = ctxShift && (updatedShift.date !== ctxShift.date)
    const dayOrTimeChanged = timeChanged || dayChanged

    if (action === 'publish') {
      if (updatedShift.claimable) {
        updatedShift.instructorId = null
        updatedShift.confirmationStatus = null
      } else if (updatedShift.instructorId) {
        const instructorChanged = ctxShift && (updatedShift.instructorId !== ctxShift.instructorId)
        if (wasConfirmed && !dayOrTimeChanged && !instructorChanged) {
          updatedShift.confirmationStatus = 'confirmed'
        } else {
          updatedShift.confirmationStatus = 'pending'
        }
      }
    }

    // Build optimistic nextShifts array
    let nextShifts = [...prevShifts]

    if ((scope === 'all' || scope === 'future') && ctxShift) {
      const activeInstructorChanged = ctxShift && (updatedShift.instructorId !== ctxShift.instructorId)
      const activeClaimableChanged = ctxShift && (updatedShift.claimable !== ctxShift.claimable)

      nextShifts = nextShifts.map(s => {
        const isTarget = s.id === updatedShift.id
        const isSeriesSibling = s.seriesId && s.seriesId === ctxShift.seriesId
        const isMatchingSibling = s.title === ctxShift.title && s.start === ctxShift.start
        const isSibling = isSeriesSibling || isMatchingSibling

        if (isTarget) {
          const res = { ...updatedShift, date: ctxDateKey || updatedShift.date }
          batch.set(doc(db, 'shifts', updatedShift.id), res)
          return res
        }

        if (isSibling) {
          const inScope = scope === 'all' || (scope === 'future' && s.date >= ctxDateKey)
          if (inScope) {
            let sInstructorId = s.instructorId
            let sClaimable = s.claimable
            let sConfirmationStatus = s.confirmationStatus

            const sharesOriginalInstructor = ctxShift && (s.instructorId === ctxShift.instructorId)

            if (sharesOriginalInstructor) {
              if (activeInstructorChanged || activeClaimableChanged) {
                sInstructorId = updatedShift.instructorId
                sClaimable = updatedShift.claimable
                if (sClaimable) {
                  sInstructorId = null
                  sConfirmationStatus = null
                } else if (sInstructorId) {
                  sConfirmationStatus = 'pending'
                }
              } else {
                if (sInstructorId && dayOrTimeChanged) {
                  sConfirmationStatus = 'pending'
                }
              }
            } else {
              if (sInstructorId && dayOrTimeChanged) {
                sConfirmationStatus = 'pending'
              }
            }

            const siblingUpdated = {
              ...updatedShift,
              id: s.id,
              date: s.date,
              instructorId: sInstructorId,
              claimable: sClaimable,
              confirmationStatus: sConfirmationStatus
            }
            batch.update(doc(db, 'shifts', s.id), siblingUpdated)
            return siblingUpdated
          }
        }

        return s
      })

    } else {
      if (!isNew && ctxShift) {
        const singleUpdated = { ...updatedShift, date: ctxDateKey || updatedShift.date }
        batch.set(doc(db, 'shifts', updatedShift.id), singleUpdated)
        const idx = nextShifts.findIndex(s => s.id === updatedShift.id)
        if (idx !== -1) nextShifts[idx] = singleUpdated
        else nextShifts.push(singleUpdated)
      } else {
        const allDates = Array.isArray(dates) ? dates : [ctxDateKey || updatedShift.date]
        allDates.forEach((dateKey, idx) => {
          if (idx === 0 && !isNew) {
            const firstUpdated = { ...updatedShift, date: dateKey }
            batch.set(doc(db, 'shifts', updatedShift.id), firstUpdated)
            const existIdx = nextShifts.findIndex(s => s.id === updatedShift.id)
            if (existIdx !== -1) nextShifts[existIdx] = firstUpdated
            else nextShifts.push(firstUpdated)
          } else {
            const newId = uid()
            const createdShift = { ...updatedShift, id: newId, date: dateKey }
            batch.set(doc(db, 'shifts', newId), createdShift)
            nextShifts.push(createdShift)
          }
        })
      }
    }

    // 1. Instant optimistic local UI update (0ms)
    set({ rawShifts: nextShifts, schedule: groupShifts(nextShifts) })

    try {
      // 2. Perform Firestore write batch
      await batch.commit()

      // 3. Non-blocking post-save notifications
      if (action === 'publish' && instructors && sms) {
        Promise.resolve().then(async () => {
          const firstDate = Array.isArray(dates) ? dates[0] : updatedShift.date
          if (updatedShift.claimable) {
            sms.send(instructors.map(i => ({ to: `${i.firstName} ${i.lastName}`, text: `Open shift on ${firstDate}` })))
          } else if (updatedShift.instructorId) {
            const inst = instructors.find(i => String(i.id) === String(updatedShift.instructorId))
            if (inst) {
              let smsText = 'You have new shift(s)'
              let notifMessageText = null
              let subjectText = null

              if (wasConfirmed) {
                if (dayOrTimeChanged) {
                  smsText = 'important changes to a shift you have already confirmed, please confirm again'
                  notifMessageText = 'important changes to a shift you have already confirmed, please confirm again'
                  subjectText = 'Important changes to confirmed shift — please confirm again'
                } else {
                  smsText = 'details added'
                  notifMessageText = 'details added'
                  subjectText = 'Shift details updated'
                }
              }

              sms.send([{ to: `${inst.firstName} ${inst.lastName}`, text: smsText }])
              await createNotification({
                type: 'shift_assigned', recipientId: String(inst.id),
                recipientName: inst.firstName, actorName: 'Admin',
                shiftId: updatedShift.id, shiftDate: updatedShift.date,
                shiftTitle: updatedShift.title || 'Shift',
                shiftStart: updatedShift.start, shiftEnd: updatedShift.end,
                forAdmin: false,
                message: notifMessageText,
                subject: subjectText,
              }).catch(() => {})
            }
          }
        }).catch(e => console.warn('Non-fatal post-save notification warning:', e))
      }
    } catch (err) {
      console.error('saveShift network error:', err)
      // Rollback to pre-save state on network failure
      set({ rawShifts: prevShifts, schedule: groupShifts(prevShifts) })
      throw err
    }
  },

  // ── Delete ─────────────────────────────────────────────────────────
  async deleteShift(shift, scope, ctxDateKey) {
    const prevShifts = get().rawShifts

    if (scope === 'single') {
      const nextShifts = prevShifts.filter(s => s.id !== shift.id)
      set({ rawShifts: nextShifts, schedule: groupShifts(nextShifts) })
      try {
        await deleteDoc(doc(db, 'shifts', shift.id))
        Promise.resolve().then(() => {
          createNotification({ type: 'shift_deleted', forAdmin: true, actorName: 'Admin', shiftTitle: shift.title || 'Shift', shiftDate: shift.date })
        }).catch(() => {})
        return 1
      } catch (err) {
        console.error('deleteShift single error:', err)
        set({ rawShifts: prevShifts, schedule: groupShifts(prevShifts) })
        throw err
      }
    }

    const related = await get().getRelatedShifts(shift)
    const batch   = writeBatch(db)
    let   count   = 0
    const deletedIds = new Set()

    related.forEach(ds => {
      const s = ds.data()
      const inScope = scope === 'all' || (scope === 'future' && s.date >= (ctxDateKey || shift.date))
      if (inScope) {
        batch.delete(ds.ref)
        deletedIds.add(s.id)
        count++
      }
    })

    const nextShifts = prevShifts.filter(s => !deletedIds.has(s.id))
    set({ rawShifts: nextShifts, schedule: groupShifts(nextShifts) })

    try {
      await batch.commit()
      if (count > 0) {
        Promise.resolve().then(() => {
          createNotification({ type: 'shift_deleted', forAdmin: true, actorName: 'Admin', shiftTitle: shift.title || 'Shift', shiftDate: shift.date, message: `${count} shift${count !== 1 ? 's' : ''} deleted` })
        }).catch(() => {})
      }
      return count
    } catch (err) {
      console.error('deleteShift scope error:', err)
      set({ rawShifts: prevShifts, schedule: groupShifts(prevShifts) })
      throw err
    }
  },

  // ── Chip actions ───────────────────────────────────────────────────
  async duplicateShift(shift) {
    const newId = uid()
    const newShift = { 
      ...shift, 
      id: newId, 
      seriesId: uid(),
      status: 'draft',
      confirmationStatus: null
    }

    const prevShifts = get().rawShifts
    const nextShifts = [...prevShifts, newShift]
    set({ rawShifts: nextShifts, schedule: groupShifts(nextShifts) })

    try {
      await setDoc(doc(db, 'shifts', newId), newShift)
    } catch (err) {
      console.error('duplicateShift error:', err)
      set({ rawShifts: prevShifts, schedule: groupShifts(prevShifts) })
      throw err
    }
  },

  async multiDupShift(shift, count) {
    const prevShifts = get().rawShifts
    const newShifts = []
    const batch = writeBatch(db)

    for (let i = 0; i < count; i++) {
      const newId = uid()
      const newShift = { 
        ...shift, 
        id: newId, 
        seriesId: uid(),
        status: 'draft',
        confirmationStatus: null
      }
      newShifts.push(newShift)
      batch.set(doc(db, 'shifts', newId), newShift)
    }

    const nextShifts = [...prevShifts, ...newShifts]
    set({ rawShifts: nextShifts, schedule: groupShifts(nextShifts) })

    try {
      await batch.commit()
    } catch (err) {
      console.error('multiDupShift error:', err)
      set({ rawShifts: prevShifts, schedule: groupShifts(prevShifts) })
      throw err
    }
  },

  async unassignShift(shift) {
    const prevShifts = get().rawShifts
    const nextShifts = prevShifts.map(s => {
      if (s.id !== shift.id) return s
      return { ...s, instructorId: null, claimable: false, confirmationStatus: null }
    })
    set({ rawShifts: nextShifts, schedule: groupShifts(nextShifts) })

    try {
      await updateDoc(doc(db, 'shifts', shift.id), {
        instructorId: null, claimable: false, confirmationStatus: null,
      })
    } catch (err) {
      console.error('unassignShift error:', err)
      set({ rawShifts: prevShifts, schedule: groupShifts(prevShifts) })
      throw err
    }
  },

  // ── Settings ───────────────────────────────────────────────────────
  async saveJobs(jobs) {
    await setDoc(doc(db, 'settings', 'company'), { jobs }, { merge: true })
  },

  async saveTemplates(templates) {
    await setDoc(doc(db, 'settings', 'company'), { templates }, { merge: true })
  },

  // ── Internal ───────────────────────────────────────────────────────
  async _sendNotifications({ toOwner, toDate, shiftId, isUnassigned, instructors, sms }) {
    if (isUnassigned) {
      sms.send(instructors.map(i => ({ to: `${i.firstName} ${i.lastName}`, text: `Open shift on ${toDate}` })))
    } else {
      const inst = instructors.find(i => String(i.id) === String(toOwner))
      if (inst) {
        sms.send([{ to: `${inst.firstName} ${inst.lastName}`, text: `New shift on ${toDate}` }])
        await createNotification({
          type: 'shift_assigned', recipientId: String(inst.id),
          recipientName: inst.firstName, actorName: 'Admin',
          shiftId, shiftDate: toDate, forAdmin: false,
        })
      }
    }
  },
}))

export default useScheduleStore
