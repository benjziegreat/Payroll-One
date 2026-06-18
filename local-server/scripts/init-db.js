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
  await connection.end();
  console.log('payroll_one schema applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
