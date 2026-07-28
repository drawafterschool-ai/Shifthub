const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'yrshifts' });
}

async function run() {
  const db = admin.firestore();
  const snap = await db.collection('users').where('role', '==', 'teacher').get();
  console.log(`Checking ${snap.size} teachers for availability fields:`);
  snap.forEach(doc => {
    const data = doc.data();
    console.log(`Teacher: ${data.firstName} ${data.lastName} (${doc.id})`);
    console.log(`  unavailability: ${JSON.stringify(data.unavailability)}`);
    console.log(`  unavailableDates: ${JSON.stringify(data.unavailableDates)}`);
  });
}

run().catch(console.error);
