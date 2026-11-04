const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./config/database');

// Create all tables (idempotent).
async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  for (const stmt of sql.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean)) await db.run(stmt);
}

function adminCreds() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password === 'CHANGE_THIS_BEFORE_FIRST_RUN' || password.length < 12)
    return null;
  return { email, password };
}

// Create the admin account from .env if it does not exist yet.
async function ensureAdmin() {
  const c = adminCreds();
  if (!c) return { created: false, reason: 'ADMIN_EMAIL / ADMIN_PASSWORD (12+ chars) not set in .env' };
  const existing = await db.one('SELECT id FROM staff_users WHERE lower(email)=lower(?)', [c.email]);
  if (existing) return { created: false, reason: 'already exists' };
  const hash = await bcrypt.hash(c.password, 12);
  await db.run(
    "INSERT INTO staff_users(id,email,display_name,password_hash,role) VALUES(?,lower(?),'Hotel Administrator',?,'admin')",
    [crypto.randomUUID(), c.email, hash]);
  return { created: true };
}

// Register a pre-approved device. force=true also re-approves an existing/blocked one.
async function ensureDevice(code, force = false) {
  if (!code || code.length < 8) throw new Error('Device code must be at least 8 characters');
  const admin = await db.one("SELECT id FROM staff_users WHERE lower(email)=lower(?) AND role='admin'", [process.env.ADMIN_EMAIL]);
  if (!admin) throw new Error('Create the admin account first (npm run admin:create)');
  const existing = await db.one('SELECT id,status FROM devices WHERE device_code=?', [code]);
  if (!existing) {
    await db.run(
      "INSERT INTO devices(id,device_code,device_name,platform,status,approved_by,approved_at) VALUES(?,?,'Initial Admin Device','web','approved',?,UTC_TIMESTAMP(3))",
      [crypto.randomUUID(), code, admin.id]);
  } else if (force) {
    await db.run("UPDATE devices SET status='approved',approved_by=?,approved_at=UTC_TIMESTAMP(3) WHERE id=?", [admin.id, existing.id]);
  }
  return db.one('SELECT id,device_code,status FROM devices WHERE device_code=?', [code]);
}

module.exports = { initSchema, ensureAdmin, ensureDevice };
