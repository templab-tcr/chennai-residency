const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { HttpError } = require('../utils/errors');
async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new HttpError(401, 'Login required');
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const u = await db.one(
      'SELECT u.id,u.email,u.display_name,u.role,u.active,d.id AS device_id,d.status AS device_status FROM staff_users u JOIN devices d ON d.id=? WHERE u.id=?',
      [claims.did, claims.sub]);
    if (!u || !u.active) throw new HttpError(401, 'Account unavailable');
    if (u.device_status === 'blocked') throw new HttpError(403, 'This device is blocked. Contact Admin');
    req.user = u;
    await db.run('UPDATE devices SET last_seen_at=UTC_TIMESTAMP(3) WHERE id=?', [u.device_id]);
    next();
  } catch (e) { next(e instanceof HttpError ? e : new HttpError(401, 'Invalid or expired login session')); }
}
const roles = (...allowed) => (req, res, next) => allowed.includes(req.user.role) ? next() : next(new HttpError(403, 'Permission denied'));
module.exports = { auth, roles };
