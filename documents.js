/**
 * Driver document photo storage.
 *
 * Photos arrive from the frontend as base64 data URLs. This used to
 * write them to local disk under uploads/drivers/<driverId>/, with only
 * the file path stored in Postgres — but Render's (and most hosting
 * platforms') local disk does NOT survive a redeploy, meaning every
 * driver's ID and selfie photos were silently lost the next time this
 * app got updated. That's now fixed: the base64 data itself is stored
 * directly in Postgres, which does survive redeploys.
 *
 * getDocumentPath() is kept for any pre-existing records that still
 * only have an old disk path and no database-stored data — those
 * drivers will need to re-upload once, since their old on-disk photos
 * were already at risk of being wiped regardless of this change.
 */

const fs = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, 'uploads', 'drivers');

function validateDocumentDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Invalid image data');
  return dataUrl; // stored as-is in the database — no disk write needed anymore
}

// Legacy — only reachable for old records that predate database storage
function getDocumentPath(relativePath) {
  if (!relativePath) return null;
  const resolved = path.join(UPLOAD_ROOT, relativePath);
  if (!resolved.startsWith(UPLOAD_ROOT)) return null; // guard against path traversal via a malformed stored value
  return fs.existsSync(resolved) ? resolved : null;
}

module.exports = { validateDocumentDataUrl, getDocumentPath };
