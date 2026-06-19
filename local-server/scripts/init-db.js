require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await connection.query(schema);

  const [cols] = await connection.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS " +
      "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attendance_logs' AND COLUMN_NAME IN ('latitude', 'longitude')",
    [process.env.DB_NAME],
  );
  if (cols.length < 2) {
    await connection.query(
      'ALTER TABLE attendance_logs ADD COLUMN latitude DOUBLE NULL, ADD COLUMN longitude DOUBLE NULL',
    );
    console.log('Added latitude/longitude columns to attendance_logs.');
  }

  const [userCols] = await connection.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS " +
      "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME IN ('role', 'bypass_geofence', 'photo_url')",
    [process.env.DB_NAME],
  );
  const userColNames = userCols.map((row) => row.COLUMN_NAME);
  if (!userColNames.includes('role')) {
    await connection.query(
      "ALTER TABLE users ADD COLUMN role ENUM('employee', 'admin') NOT NULL DEFAULT 'employee'",
    );
    console.log('Added role column to users.');
  }
  if (!userColNames.includes('bypass_geofence')) {
    await connection.query(
      'ALTER TABLE users ADD COLUMN bypass_geofence TINYINT(1) NOT NULL DEFAULT 0',
    );
    console.log('Added bypass_geofence column to users.');
  }
  if (!userColNames.includes('photo_url')) {
    await connection.query('ALTER TABLE users ADD COLUMN photo_url VARCHAR(255) NULL');
    console.log('Added photo_url column to users.');
  }

  const [attendanceCols] = await connection.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS " +
      "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attendance_logs' AND COLUMN_NAME IN ('occurred_at', 'client_event_id')",
    [process.env.DB_NAME],
  );
  const attendanceColNames = attendanceCols.map((row) => row.COLUMN_NAME);
  if (!attendanceColNames.includes('occurred_at')) {
    await connection.query('ALTER TABLE attendance_logs ADD COLUMN occurred_at TIMESTAMP NULL');
    console.log('Added occurred_at column to attendance_logs.');
  }
  if (!attendanceColNames.includes('client_event_id')) {
    await connection.query(
      'ALTER TABLE attendance_logs ADD COLUMN client_event_id VARCHAR(36) NULL, ' +
        'ADD UNIQUE KEY uq_attendance_client_event (client_event_id)',
    );
    console.log('Added client_event_id column to attendance_logs.');
  }

  await connection.end();
  console.log('payroll_one schema applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
