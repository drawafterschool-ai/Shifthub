// c:\A\Shifthub\yrshifts-deploy\functions\integration_test.js
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// 1. CONSTRUCT FAUX/MOCK FIRESTORE DATABASE
// ─────────────────────────────────────────────────────────────────────────────
const mockUsers = {
  'teacher-1': {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane.doe@example.com',
    phone: '3125550199',
    role: 'teacher',
    fcmToken: 'fcm-token-jane-123'
  },
  'teacher-2': {
    firstName: 'John',
    lastName: 'Smith',
    email: 'john.smith@example.com',
    phone: '3125550188',
    role: 'teacher',
    fcmToken: null // Tests email-only path
  },
  'owner-1': {
    firstName: 'Alice',
    lastName: 'Admin',
    email: 'alice.admin@example.com',
    phone: '3125550100',
    role: 'owner',
    fcmToken: 'fcm-token-alice-admin'
  }
};

const mockShifts = {
  'shift-1': {
    id: 'shift-1',
    title: 'Beginner Drawing',
    date: '2026-05-28',
    start: '2:00 PM',
    end: '3:00 PM',
    instructorId: 'teacher-1',
    address: '123 Art Lane, Chicago IL',
    note: 'Bring charcoal pencils',
    status: 'published',
    claimable: false,
    confirmationStatus: null
  }
};

const mockDb = {
  collection: (colName) => {
    return {
      doc: (docId) => {
        return {
          get: async () => {
            let data = null;
            if (colName === 'users') data = mockUsers[docId];
            if (colName === 'shifts') data = mockShifts[docId];
            if (colName === 'reminders') data = null; // simulate new reminder
            return {
              exists: !!data,
              id: docId,
              data: () => data
            };
          },
          set: async (val) => {
            console.log(`💾 [Firestore Set] ${colName}/${docId}:`, JSON.stringify(val, null, 2));
            return { id: docId };
          },
          update: async (val) => {
            console.log(`💾 [Firestore Update] ${colName}/${docId}:`, JSON.stringify(val, null, 2));
            return { id: docId };
          }
        };
      },
      where: (field, op, val) => {
        return {
          where: (f2, o2, v2) => {
            // Support multiple where calls e.g., sendDayBeforeReminders
            return {
              get: async () => {
                let docs = [];
                if (colName === 'shifts') {
                  docs = Object.keys(mockShifts)
                    .map(k => ({ id: k, ...mockShifts[k] }))
                    .filter(s => s[field] === val && s[f2] === v2);
                }
                return {
                  docs: docs.map(d => ({
                    id: d.id,
                    data: () => d
                  }))
                };
              }
            };
          },
          get: async () => {
            let docs = [];
            if (colName === 'users') {
              docs = Object.keys(mockUsers)
                .map(k => ({ id: k, ...mockUsers[k] }))
                .filter(u => {
                  if (op === 'in') return val.includes(u[field]);
                  return u[field] === val;
                });
            }
            return {
              docs: docs.map(d => ({
                id: d.id,
                data: () => d
              }))
            };
          }
        };
      },
      add: async (val) => {
        console.log(`💾 [Firestore Add] ${colName}:`, JSON.stringify(val, null, 2));
        return { id: 'new-doc-id' };
      }
    };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. REGISTER MOCKS IN REQUIRE.CACHE FOR NODE LOADER
// ─────────────────────────────────────────────────────────────────────────────
const mockAdmin = {
  initializeApp: () => {
    console.log('⚙️  [Mock Firebase-Admin] Initialized');
  },
  firestore: () => mockDb,
  messaging: () => ({
    send: async (payload) => {
      console.log('⚡ [FCM Push Outbound]:');
      console.log(`   To Token: ${payload.token}`);
      console.log(`   Title:    ${payload.notification.title}`);
      console.log(`   Body:     ${payload.notification.body}`);
      return 'mock-message-id';
    }
  }),
  auth: () => ({
    // Mock user deletion/creation if called
    deleteUser: async (uid) => {
      console.log(`🔑 [Mock Auth Delete] User: ${uid}`);
    }
  })
};
mockAdmin.firestore.FieldValue = {
  serverTimestamp: () => '[SERVER_TIMESTAMP]'
};

require.cache[require.resolve('firebase-admin')] = {
  id: 'firebase-admin',
  filename: require.resolve('firebase-admin'),
  loaded: true,
  exports: mockAdmin
};

const mockNodemailer = {
  createTransport: () => ({
    sendMail: async (options) => {
      console.log('📧 [Email Outbound]:');
      console.log(`   To:      ${options.to}`);
      console.log(`   Subject: ${options.subject}`);
      console.log(`   Text:    ${options.text.replace(/\n/g, '\\n').substring(0, 120)}...`);
      if (options.attachments && options.attachments.length) {
        console.log(`   📎 Attachments (${options.attachments.length}):`);
        options.attachments.forEach(att => {
          console.log(`      - Filename: ${att.filename} (${att.contentType})`);
          console.log(`      - Content:\n${att.content.trim().split('\r\n').map(l => '        ' + l).join('\r\n')}`);
        });
      }
    }
  })
};

require.cache[require.resolve('nodemailer')] = {
  id: 'nodemailer',
  filename: require.resolve('nodemailer'),
  loaded: true,
  exports: mockNodemailer
};

const mockTwilio = (sid, token) => ({
  messages: {
    create: async (payload) => {
      console.log('📱 [SMS Outbound]:');
      console.log(`   From: ${payload.from}`);
      console.log(`   To:   ${payload.to}`);
      console.log(`   Body: ${payload.body.replace(/\n/g, '\\n')}`);
      return { sid: 'mock-sms-sid' };
    }
  }
});

require.cache[require.resolve('twilio')] = {
  id: 'twilio',
  filename: require.resolve('twilio'),
  loaded: true,
  exports: mockTwilio
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. SET MOCK ENVIRONMENT SECRETS
// ─────────────────────────────────────────────────────────────────────────────
process.env.SMTP_USER = 'shifthub.admin@gmail.com';
process.env.SMTP_PASS = 'abcd efgh ijkl mnop'; // 16-char app pass
process.env.TWILIO_SID = 'AC1234567890abcdef';
process.env.TWILIO_TOKEN = '1234567890abcdef1234567890abcdef';
process.env.TWILIO_FROM = '+15555550100';

// ─────────────────────────────────────────────────────────────────────────────
// 4. LOAD THE CLOUD FUNCTIONS INDEX
// ─────────────────────────────────────────────────────────────────────────────
console.log('⚡ Loading Cloud Functions index...');
const index = require('./index.js');
console.log('✅ Functions loaded successfully!');

// ─────────────────────────────────────────────────────────────────────────────
// 5. TEST SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────
async function runTests() {
  console.log('\n================================================================');
  console.log('SCENARIO 1: SHIFT ASSIGNED TRIGGER (onShiftChanged)');
  console.log('================================================================');
  // Mock Firebase Event for onShiftChanged (Newly Assigned Shift)
  const event1 = {
    params: { shiftId: 'shift-1' },
    data: {
      before: {
        data: () => null // Was unassigned/draft
      },
      after: {
        data: () => mockShifts['shift-1']
      }
    }
  };
  await index.onShiftChanged.run(event1);

  console.log('\n================================================================');
  console.log('SCENARIO 2: NEW WEEKLY BUZZ POST TRIGGER (onBuzzPostCreated)');
  console.log('================================================================');
  const event2 = {
    params: { postId: 'buzz-1' },
    data: {
      data: () => ({
        title: 'Weekly Training & Updates',
        content: '<p>Hi everyone,</p><p>We are hosting our annual <strong>Young Rembrandts</strong> training next Monday.</p><p>Please make sure to RSVP to the event in the app!</p><p>Best,</p><p>Sarah</p>',
        authorName: 'Sarah Smith'
      })
    }
  };
  await index.onBuzzPostCreated.run(event2);

  console.log('\n================================================================');
  console.log('SCENARIO 3: SCHEDULE REMINDER GENERATION (sendTwoHourReminders)');
  console.log('================================================================');
  // Temporarily adjust shift-1 time to start 2 hours from "now"
  const now = new Date();
  now.setMinutes(now.getMinutes() + 130); // 130 minutes in the future (within the 115-150 minute window)
  const futureHour = now.getHours() % 12 || 12;
  const futureMins = String(now.getMinutes()).padStart(2, '0');
  const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
  
  mockShifts['shift-1'].start = `${futureHour}:${futureMins} ${ampm}`;
  console.log(`Adjusted shift start time to: ${mockShifts['shift-1'].start} (Simulated ~2h window)`);

  await index.sendTwoHourReminders.run();

  console.log('\n================================================================');
  console.log('SCENARIO 4: IN-APP NOTIFICATION DELIVERY (onNotificationCreated)');
  console.log('================================================================');
  // In-app alert created for Admin
  const event4 = {
    params: { notifId: 'notif-1' },
    data: {
      data: () => ({
        type: 'shift_confirmed',
        recipientId: 'admin',
        forAdmin: true,
        actorName: 'Jane Doe',
        shiftDate: '2026-05-28',
        shiftStart: '2:00 PM',
        shiftTitle: 'Beginner Drawing',
        message: 'Jane Doe confirmed their shift',
        status: 'unread'
      })
    }
  };
  await index.onNotificationCreated.run(event4);

  console.log('\n================================================================');
  console.log('✅ ALL TEST SCENARIOS COMPLETED');
  console.log('================================================================');
}

runTests().catch(console.error);
