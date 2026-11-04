# API quick reference

All authenticated routes require `Authorization: Bearer <JWT>`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | API/database health |
| POST | `/api/auth/login` | Public | Login + device registration |
| GET | `/api/me` | Approved device | Current user/device |
| GET | `/api/state` | Approved device | Read full hotel-state snapshot |
| PUT | `/api/state` | Approved device | Revision-checked full snapshot write |
| GET | `/api/admin/devices` | Admin | List registered devices |
| PATCH | `/api/admin/devices/:id` | Admin | Approve/block/pending device |
| GET | `/api/admin/users` | Admin | List staff |
| POST | `/api/admin/users` | Admin | Create staff user |
| GET | `/api/admin/audit` | Admin/manager/auditor | Recent audit events |
| POST | `/api/property-issues` | Approved device | Create/update issue by issueKey |
| GET | `/api/property-issues` | Approved device | List issues |
| PATCH | `/api/property-issues/:id` | Approved device | Change issue status |

### Login request
```json
{"email":"admin@example.com","password":"...","deviceCode":"unique-device-code","deviceName":"Reception PC","platform":"web"}
```
New device returns HTTP 202 until approved. Approved device returns a JWT.

### State write request
```json
{"expectedRevision":0,"payload":{"rooms":{},"guests":[],"logs":[]}}
```
A stale revision returns HTTP 409. The client must reload/reconcile rather than retrying a stale full snapshot blindly.
