require('dotenv').config();
const { ensureDevice } = require('../src/setup');
const db = require('../src/config/database');
(async () => {
  try {
    const code = process.argv[2];
    if (!code) throw new Error('Usage: npm run device:bootstrap -- DEVICE_CODE (minimum 8 characters)');
    console.log('Initial admin device approved:', await ensureDevice(code, true));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await db.end(); }
})();
