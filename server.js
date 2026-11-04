require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const api = require('./src/routes/api');
const db = require('./src/config/database');
const setup = require('./src/setup');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Passenger / cPanel / reverse proxy
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const origins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(x => x.trim()).filter(Boolean);
app.use(cors((req, cb) => {
  const origin = req.header('Origin');
  // allow: no Origin, listed origins, and the site's own host (same-origin requests)
  const ok = !origin || origins.includes(origin) || origin.replace(/^https?:\/\//, '') === req.headers.host;
  cb(ok ? null : new Error('Origin not allowed'), { origin: ok, credentials: true });
}));
app.use(express.json({ limit: '12mb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }));
app.use('/api', api);
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

app.use((err, req, res, next) => {
  if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.issues });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Record already exists' });
  const status = err.status || (err.message === 'Origin not allowed' ? 403 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

async function autoSetup() {
  if (process.env.AUTO_SETUP === 'false') return;
  try {
    await setup.initSchema();
    const a = await setup.ensureAdmin();
    console.log(a.created ? 'Admin account created.' : 'Admin setup skipped: ' + a.reason);
    if (process.env.BOOTSTRAP_DEVICE_CODE && (await setup.ensureDevice(process.env.BOOTSTRAP_DEVICE_CODE, false)))
      console.log('Bootstrap device registered/approved.');
  } catch (e) { console.error('Auto setup failed (check DB_* settings):', e.message); }
}

const port = process.env.PORT || 3000; // Passenger supplies PORT/socket automatically
const server = app.listen(port, () => { console.log(`Chennai Residency app listening on ${port}`); autoSetup(); });

function shutdown() {
  server.close(async () => { await db.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
