require('dotenv').config();
const { initSchema } = require('../src/setup');
const db = require('../src/config/database');
(async () => {
  try { await initSchema(); console.log('Database schema applied successfully'); }
  catch (e) { console.error('Database initialisation failed:', e.message); process.exitCode = 1; }
  finally { await db.end(); }
})();
