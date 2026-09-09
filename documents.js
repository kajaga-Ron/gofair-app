/**
 * Driver document photo storage.
 *
 * Photos arrive from the frontend as base64 data URLs. Previously these
 * were embedded directly in the JSON "database" — workable for a demo,
 * but a real database shouldn't carry multi-megabyte base64 blobs in a
 * text column, and it's better practice to keep sensitive documents out
 * of the main database entirely.
 *
 * This version writes them to disk under uploads/drivers/<driverId>/ and
 * stores only the file path in Postgres. Serving happens through an
 * admin-authenticated route in server.js — this directory is NOT
 * publicly served as static files.
 *
 * PRODUCTION NOTE: local disk storage works for a single server instance
 * but won't survive a redeploy on most hosting platforms (Render/Railway
 * containers are ephemeral) and doesn't scale past one instance. Before
 * relying on this beyond testing, swap this module for Supabase Storage
 * (or S3) — same function signatures, different implementation. That's
 * a contained change: only this file needs to change, since drivers.js
 * just calls saveDocument()/getDocumentBuffer() without knowing how or
 * where the bytes actually live.
 */

const fs = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, 'uploads', 'drivers');

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp'
};

function saveDocument(driverId, field, dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error(`Invalid image data for ${field}`);
  const [, mime, base64] = match;
  const ext = MIME_EXT[mime] || 'bin';

  const dir = path.join(UPLOAD_ROOT, driverId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${field}.${ext}`);
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

  // stored relative to UPLOAD_ROOT so the root itself can move (e.g. to a mounted volume) without touching the DB
  return path.relative(UPLOAD_ROOT, filePath);
}

function getDocumentPath(relativePath) {
  if (!relativePath) return null;
  const resolved = path.join(UPLOAD_ROOT, relativePath);
  // guard against path traversal via a malformed stored value
  if (!resolved.startsWith(UPLOAD_ROOT)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}

module.exports = { saveDocument, getDocumentPath };
