const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const db = require('../config/database');
const { auth, roles } = require('../middleware/auth');
const state = require('../services/stateService');
const { HttpError } = require('../utils/errors');
const router = express.Router();

const ROLES = ['admin', 'manager', 'reception', 'housekeeping', 'accounts', 'auditor'];
const uuid = () => crypto.randomUUID();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const cleanUser = u => ({ ...u, active: !!u.active });
const cleanIssue = i => ({ ...i, evidence: db.parseJson(i.evidence, []) });
const cleanAudit = a => ({ ...a, details: db.parseJson(a.details, {}) });

const loginSchema = z.object({
  email: z.string().email().max(254), password: z.string().min(1).max(200),
  deviceCode: z.string().min(8).max(100), deviceName: z.string().min(1).max(100),
  platform: z.enum(['web', 'android']).default('web')
});

router.get('/health', wrap(async (req, res) => {
  await db.one('SELECT 1 AS ok');
  res.json({ ok: true, service: 'chennai-residency-api', database: 'connected', time: new Date().toISOString() });
}));

router.post('/auth/login', wrap(async (req, res) => {
  const v = loginSchema.parse(req.body);
  const u = await db.one('SELECT * FROM staff_users WHERE lower(email)=lower(?)', [v.email]);
  if (!u || !u.active || !(await bcrypt.compare(v.password, u.password_hash))) throw new HttpError(401, 'Incorrect email or password');
  let d = await db.one('SELECT * FROM devices WHERE device_code=?', [v.deviceCode]);
  if (!d) {
    const id = uuid();
    await db.run("INSERT INTO devices(id,device_code,device_name,platform,status) VALUES(?,?,?,?,'approved')", [id, v.deviceCode, v.deviceName, v.platform]);
    d = await db.one('SELECT * FROM devices WHERE id=?', [id]);
  }
  if (d.status === 'blocked') throw new HttpError(403, 'This device is blocked. Contact Admin');
  const token = jwt.sign({ sub: u.id, did: d.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, expiresIn: 43200, user: { id: u.id, email: u.email, name: u.display_name, role: u.role }, device: { id: d.id, name: d.device_name } });
}));

router.get('/me', auth, (req, res) => res.json({
  user: { id: req.user.id, email: req.user.email, name: req.user.display_name, role: req.user.role },
  device: { id: req.user.device_id }
}));

router.get('/state', auth, wrap(async (req, res) => res.json(await state.getState())));
router.put('/state', auth, wrap(async (req, res) => {
  const v = z.object({ expectedRevision: z.number().int().nonnegative(), payload: z.record(z.any()) }).parse(req.body);
  res.json(await state.putState(v.payload, v.expectedRevision, req.user, { id: req.user.device_id }));
}));

router.get('/admin/devices', auth, roles('admin'), wrap(async (req, res) => {
  res.json(await db.rows('SELECT d.*,u.display_name AS approved_by_name FROM devices d LEFT JOIN staff_users u ON u.id=d.approved_by ORDER BY d.created_at DESC'));
}));
router.patch('/admin/devices/:id', auth, roles('admin'), wrap(async (req, res) => {
  const status = z.enum(['approved', 'blocked', 'pending']).parse(req.body.status);
  if (!(await db.one('SELECT id FROM devices WHERE id=?', [req.params.id]))) throw new HttpError(404, 'Device not found');
  if (status === 'approved')
    await db.run('UPDATE devices SET status=?,approved_by=?,approved_at=UTC_TIMESTAMP(3) WHERE id=?', [status, req.user.id, req.params.id]);
  else await db.run('UPDATE devices SET status=? WHERE id=?', [status, req.params.id]);
  await db.run('INSERT INTO audit_events(user_id,device_id,action,entity_type,entity_id) VALUES(?,?,?,?,?)',
    [req.user.id, req.user.device_id, 'device.' + status, 'device', req.params.id]);
  res.json(await db.one('SELECT * FROM devices WHERE id=?', [req.params.id]));
}));

router.get('/admin/users', auth, roles('admin'), wrap(async (req, res) => {
  res.json((await db.rows('SELECT id,email,display_name,role,active,created_at FROM staff_users ORDER BY created_at')).map(cleanUser));
}));
router.post('/admin/users', auth, roles('admin'), wrap(async (req, res) => {
  const v = z.object({ email: z.string().email(), displayName: z.string().min(2).max(100), password: z.string().min(12), role: z.enum(ROLES) }).parse(req.body);
  const id = uuid();
  await db.run('INSERT INTO staff_users(id,email,display_name,password_hash,role) VALUES(?,lower(?),?,?,?)',
    [id, v.email, v.displayName, await bcrypt.hash(v.password, 12), v.role]); // duplicate email -> 409 via error handler
  res.status(201).json(cleanUser(await db.one('SELECT id,email,display_name,role,active FROM staff_users WHERE id=?', [id])));
}));

router.get('/admin/audit', auth, roles('admin', 'manager', 'auditor'), wrap(async (req, res) => {
  res.json((await db.rows('SELECT a.*,u.display_name,d.device_name FROM audit_events a LEFT JOIN staff_users u ON u.id=a.user_id LEFT JOIN devices d ON d.id=a.device_id ORDER BY a.created_at DESC, a.id DESC LIMIT 500')).map(cleanAudit));
}));

router.post('/property-issues', auth, wrap(async (req, res) => {
  const v = z.object({
    issueKey: z.string().min(3).max(190), roomNumber: z.string().max(50).optional(), title: z.string().min(2).max(255),
    description: z.string().optional(), severity: z.enum(['info', 'warning', 'critical']).default('warning'),
    evidence: z.array(z.any()).max(20).default([])
  }).parse(req.body);
  await db.run(
    `INSERT INTO property_issues(id,issue_key,room_number,title,description,severity,evidence,reported_by) VALUES(?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE description=VALUES(description),severity=VALUES(severity),evidence=VALUES(evidence),updated_at=UTC_TIMESTAMP(3)`,
    [uuid(), v.issueKey, v.roomNumber || null, v.title, v.description || null, v.severity, JSON.stringify(v.evidence), req.user.id]);
  res.status(201).json(cleanIssue(await db.one('SELECT * FROM property_issues WHERE issue_key=?', [v.issueKey])));
}));
router.get('/property-issues', auth, wrap(async (req, res) => {
  res.json((await db.rows('SELECT * FROM property_issues ORDER BY created_at DESC LIMIT 300')).map(cleanIssue));
}));
router.patch('/property-issues/:id', auth, wrap(async (req, res) => {
  const status = z.enum(['open', 'in_progress', 'resolved']).parse(req.body.status);
  if (!(await db.one('SELECT id FROM property_issues WHERE id=?', [req.params.id]))) throw new HttpError(404, 'Issue not found');
  await db.run('UPDATE property_issues SET status=?,updated_at=UTC_TIMESTAMP(3),resolved_at=' + (status === 'resolved' ? 'UTC_TIMESTAMP(3)' : 'NULL') + ' WHERE id=?', [status, req.params.id]);
  res.json(cleanIssue(await db.one('SELECT * FROM property_issues WHERE id=?', [req.params.id])));
}));
module.exports = router;
