const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'yrshifts' });
}

async function run() {
  const db = admin.firestore();
  const snap = await db.collection('users').where('role', '==', 'teacher').limit(5).get();
  console.log(`Found ${snap.size} teachers:`);
  snap.forEach(doc => {
    console.log(`Teacher ID: ${doc.id}`);
    console.log(JSON.stringify(doc.data(), null, 2));
    console.log('-----------------------------------');
  });
}

run().catch(console.error);
