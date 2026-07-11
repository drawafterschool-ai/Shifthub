/**
 * scripts/backfill-chat-thumbnails.js
 * 
 * Setup & Execution:
 * 1. Go to Firebase Console -> Project Settings -> Service accounts
 * 2. Generate a new private key and save it to a secure location OUTSIDE the repo,
 *    e.g. C:\Users\young\Desktop\service-account.json
 * 3. Run:
 *    cd scripts
 *    npm install firebase-admin sharp uuid
 *    $env:GOOGLE_APPLICATION_CREDENTIALS="C:\Users\young\Desktop\service-account.json"
 *    node backfill-chat-thumbnails.js
 * 
 * To disable dry-run and apply changes:
 *    $env:DRY_RUN="false"
 *    node backfill-chat-thumbnails.js
 * 
 * IMPORTANT: Delete the service account JSON key file from your machine once finished!
 */

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Initialize Firebase Admin
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("Error: GOOGLE_APPLICATION_CREDENTIALS environment variable is not set.");
  console.error("Please point it to your service account JSON file.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.applicationDefault(),
  storageBucket: 'yrshifts.appspot.com'
});

const db = getFirestore();
const bucket = getStorage().bucket();

const DRY_RUN = process.env.DRY_RUN !== 'false';

const isImgAttachment = (a) => {
  if (a.type?.startsWith('image/')) return true;
  const ext = a.name?.split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext);
};

async function processAttachment(attachment, messageId) {
  if (!isImgAttachment(attachment)) return null;
  if (attachment.thumbUrl) {
    console.log(`  - Attachment "${attachment.name}" already has a thumbnail. Skipping.`);
    return null;
  }

  console.log(`  * Processing attachment "${attachment.name}"...`);

  const urlObj = new URL(attachment.url);
  const pathPart = urlObj.pathname.split('/o/')[1];
  if (!pathPart) {
    console.warn(`    WARNING: Could not parse storage path from URL: ${attachment.url}`);
    return null;
  }
  const storagePath = decodeURIComponent(pathPart);

  const tempDir = os.tmpdir();
  const originalTempPath = path.join(tempDir, `orig_${messageId}_${path.basename(storagePath)}`);
  const thumbTempPath = path.join(tempDir, `thumb_${messageId}_${path.basename(storagePath)}`);

  try {
    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would download ${storagePath} to resize.`);
      return { ...attachment, thumbUrl: attachment.url };
    }

    console.log(`    Downloading original from storage: ${storagePath}`);
    await bucket.file(storagePath).download({ destination: originalTempPath });

    const stats = fs.statSync(originalTempPath);
    console.log(`    Original file size: ${(stats.size / 1024).toFixed(1)} KB`);

    if (stats.size <= 150 * 1024) {
      console.log(`    Original is under 150 KB. Skipping thumbnail creation and reusing original URL.`);
      if (fs.existsSync(originalTempPath)) fs.unlinkSync(originalTempPath);
      return { ...attachment, thumbUrl: attachment.url };
    }

    console.log(`    Resizing to max 480px thumbnail...`);
    let quality = 80;
    let thumbBuffer;
    
    const image = sharp(originalTempPath).rotate().resize({
      width: 480,
      height: 480,
      fit: 'inside',
      withoutEnlargement: true
    });

    while (quality >= 20) {
      thumbBuffer = await image.jpeg({ quality }).toBuffer();
      if (thumbBuffer.length <= 120 * 1024) {
        break;
      }
      quality -= 10;
    }

    fs.writeFileSync(thumbTempPath, thumbBuffer);
    console.log(`    Thumbnail created at quality ${quality} (${(thumbBuffer.length / 1024).toFixed(1)} KB)`);

    const thumbFileName = `thumb_${path.basename(storagePath)}`;
    const thumbStoragePath = `chat_attachments/${thumbFileName}`;
    const token = uuidv4();

    console.log(`    Uploading thumbnail to: ${thumbStoragePath}`);
    await bucket.upload(thumbTempPath, {
      destination: thumbStoragePath,
      metadata: {
        contentType: 'image/jpeg',
        metadata: {
          firebaseStorageDownloadTokens: token
        }
      }
    });

    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(thumbStoragePath)}?alt=media&token=${token}`;
    console.log(`    Upload complete. thumbUrl generated.`);

    if (fs.existsSync(originalTempPath)) fs.unlinkSync(originalTempPath);
    if (fs.existsSync(thumbTempPath)) fs.unlinkSync(thumbTempPath);

    return {
      ...attachment,
      thumbUrl: publicUrl
    };

  } catch (error) {
    console.error(`    ERROR processing attachment "${attachment.name}":`, error);
    if (fs.existsSync(originalTempPath)) fs.unlinkSync(originalTempPath);
    if (fs.existsSync(thumbTempPath)) fs.unlinkSync(thumbTempPath);
    return null;
  }
}

async function run() {
  console.log("====================================================");
  console.log("  YRSHIFTS CHAT THUMBNAIL BACKFILL SCRIPT");
  console.log(`  Dry-Run Mode: ${DRY_RUN ? "ENABLED" : "DISABLED"}`);
  console.log("====================================================");

  try {
    const chatsSnap = await db.collection('chats').get();
    console.log(`Found ${chatsSnap.size} chats.`);

    let totalMessagesProcessed = 0;
    let totalAttachmentsUpdated = 0;
    let totalMessagesUpdated = 0;

    for (const chatDoc of chatsSnap.docs) {
      const chatId = chatDoc.id;
      const chatData = chatDoc.data();
      console.log(`\nChat: "${chatData.name || chatId}" (${chatId})`);

      const messagesSnap = await db.collection('chats').doc(chatId).collection('messages').get();
      console.log(`  Found ${messagesSnap.size} messages.`);

      for (const msgDoc of messagesSnap.docs) {
        const msgId = msgDoc.id;
        const msgData = msgDoc.data();
        totalMessagesProcessed++;

        if (!msgData.attachments || !msgData.attachments.length) continue;

        let attachmentsUpdated = false;
        const newAttachments = [];

        for (const attachment of msgData.attachments) {
          const updatedAttachment = await processAttachment(attachment, msgId);
          if (updatedAttachment) {
            newAttachments.push(updatedAttachment);
            attachmentsUpdated = true;
            totalAttachmentsUpdated++;
          } else {
            newAttachments.push(attachment);
          }
        }

        if (attachmentsUpdated) {
          if (!DRY_RUN) {
            console.log(`  -> Saving updated attachments for message ${msgId}...`);
            await db.collection('chats').doc(chatId).collection('messages').doc(msgId).update({
              attachments: newAttachments
            });
          } else {
            console.log(`  -> [DRY RUN] Would update message ${msgId} with new attachments.`);
          }
          totalMessagesUpdated++;
        }
      }
    }

    console.log("\n====================================================");
    console.log("  BACKFILL SUMMARY");
    console.log("====================================================");
    console.log(`Messages processed: ${totalMessagesProcessed}`);
    console.log(`Attachments updated: ${totalAttachmentsUpdated}`);
    console.log(`Messages updated: ${totalMessagesUpdated}`);
    console.log(`Dry-run was: ${DRY_RUN ? "ON" : "OFF"}`);
    console.log("====================================================");

  } catch (error) {
    console.error("Fatal Error running backfill:", error);
  }
}

run();
