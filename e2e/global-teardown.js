const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../local-server/db');

// The e2e suite runs against local-server's real database (the same one
// mobile-dtr.intekn-app.com serves from) rather than a separate test DB, so
// the throwaway users it signs up need to be swept up afterward instead of
// accumulating there run after run.
module.exports = async function globalTeardown() {
  try {
    const [users] = await pool.query(
      "SELECT id FROM users WHERE email LIKE 'e2e-selfie-%@example.test'",
    );
    for (const user of users) {
      const [logs] = await pool.query(
        'SELECT selfie_url FROM attendance_logs WHERE user_id = ? AND selfie_url IS NOT NULL',
        [user.id],
      );
      for (const log of logs) {
        await fs
          .unlink(path.join(__dirname, '..', 'local-server', log.selfie_url.replace(/^\//, '')))
          .catch(() => {});
      }
      await pool.query('DELETE FROM attendance_logs WHERE user_id = ?', [user.id]);
      await pool.query('DELETE FROM users WHERE id = ?', [user.id]);
    }
  } finally {
    await pool.end();
  }
};
