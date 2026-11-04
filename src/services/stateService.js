const db = require('../config/database');
const { HttpError } = require('../utils/errors');

async function getState() {
  const r = await db.one('SELECT revision,payload,updated_at FROM hotel_state WHERE id=1');
  return { revision: Number(r.revision), payload: db.parseJson(r.payload, {}), updated_at: r.updated_at };
}

async function putState(payload, expectedRevision, user, device) {
  return db.tx(async conn => {
    const [cur] = await conn.query('SELECT revision FROM hotel_state WHERE id=1 FOR UPDATE');
    if (Number(cur[0].revision) !== Number(expectedRevision))
      throw new HttpError(409, 'Data changed on another device. Refresh and merge before retrying.');
    const next = Number(cur[0].revision) + 1;
    await conn.query('UPDATE hotel_state SET revision=?,payload=?,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=1',
      [next, JSON.stringify(payload), user.id]);
    await conn.query('INSERT INTO state_revisions(revision,user_id,device_id,summary) VALUES(?,?,?,?)',
      [next, user.id, device.id, JSON.stringify({ keys: Object.keys(payload || {}) })]);
    await conn.query('INSERT INTO audit_events(user_id,device_id,action,entity_type,details) VALUES(?,?,?,?,?)',
      [user.id, device.id, 'state.sync', 'hotel_state', JSON.stringify({ revision: next })]);
    return { revision: next, payload, updatedAt: new Date().toISOString() };
  });
}
module.exports = { getState, putState };
