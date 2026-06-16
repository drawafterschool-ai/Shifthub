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

const useScheduleStore = create((set, get) => ({
  rawShifts:      [],
  schedule:       {},   // grouped: { [ownerId]: { [dateKey]: Shift[] } }
  jobs:           [],
  savedTemplates: [],
  loading:        true,
  _unsubs:        [],

  init() {
    // Load from cache if exists
    try {
      const cachedShifts = localStorage.getItem('shifthub_rawShifts')
      const cachedJobs = localStorage.getItem('shifthub_jobs')
      const cachedTemplates = localStorage.getItem('shifthub_savedTemplates')
      
      const updateObj = {}
      let hasCachedData = false
      if (cachedShifts) {
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

    // Listen to shifts
    const unsubShifts = onSnapshot(collection(db, 'shifts'), (snap) => {
      const shifts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      set({ rawShifts: shifts, schedule: groupShifts(shifts), loading: false })
      try {
        localStorage.setItem('shifthub_rawShifts', JSON.stringify(shifts))
      } catch (e) {
        console.warn('Error saving shifts to cache:', e)
      }
    })

    // Listen to company settings (jobs + templates)
    const unsubSettings = onSnapshot(doc(db, 'settings', 'company'), (snap) => {
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

    set((s) => ({ _unsubs: [...s._unsubs, unsubShifts, unsubSettings] }))
  },

  cleanup() {
    get()._unsubs.forEach(fn => fn())
    set({ _unsubs: [] })
  },

  // ── Series lookup ──────────────────────────────────────────────────
  async getRelatedShifts(ref) {
    if (ref.seriesId) {
      const snap = await getDocs(query(collection(db, 'shifts'), where('seriesId', '==', ref.seriesId)))
      if (snap.docs.length > 1) return snap.docs
    }
    if (ref.title && ref.start) {
      const snap = await getDocs(query(
        collection(db, 'shifts'),
        where('title', '==', ref.title),
        where('start', '==', ref.start),
      ))
      if (snap.docs.length > 0) return snap.docs
    }
    const snap = await getDocs(query(collection(db, 'shifts'), where('id', '==', ref.id)))
    return snap.docs
  },

  // ── Move (drag & drop) ─────────────────────────────────────────────
  async moveShift(shiftId, toOwner, toDate, notify, instructors, sms) {
    const isUnassigned = toOwner === UNASSIGNED
    await updateDoc(doc(db, 'shifts', shiftId), {
      date:                toDate,
      instructorId:        isUnassigned ? null : toOwner,
      claimable:           false,   // drag to unassigned = draft, NOT open shift
      confirmationStatus:  isUnassigned ? null : 'pending',
    })
    if (notify) {
      const { _sendNotifications } = get()
      await _sendNotifications({ toOwner, toDate, shiftId, isUnassigned, instructors, sms })
    }
  },

  // ── Confirm Shift (on behalf of teacher) ───────────────────────────
  async confirmShift(shiftId) {
    await updateDoc(doc(db, 'shifts', shiftId), {
      status:             'published',
      confirmationStatus: 'confirmed',
    })
  },

  // ── Save (from ShiftPanel) ─────────────────────────────────────────
  async saveShift(updatedShift, dates, action, scope, ctxShift, ctxDateKey, isNew, instructors, sms) {
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
        if (wasConfirmed && !dayOrTimeChanged) {
          updatedShift.confirmationStatus = 'confirmed'
        } else {
          updatedShift.confirmationStatus = 'pending'
        }
      }
    }

    if ((scope === 'all' || scope === 'future') && ctxShift) {
      const related = await get().getRelatedShifts(ctxShift)
      related.forEach(ds => {
        const s = ds.data()
        const inScope = scope === 'all' || (scope === 'future' && s.date >= ctxDateKey)
        if (inScope) {
          let sConfirmationStatus = s.confirmationStatus
          if (action === 'publish') {
            if (updatedShift.claimable) {
              sConfirmationStatus = null
            } else if (updatedShift.instructorId) {
              const sWasConfirmed = s.confirmationStatus === 'confirmed'
              if (sWasConfirmed && !dayOrTimeChanged) {
                sConfirmationStatus = 'confirmed'
              } else {
                sConfirmationStatus = 'pending'
              }
            }
          }
          batch.update(ds.ref, { 
            ...updatedShift, 
            id: s.id, 
            date: s.date,
            confirmationStatus: sConfirmationStatus
          })
        }
      })
    } else {
      const allDates = Array.isArray(dates) ? dates : [ctxDateKey || updatedShift.date]
      allDates.forEach((dateKey, idx) => {
        if (idx === 0 && !isNew) {
          batch.set(doc(db, 'shifts', updatedShift.id), { ...updatedShift, date: dateKey })
        } else {
          const newId = uid()
          batch.set(doc(db, 'shifts', newId), { ...updatedShift, id: newId, date: dateKey })
        }
      })
    }

    await batch.commit()

    // Post-save notifications — wrapped so they NEVER cause "error saving"
    // The shift is already saved at this point; notification failures are non-fatal.
    if (action === 'publish' && instructors && sms) {
      try {
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
            })
          }
        }
      } catch (notifErr) {
        // Log but don't rethrow — shift was saved successfully
        console.warn('Post-save notification failed (non-fatal):', notifErr)
      }
    }
  },

  // ── Delete ─────────────────────────────────────────────────────────
  async deleteShift(shift, scope, ctxDateKey) {
    if (scope === 'single') {
      await deleteDoc(doc(db, 'shifts', shift.id))
      await createNotification({ type: 'shift_deleted', forAdmin: true, actorName: 'Admin', shiftTitle: shift.title || 'Shift', shiftDate: shift.date })
      return 1
    }
    const related = await get().getRelatedShifts(shift)
    const batch   = writeBatch(db)
    let   count   = 0
    related.forEach(ds => {
      const s = ds.data()
      const inScope = scope === 'all' || (scope === 'future' && s.date >= (ctxDateKey || shift.date))
      if (inScope) { batch.delete(ds.ref); count++ }
    })
    await batch.commit()
    if (count > 0) await createNotification({ type: 'shift_deleted', forAdmin: true, actorName: 'Admin', shiftTitle: shift.title || 'Shift', shiftDate: shift.date, message: `${count} shift${count !== 1 ? 's' : ''} deleted` })
    return count
  },

  // ── Chip actions ───────────────────────────────────────────────────
  async duplicateShift(shift) {
    const newId = uid()
    await setDoc(doc(db, 'shifts', newId), { ...shift, id: newId, seriesId: uid() })
  },

  async multiDupShift(shift, count) {
    const batch = writeBatch(db)
    for (let i = 0; i < count; i++) {
      const newId = uid()
      batch.set(doc(db, 'shifts', newId), { ...shift, id: newId, seriesId: uid() })
    }
    await batch.commit()
  },

  async unassignShift(shift) {
    await updateDoc(doc(db, 'shifts', shift.id), {
      instructorId: null, claimable: false, confirmationStatus: null,
    })
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
