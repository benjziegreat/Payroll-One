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

// MediaRecorder's actual mimeType is typically e.g.
// "video/webm;codecs=vp8,opus" — a bare lookup against SELFIE_TYPES would
// reject every real recording, since browsers essentially never omit the
// codecs parameter for webm/mp4 capture.
function baseMimeType(mimetype) {
  return (mimetype || '').split(';')[0].trim();
}

const uploadSelfie = multer({
  storage: multer.diskStorage({
    destination: selfiesDir,
    filename: (_req, file, cb) => {
      const extension = SELFIE_TYPES[baseMimeType(file.mimetype)] ?? '.webm';
      cb(null, `${crypto.randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (SELFIE_TYPES[baseMimeType(file.mimetype)]) cb(null, true);
    else cb(new Error('Only WebM, MP4, or QuickTime video is allowed'));
  },
});

module.exports = { uploadSelfie };
