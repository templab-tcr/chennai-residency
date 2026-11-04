require('dotenv').config();
const { ensureAdmin } = require('../src/setup');
const db = require('../src/config/database');
(async () => {
  try {
    const r = await ensureAdmin();
    if (!r.created && r.reason !== 'already exists') throw new Error(r.reason);
    console.log(r.created ? 'Admin account created.' : 'Admin account already exists.');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await db.end(); }
})();
