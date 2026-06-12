const admin = require('firebase-admin');
admin.initializeApp({
  projectId: 'yrshifts'
});
const db = admin.firestore();

async function run() {
  try {
    const snap = await db.collection('notifications').where('forAdmin', '==', true).limit(10).get();
    console.log(`Fetched ${snap.size} admin notifications.`);
    snap.forEach(doc => {
      console.log(doc.id, doc.data());
    });
  } catch (e) {
    console.error('Error fetching notifications:', e);
  }
}
run();
