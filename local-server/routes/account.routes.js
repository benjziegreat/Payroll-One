const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../db');
const { requireUser } = require('../auth');

const router = express.Router();
const uploadsDir = path.join(__dirname, '..', 'uploads', 'avatars');
fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      cb(null, `${req.userId}-${crypto.randomUUID()}${ALLOWED_TYPES[file.mimetype]}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) cb(null, true);
    else cb(new Error('Only JPEG, PNG, or WebP images are allowed'));
  },
});

router.use(requireUser);

router.post('/photo', (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No photo uploaded' });
      return;
    }

    const [rows] = await pool.query('SELECT photo_url FROM users WHERE id = ?', [req.userId]);
    const previousPhotoUrl = rows[0]?.photo_url;

    const photoUrl = `/uploads/avatars/${req.file.filename}`;
    await pool.query('UPDATE users SET photo_url = ? WHERE id = ?', [photoUrl, req.userId]);

    if (previousPhotoUrl) {
      fs.unlink(path.join(__dirname, '..', previousPhotoUrl), () => {});
    }

    res.status(200).json({ photoUrl });
  });
});

module.exports = router;
