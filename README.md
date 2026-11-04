# Chennai Residency — Node.js + MySQL (GoDaddy-compatible)

Hotel management web app (`public/index.html`) served by a Node.js/Express API backed by **MySQL / MariaDB** (what GoDaddy hosting provides). Includes login, device approval, revision-controlled cloud state sync, audit log, staff management and property-issue APIs.

> The HTML app keeps a local copy in browser IndexedDB and syncs it to `/api/state` through `public/sync.js`. Each device signs in; new devices wait for admin approval (`PATCH /api/admin/devices/:id`). The device with existing data seeds an empty cloud copy. Don't clear browser storage before the first successful sync (see `docs/DEPLOYMENT_CHECKLIST.md`).

## Requirements
- Node.js 20+
- MySQL 5.7+ / 8 or MariaDB 10.3+ (InnoDB, utf8mb4)

## Run locally
1. Create an empty database and user in MySQL.
2. `cp .env.example .env` — fill `DB_*`, a 32+ char `JWT_SECRET`, `ADMIN_PASSWORD` (12+ chars).
3. `npm install`
4. `npm start` — on first start it creates the tables and the admin account automatically (`AUTO_SETUP=true`).
5. Open `http://localhost:3000` and `http://localhost:3000/api/health`.

Manual alternatives: `npm run db:init`, `npm run admin:create`, `npm run device:bootstrap -- YOUR-SECRET-DEVICE-CODE`.

## Deploy on GoDaddy (cPanel)
Node.js apps need a GoDaddy plan that offers **cPanel → Setup Node.js App** (or a VPS). Plain shared hosting without it cannot run Node.
1. cPanel → **MySQL® Databases**: create a database and a user, add the user to the database with **ALL PRIVILEGES**. Names get your cPanel prefix (e.g. `cpuser_chennai`). Host is `localhost`.
2. Upload this folder (without `node_modules`) to e.g. `~/chennai-residency`.
3. cPanel → **Setup Node.js App** → Create: Node 20+, Application root = that folder, Startup file = `server.js`, set URL/domain.
4. Add environment variables there (same names as `.env.example`) — or upload a filled-in `.env`.
5. Click **Run NPM Install**, then **Restart**. Tables and admin are created on first start.
6. Check `https://yourdomain.com/api/health` → `{"ok":true,"database":"connected"}`.
7. Optional without Node: phpMyAdmin → select DB → **Import** `db/schema.sql` creates the tables.

Tip: set `ADMIN_PASSWORD` back to a placeholder / remove `BOOTSTRAP_DEVICE_CODE` after first successful start.

## What changed from the PostgreSQL version
- `pg` → `mysql2`; `$1` placeholders → `?`; `RETURNING` replaced by a follow-up SELECT; `ON CONFLICT` → `ON DUPLICATE KEY UPDATE` / `INSERT IGNORE`.
- UUIDs generated in Node (no `gen_random_uuid()`), stored as `CHAR(36)`.
- `JSONB` → `LONGTEXT` (parsed in Node; works on MySQL and MariaDB). `TIMESTAMPTZ` → `DATETIME(3)` in UTC. `INET` → `VARCHAR(45)`.
- CHECK constraints → `ENUM` columns.
- Config via `DB_HOST/DB_USER/DB_PASSWORD/DB_NAME` (or `mysql://` `DATABASE_URL`); small connection pool for shared hosting.
- Added: auto schema/admin setup on start, `trust proxy`, same-host CORS allowance, duplicate-email → HTTP 409, async errors on `/api/health` handled.
- State saves can be up to 12 MB; if saves fail, raise MySQL `max_allowed_packet` (ask GoDaddy) or reduce payload size.

## API summary
`GET /api/health` · `POST /api/auth/login` · `GET /api/me` · `GET|PUT /api/state` (`{expectedRevision,payload}`, 409 on stale) · `GET|PATCH /api/admin/devices[/:id]` · `GET|POST /api/admin/users` · `GET /api/admin/audit` · `GET|POST|PATCH /api/property-issues`
