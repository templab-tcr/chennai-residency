# Deployment and cutover checklist

## Before deploying
- [ ] Confirm hosting provider and plan supports Node.js apps and persistent environment variables.
- [ ] Create a MySQL database + user in cPanel (or managed MySQL) and restrict network access.
- [ ] Configure HTTPS and DNS for `api.thechennairesidency.com` and `app.thechennairesidency.com`.
- [ ] Set production `DB_*`, `JWT_SECRET`, `CORS_ORIGINS` and `NODE_ENV`.
- [ ] Run schema init and create the first Admin account/device.
- [ ] Verify health, login, device approval, state read/write and 409 conflict behaviour.
- [ ] Configure automated database backups (cPanel Backup) and perform a restore test.

## Safe hotel-data migration
- [ ] Stop writes during the final export window or use a documented snapshot procedure.
- [ ] Export IndexedDB database `ChennaiResidencyDB`, object store `state`, key `main` from every active browser profile.
- [ ] Identify the authoritative master copy and reconcile differences from other devices; never blindly overwrite one copy with another.
- [ ] Import the approved master snapshot to MySQL with a checksum and record counts.
- [ ] Verify room inventory, occupied rooms, guest records, bills, audit registers, accounts, cash closings, AI alerts and settings.
- [ ] Keep the original browser database and export backups untouched until sign-off.
- [ ] Enable cloud sync in a pilot device; test concurrent writes and offline reconnect.
- [ ] Roll out remaining devices only after pilot acceptance.

## Operational sign-off
- [ ] Check-in, guest photo capture, checkout, invoice printing and GST/non-GST workflows.
- [ ] Cash/UPI/card reconciliation, expenses and shift closing reports.
- [ ] Housekeeping, room status, Property Check photo upload and AI alert lifecycle.
- [ ] Role permissions, device block/unblock, staff exit and audit trail.
- [ ] Network loss, power restart, backup restore and two-user conflict scenarios.
