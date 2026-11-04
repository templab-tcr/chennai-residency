const mysql = require('mysql2/promise');

// Connection settings: either DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME,
// or a single DATABASE_URL like mysql://user:pass@localhost:3306/dbname
function settings() {
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    return {
      host: u.hostname, port: Number(u.port || 3306),
      user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, ''))
    };
  }
  return {
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  };
}

const pool = mysql.createPool({
  ...settings(),
  charset: 'utf8mb4',
  timezone: 'Z',                 // read/write DATETIME values as UTC
  supportBigNumbers: true,
  connectionLimit: Number(process.env.DB_POOL || 5), // shared hosting caps connections; keep small
  waitForConnections: true,
  connectTimeout: 10000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined
});

// Make NOW()/CURRENT_TIMESTAMP UTC on every connection.
pool.on('connection', conn => conn.query("SET time_zone = '+00:00'"));

// Helpers
const rows = async (sql, params = []) => (await pool.query(sql, params))[0];
const one = async (sql, params = []) => (await rows(sql, params))[0];
const run = async (sql, params = []) => (await pool.query(sql, params))[0]; // ResultSetHeader
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    throw e;
  } finally { conn.release(); }
}
// JSON columns are LONGTEXT (MariaDB-safe); parse on the way out.
const parseJson = (v, fallback = null) => {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return fallback; }
};

module.exports = { pool, rows, one, run, tx, parseJson, end: () => pool.end() };
