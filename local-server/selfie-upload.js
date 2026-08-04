const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// Shared by attendance.routes.js (authenticated) and kiosk.routes.js (public)
// — both attach a short video selfie to an already-created attendance log by
// clientEventId, so the storage/validation rules should stay identical.
const selfiesDir = path.join(__dirname, 'uploads', 'selfies');
fs.mkdirSync(selfiesDir, { recursive: true });

const SELFIE_TYPES = {
  'video/webm': '.webm',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

const uploadSelfie = multer({
  storage: multer.diskStorage({
    destination: selfiesDir,
    filename: (_req, file, cb) => {
      cb(null, `${crypto.randomUUID()}${SELFIE_TYPES[file.mimetype]}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (SELFIE_TYPES[file.mimetype]) cb(null, true);
    else cb(new Error('Only WebM, MP4, or QuickTime video is allowed'));
  },
});

module.exports = { uploadSelfie };
