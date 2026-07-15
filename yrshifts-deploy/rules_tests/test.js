const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, query, where, getDocs, collection, addDoc } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

async function runTests() {
  console.log('🧪 Initializing rules test environment...');
  const rulesPath = path.resolve(__dirname, '../firestore.rules');
  const rules = fs.readFileSync(rulesPath, 'utf8');
  
  const testEnv = await initializeTestEnvironment({
    projectId: 'yrshifts-rules-test-project',
    firestore: {
      rules: rules,
      host: '127.0.0.1',
      port: 8080
    }
  });

  // Reset database state
  await testEnv.clearFirestore();

  // Initialize database with mock users, chats, and shifts
  console.log('⚙️ Writing mock databases data...');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    
    // isSignedIn check depends on settings/company trialExpiresAt (write as native Date)
    await setDoc(doc(db, 'settings', 'company'), {
      trialExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) // 7 days in future
    });

    // Write mock users
    await setDoc(doc(db, 'users', 'admin-id'), { id: 'admin-id', role: 'admin', firstName: 'Admin', lastName: 'User' });
    await setDoc(doc(db, 'users', 'teacher-a'), { id: 'teacher-a', role: 'teacher', firstName: 'Teacher', lastName: 'A' });
    await setDoc(doc(db, 'users', 'teacher-b'), { id: 'teacher-b', role: 'teacher', firstName: 'Teacher', lastName: 'B' });

    // Write chats
    await setDoc(doc(db, 'chats', 'chat-1'), { id: 'chat-1', members: ['admin-id', 'teacher-a'], isGroup: false });
    await setDoc(doc(db, 'chats', 'chat-2'), { id: 'chat-2', members: ['admin-id', 'teacher-a', 'teacher-b'], isGroup: true });
    await setDoc(doc(db, 'chats', 'chat-3'), { id: 'chat-3', members: ['teacher-b', 'admin-id'], isGroup: false });
    await setDoc(doc(db, 'chats', 'chat-4'), { id: 'chat-4', members: ['admin-id', 'teacher-b'], isGroup: true });

    // Messages in chat-1
    await setDoc(doc(db, 'chats/chat-1/messages/msg-1'), { id: 'msg-1', authorId: 'teacher-a', text: 'Hello', createdAt: new Date() });
    await setDoc(doc(db, 'chats/chat-1/messages/msg-15'), { id: 'msg-15', authorId: 'teacher-a', text: 'Reactions test', createdAt: new Date(), reactions: {} });
    await setDoc(doc(db, 'chats/chat-1/messages/msg-17'), { id: 'msg-17', authorId: 'teacher-a', text: 'Delete test', createdAt: new Date() });

    // Write shifts
    await setDoc(doc(db, 'shifts', 'shift-1'), { id: 'shift-1', instructorId: 'teacher-a', claimable: false, title: 'Math class', note: 'Door code 1234', totalPay: 100 });
    await setDoc(doc(db, 'shifts', 'shift-2'), { id: 'shift-2', instructorId: null, claimable: true, title: 'Art class', note: 'Door code 5678', totalPay: 80 });
    await setDoc(doc(db, 'shifts', 'shift-3'), { id: 'shift-3', instructorId: 'teacher-b', claimable: false, title: 'Science class', note: 'Door code 9999', totalPay: 120 });
    await setDoc(doc(db, 'shifts', 'shift-6'), { id: 'shift-6', instructorId: 'teacher-a', claimable: false, title: 'Confirm test' });
    await setDoc(doc(db, 'shifts', 'shift-7'), { id: 'shift-7', instructorId: null, claimable: true, title: 'Claim test' });
    await setDoc(doc(db, 'shifts', 'shift-8'), { id: 'shift-8', instructorId: 'teacher-a', claimable: false, title: 'Pay edit test', totalPay: 100 });
    await setDoc(doc(db, 'shifts', 'shift-9'), { id: 'shift-9', instructorId: 'teacher-a', claimable: false, title: 'Title edit test' });

    // Write notifications
    await setDoc(doc(db, 'notifications', 'notif-a'), { id: 'notif-a', recipientId: 'teacher-a', type: 'first_login', status: 'unread' });
    await setDoc(doc(db, 'notifications', 'notif-b'), { id: 'notif-b', recipientId: 'teacher-b', type: 'buzz_comment', status: 'unread' });

    // Write buzz posts
    await setDoc(doc(db, 'weekly_buzz', 'post-1'), { id: 'post-1', title: 'Buzz post 1', seenBy: [], likes: [], comments: [] });
    await setDoc(doc(db, 'weekly_buzz', 'post-37'), { id: 'post-37', title: 'Like test', seenBy: [], likes: [], comments: [] });
    await setDoc(doc(db, 'weekly_buzz', 'post-38'), { id: 'post-38', title: 'Like other test', seenBy: [], likes: [], comments: [] });
    await setDoc(doc(db, 'weekly_buzz', 'post-39'), { id: 'post-39', title: 'Wipe likes test', seenBy: [], likes: ['teacher-b'], comments: [] });
    await setDoc(doc(db, 'weekly_buzz', 'post-40'), { id: 'post-40', title: 'SeenBy test', seenBy: [], likes: [], comments: [] });
    await setDoc(doc(db, 'weekly_buzz', 'post-41'), { id: 'post-41', title: 'SeenBy other test', seenBy: [], likes: [], comments: [] });
    await setDoc(doc(db, 'weekly_buzz', 'post-42'), { id: 'post-42', title: 'Comment test', seenBy: [], likes: [], comments: [] });
    await setDoc(doc(db, 'weekly_buzz', 'post-43'), { id: 'post-43', title: 'Comment spoof test', seenBy: [], likes: [], comments: [{ id: 'c1', userId: 'teacher-a', userName: 'Teacher A', text: 'Nice!', createdAt: Date.now() }] });
    await setDoc(doc(db, 'weekly_buzz', 'post-44'), { id: 'post-44', title: 'Comment wipe test', seenBy: [], likes: [], comments: [{ id: 'c1', userId: 'teacher-a', userName: 'Teacher A', text: 'Nice!', createdAt: Date.now() }] });
    await setDoc(doc(db, 'weekly_buzz', 'post-45'), { id: 'post-45', title: 'Title edit teacher test', seenBy: [], likes: [], comments: [] });
    await setDoc(doc(db, 'weekly_buzz', 'post-46'), { id: 'post-46', title: 'Title edit admin test', seenBy: [], likes: [], comments: [] });

    // Write events
    await setDoc(doc(db, 'events', 'event-1'), { id: 'event-1', title: 'Summer Party', rsvps: {} });
    await setDoc(doc(db, 'events', 'event-47'), { id: 'event-47', title: 'RSVP test', rsvps: {} });
    await setDoc(doc(db, 'events', 'event-48'), { id: 'event-48', title: 'RSVP clear test', rsvps: { 'teacher-a': 'going' } });
    await setDoc(doc(db, 'events', 'event-49'), { id: 'event-49', title: 'RSVP other test', rsvps: {} });
    await setDoc(doc(db, 'events', 'event-50'), { id: 'event-50', title: 'RSVP wipe test', rsvps: {} });
  });

  // Instantiate client auth contexts
  const adminDb = testEnv.authenticatedContext('admin-id').firestore();
  const teacherADb = testEnv.authenticatedContext('teacher-a').firestore();
  const teacherBDb = testEnv.authenticatedContext('teacher-b').firestore();
  const unauthDb = testEnv.unauthenticatedContext().firestore();

  let passed = 0;
  let failed = 0;

  async function assertSuccess(promise, desc) {
    try {
      await assertSucceeds(promise);
      console.log(`✅ PASS: ${desc}`);
      passed++;
    } catch (e) {
      console.error(`❌ FAIL: ${desc}\n`, e.message);
      failed++;
    }
  }

  async function assertFailure(promise, desc) {
    try {
      await assertFails(promise);
      console.log(`✅ PASS: ${desc}`);
      passed++;
    } catch (e) {
      console.error(`❌ FAIL: ${desc}\n`, e.message);
      failed++;
    }
  }

  console.log('\n🏃 Running 71 rules assertions...\n');

  // ── CHATS & MESSAGES (19 Assertions) ───────────────────────────────────────
  console.log('--- Chats & Messages ---');
  await assertFailure(getDoc(doc(teacherBDb, 'chats', 'chat-1')), '1. Non-members cannot read DMs');
  await assertFailure(getDoc(doc(teacherADb, 'chats', 'chat-4')), '2. Non-members cannot read group chats');
  await assertFailure(getDoc(doc(teacherBDb, 'chats/chat-1/messages', 'msg-1')), '3. Non-members cannot read messages');
  await assertSuccess(getDoc(doc(teacherADb, 'chats', 'chat-1')), '4. Members can read DMs');
  await assertSuccess(getDoc(doc(teacherADb, 'chats', 'chat-2')), '5. Members can read group chats');
  await assertSuccess(getDoc(doc(teacherADb, 'chats/chat-1/messages', 'msg-1')), '6. Members can read messages');
  await assertSuccess(getDoc(doc(adminDb, 'chats', 'chat-1')), '7. Admin can read any chat');
  await assertSuccess(getDoc(doc(adminDb, 'chats/chat-1/messages', 'msg-1')), '8. Admin can read any message');
  
  await assertSuccess(
    addDoc(collection(teacherADb, 'chats'), { isGroup: false, members: ['teacher-a', 'admin-id'], name: '', lastMessage: '', lastAt: new Date() }),
    '9. Teacher DM create rule works'
  );
  await assertFailure(
    addDoc(collection(teacherADb, 'chats'), { isGroup: true, members: ['teacher-a', 'teacher-b'], name: 'Group' }),
    '10. Teacher group chat create fails'
  );
  await assertFailure(
    addDoc(collection(teacherADb, 'chats'), { isGroup: false, members: ['teacher-b', 'admin-id'], name: '' }),
    '11. Teacher self-excluding DM create fails'
  );
  await assertSuccess(
    addDoc(collection(teacherADb, 'chats/chat-1/messages'), { authorId: 'teacher-a', text: 'Hi', createdAt: new Date() }),
    '12. Message creation author check'
  );
  await assertFailure(
    addDoc(collection(teacherADb, 'chats/chat-1/messages'), { authorId: 'teacher-b', text: 'Impersonation', createdAt: new Date() }),
    '13. Message creation impersonation fails'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'chats/chat-1/messages', 'msg-1'), { text: 'Edited text' }),
    '14. Message content edit by author fails'
  );
  await assertSuccess(
    updateDoc(doc(teacherADb, 'chats/chat-1/messages', 'msg-15'), { reactions: { '👍': ['teacher-a'] } }),
    '15. Message edit reactions-only by member succeeds'
  );
  await assertFailure(
    updateDoc(doc(teacherBDb, 'chats/chat-1/messages', 'msg-15'), { reactions: { '👍': ['teacher-b'] } }),
    '16. Message edit reactions-only by non-member fails'
  );
  await assertSuccess(
    deleteDoc(doc(teacherADb, 'chats/chat-1/messages', 'msg-17')),
    '17. Message delete by author succeeds'
  );
  await assertFailure(
    deleteDoc(doc(teacherBDb, 'chats/chat-1/messages', 'msg-1')),
    '18. Message delete by non-author fails'
  );
  await assertSuccess(
    updateDoc(doc(teacherADb, 'chats', 'chat-1'), { lastMessage: 'Hello!', lastAt: new Date() }),
    '19. Chat update whitelist check succeeds'
  );

  // ── SHIFTS (9 Assertions) ──────────────────────────────────────────────────
  console.log('\n--- Shifts ---');
  await assertSuccess(getDoc(doc(teacherADb, 'shifts', 'shift-1')), '20. Teacher can read own shift');
  await assertSuccess(getDoc(doc(teacherADb, 'shifts', 'shift-2')), '21. Teacher can read open shift');
  await assertFailure(getDoc(doc(teacherADb, 'shifts', 'shift-3')), '22. Teacher cannot read other\'s shift (door code leak)');
  await assertSuccess(
    getDocs(query(collection(teacherADb, 'shifts'), where('instructorId', '==', 'teacher-a'))),
    '23. Teacher own shift query is provable'
  );
  await assertSuccess(
    getDocs(query(collection(teacherADb, 'shifts'), where('claimable', '==', true))),
    '24. Teacher open shift query is provable'
  );
  await assertSuccess(
    updateDoc(doc(teacherADb, 'shifts', 'shift-6'), { confirmationStatus: 'confirmed' }),
    '25. Teacher confirm flow succeeds'
  );
  await assertSuccess(
    updateDoc(doc(teacherADb, 'shifts', 'shift-7'), { instructorId: 'teacher-a', claimable: false, confirmationStatus: 'confirmed' }),
    '26. Teacher claim flow succeeds'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'shifts', 'shift-8'), { totalPay: 200 }),
    '27. Teacher cannot edit pay fields'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'shifts', 'shift-9'), { title: 'Hacked title', note: 'Hacked note' }),
    '28. Teacher cannot edit non-RSVP/non-claim fields'
  );

  // ── NOTIFICATIONS (7 Assertions) ───────────────────────────────────────────
  console.log('\n--- Notifications ---');
  await assertSuccess(getDoc(doc(teacherADb, 'notifications', 'notif-a')), '29. Teacher can read own notification');
  await assertFailure(getDoc(doc(teacherADb, 'notifications', 'notif-b')), '30. Teacher cannot read other\'s notification');
  await assertSuccess(
    updateDoc(doc(teacherADb, 'notifications', 'notif-a'), { status: 'read', readAt: Date.now() }),
    '31. Teacher can update own notification (mark read)'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'notifications', 'notif-b'), { status: 'read' }),
    '32. Teacher cannot update other\'s notification'
  );
  await assertSuccess(
    addDoc(collection(teacherADb, 'notifications'), { recipientId: 'admin', type: 'shift_released', status: 'unread', actorName: 'Teacher A', createdAt: Date.now() }),
    '33. Teacher can create release flow admin alert notification'
  );
  await assertSuccess(getDoc(doc(adminDb, 'notifications', 'notif-b')), '34. Admin can read any notification');
  await assertFailure(
    addDoc(collection(unauthDb, 'notifications'), { recipientId: 'admin', type: 'first_login', status: 'unread' }),
    '35. Unauthenticated user cannot create notification'
  );

  // ── BUZZ (11 Assertions) ───────────────────────────────────────────────────
  console.log('\n--- Buzz ---');
  await assertSuccess(getDoc(doc(teacherADb, 'weekly_buzz', 'post-1')), '36. Teacher can read buzz post');
  await assertSuccess(
    updateDoc(doc(teacherADb, 'weekly_buzz', 'post-37'), { likes: ['teacher-a'] }),
    '37. Teacher can like self (arrayUnion)'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'weekly_buzz', 'post-38'), { likes: ['teacher-b'] }),
    '38. Teacher cannot like for someone else'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'weekly_buzz', 'post-39'), { likes: [] }),
    '39. Teacher cannot wipe likes'
  );
  await assertSuccess(
    updateDoc(doc(teacherADb, 'weekly_buzz', 'post-40'), { seenBy: ['teacher-a'] }),
    '40. Teacher can mark seen (arrayUnion of own uid)'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'weekly_buzz', 'post-41'), { seenBy: ['teacher-b'] }),
    '41. Teacher cannot add someone else to seenBy'
  );
  await assertSuccess(
    updateDoc(doc(teacherADb, 'weekly_buzz', 'post-42'), {
      comments: [{ id: 'c1', userId: 'teacher-a', userName: 'Teacher A', text: 'Nice!', createdAt: Date.now() }]
    }),
    '42. Teacher can comment (appends comments array with own userId)'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'weekly_buzz', 'post-43'), {
      comments: [
        { id: 'c1', userId: 'teacher-a', userName: 'Teacher A', text: 'Nice!', createdAt: Date.now() },
        { id: 'c2', userId: 'teacher-b', userName: 'Teacher B', text: 'Spoofed!', createdAt: Date.now() }
      ]
    }),
    '43. Teacher cannot spoof comment authorship'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'weekly_buzz', 'post-44'), { comments: [] }),
    '44. Teacher cannot wipe comments (wiping protection check)'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'weekly_buzz', 'post-45'), { title: 'Hacked title' }),
    '45. Teacher cannot edit post content (title)'
  );
  await assertSuccess(
    updateDoc(doc(adminDb, 'weekly_buzz', 'post-46'), { title: 'Admin title update' }),
    '46. Admin can edit post content'
  );

  // ── EVENTS (4 Assertions) ──────────────────────────────────────────────────
  console.log('\n--- Events ---');
  await assertSuccess(
    updateDoc(doc(teacherADb, 'events', 'event-47'), { 'rsvps.teacher-a': 'going' }),
    '47. Teacher can set own RSVP'
  );
  await assertSuccess(
    updateDoc(doc(teacherADb, 'events', 'event-48'), { 'rsvps.teacher-a': null }),
    '48. Teacher can clear/null-toggle own RSVP'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'events', 'event-49'), { 'rsvps.teacher-b': 'going' }),
    '49. Teacher cannot set other\'s RSVP key'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'events', 'event-50'), { rsvps: { 'teacher-b': 'going' } }),
    '50. Teacher cannot overwrite whole RSVP map'
  );

  // ── USERS (4 Assertions) ───────────────────────────────────────────────────
  console.log('\n--- Users ---');
  await assertSuccess(getDoc(doc(teacherADb, 'users', 'teacher-b')), '51. Teacher can read user list');
  await assertSuccess(
    updateDoc(doc(teacherADb, 'users', 'teacher-a'), { firstName: 'Teacher A New' }),
    '52. Teacher can update own profile fields'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'users', 'teacher-a'), { role: 'admin' }),
    '53. Teacher cannot self-promote role to admin'
  );
  await assertFailure(
    updateDoc(doc(teacherADb, 'users', 'teacher-b'), { firstName: 'Hacked' }),
    '54. Teacher cannot update other\'s profile'
  );

  // ── MISC / ADMIN & SETUP (4 Assertions) ───────────────────────────────────
  console.log('\n--- Misc / Admin & Setup ---');
  await assertFailure(deleteDoc(doc(teacherADb, 'chats', 'chat-1')), '55. Chat deletion is admin-only');
  await assertSuccess(deleteDoc(doc(adminDb, 'chats', 'chat-1')), '56. Chat deletion succeeds for admin');
  await assertFailure(getDoc(doc(unauthDb, 'settings', 'company')), '57. Unauth user cannot read settings');
  await assertSuccess(getDoc(doc(teacherADb, 'settings', 'company')), '58. Authenticated user can read settings');


  // ── Notification creation hardening ─────────────────────────────────────
  console.log('\n🔔 Notification creation hardening');
  const notif = (db, data) => setDoc(doc(db, 'notifications', `n-${Math.random().toString(36).slice(2)}`),
    { status: 'unread', createdAt: Date.now(), ...data });

  await assertSuccess(notif(teacherADb, { type: 'shift_released', recipientId: 'admin', actorName: 'Teacher A', message: 'family emergency' }),
    '59. Teacher creates shift_released admin alert (release flow with note)');
  await assertSuccess(notif(teacherADb, { type: 'shift_declined', recipientId: 'admin', actorName: 'Teacher A' }),
    '60. Teacher creates shift_declined admin alert');
  await assertSuccess(notif(teacherADb, { type: 'form_submitted', recipientId: 'admin', actorName: 'Teacher A', formTitle: 'W-9' }),
    '61. Teacher creates form_submitted admin alert');
  await assertSuccess(notif(teacherADb, { type: 'first_login', recipientId: 'admin', actorName: 'Teacher A' }),
    '62. Teacher creates first_login admin alert');
  await assertSuccess(notif(teacherADb, { type: 'buzz_like', forAdmin: true, actorName: 'Teacher A', postId: 'p1' }),
    '63. Teacher creates buzz_like (forAdmin, no recipientId)');
  await assertSuccess(notif(adminDb, { type: 'shift_assigned', recipientId: 'teacher-b', shiftTitle: 'Elem Art' }),
    '64. Admin creates shift_assigned to a teacher (admin bypass)');
  await assertFailure(notif(teacherADb, { type: 'shift_assigned', recipientId: 'teacher-b', shiftTitle: 'Fake' }),
    '65. Teacher CANNOT forge shift_assigned to another teacher');
  await assertFailure(notif(teacherADb, { type: 'shift_released', recipientId: 'teacher-b' }),
    '66. Teacher CANNOT aim an alert type at another teacher');
  await assertFailure(notif(teacherADb, { type: 'buzz_like', actorName: 'Teacher A' }),
    '67. Teacher CANNOT create buzz_like without forAdmin flag');
  await assertFailure(notif(teacherADb, { type: 'shift_released', recipientId: 'admin', status: 'read' }),
    '68. Teacher CANNOT create a pre-read notification');

  // ── Availability & specific dates off (3 Assertions)
  await assertFailure(
    updateDoc(doc(teacherADb, 'users', 'teacher-a'), { hourlyTier: 'tier-2' }),
    '69. Teacher cannot self-edit payroll hourlyTier'
  );
  await assertSuccess(
    updateDoc(doc(teacherADb, 'users', 'teacher-a'), { unavailability: [{ day: 'Mon', start: '09:00', end: '17:00' }] }),
    '70. Teacher can edit own weekly availability slots'
  );
  await assertSuccess(
    updateDoc(doc(teacherADb, 'users', 'teacher-a'), { unavailableDates: ['2026-08-03'] }),
    '71. Teacher can edit own specific unavailable dates'
  );

  console.log('\n📋 TEST SUMMARY:');
  console.log(`✅ Passed: ${passed} / 71`);
  if (failed > 0) {
    console.error(`❌ Failed: ${failed} / 71`);
    process.exit(1);
  } else {
    console.log('🎉 All 71 security assertions passed successfully!');
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error('Fatal testing error:', e);
  process.exit(1);
});
