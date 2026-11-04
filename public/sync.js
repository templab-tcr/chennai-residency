/* Chennai Residency cloud sync.
   Keeps the IndexedDB copy the screen already uses and mirrors every save to /api/state.
   Loaded after the main app script: it wraps save(), and shows a sign-in / choice screen
   only when the cloud copy and this device's copy need a decision. Nothing is overwritten silently. */
(function () {
  'use strict';
  const API = '/api';
  const KEY = { token: 'cr_token', device: 'cr_device', rev: 'cr_rev', dirty: 'cr_dirty' };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isDirty = () => store.get(KEY.dirty) === '1';
  const markDirty = () => store.set(KEY.dirty, '1');
  const clearDirty = () => store.del(KEY.dirty);

  let ready = false;        // this device's copy is known to match the cloud, so saves are uploaded
  let declined = false;     // staff chose "this device only" for this visit
  let offlineState = false; // last check could not reach the server
  let queued = null, chain = Promise.resolve();
  let gate, box, statusEl;

  function hasData(d) {
    if (!d) return false;
    const lists = [d.guests, d.logs, d.accounts, d.auditBills, d.nonGstBills];
    return lists.some(a => Array.isArray(a) && a.length > 0) || Object.keys(d.cashClosings || {}).length > 0;
  }
  function deviceCode() {
    let c = store.get(KEY.device);
    if (!c) {
      const rnd = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      c = 'dev-' + rnd;
      store.set(KEY.device, c);
    }
    return c;
  }
  function deviceName() {
    const ua = navigator.userAgent || '';
    const kind = /Mobi|Android|iPhone/i.test(ua) ? 'Phone' : 'Laptop/PC';
    return (kind + ' - ' + (navigator.platform || 'browser')).slice(0, 100);
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    const t = store.get(KEY.token);
    if (t) headers.Authorization = 'Bearer ' + t;
    const r = await fetch(API + path, Object.assign({}, opts, { headers, credentials: 'same-origin', cache: 'no-store' }));
    let body = null;
    try { body = await r.json(); } catch (e) {}
    return { status: r.status, ok: r.ok, body: body || {} };
  }

  /* ---------- UI ---------- */
  const btnStyle = 'display:block;width:100%;margin-top:10px;padding:12px;border-radius:10px;border:1px solid #f2bb4e;background:#f2bb4e;color:#3b110b;font:600 15px system-ui,sans-serif;cursor:pointer';
  const ghostStyle = 'display:block;width:100%;margin-top:10px;padding:12px;border-radius:10px;border:1px solid #f2bb4e;background:transparent;color:#f2bb4e;font:600 15px system-ui,sans-serif;cursor:pointer';
  const inputStyle = 'width:100%;margin-top:6px;padding:11px;border-radius:8px;border:1px solid rgba(242,187,78,.5);background:#2a0c07;color:#fbeed6;font:16px system-ui,sans-serif';
  const h2Style = 'margin:0 0 8px;font:italic 700 1.35rem Georgia,serif;color:#f2bb4e';

  function buildGate() {
    gate = document.createElement('div');
    gate.setAttribute('style', 'position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(30,8,6,.97);color:#fbeed6;font:15px/1.45 system-ui,-apple-system,sans-serif;overflow:auto');
    box = document.createElement('div');
    box.setAttribute('style', 'width:100%;max-width:400px;background:#4a160f;border:1px solid #f2bb4e;border-radius:14px;padding:22px');
    gate.appendChild(box);
    document.body.appendChild(gate);

    statusEl = document.createElement('div');
    statusEl.setAttribute('style', 'position:fixed;right:8px;bottom:6px;z-index:99990;font:12px system-ui,sans-serif;color:#dcb7a2;background:rgba(30,8,6,.85);padding:3px 9px;border-radius:99px;cursor:pointer');
    statusEl.title = 'Cloud sync status (tap to sign out of sync on this device)';
    statusEl.addEventListener('click', () => {
      if (confirm('Sign this device out of cloud sync? Data stays on this device.')) {
        store.del(KEY.token);
        location.reload();
      }
    });
    document.body.appendChild(statusEl);
  }
  function status(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = tone === 'bad' ? '#ffc4b3' : tone === 'ok' ? '#a9e3b8' : '#dcb7a2';
  }
  function showGate(html) { box.innerHTML = html; gate.style.display = 'flex'; }
  function hideGate() { gate.style.display = 'none'; }
  function showBusy(text) { showGate('<p style="margin:0">' + esc(text) + '</p>'); }

  function screenLogin(msg) {
    showGate(
      '<h2 style="' + h2Style + '">Sign in to sync</h2>' +
      '<p style="margin:0 0 10px;color:#dcb7a2;font-size:14px">Use your hotel login. This device will then share the same data as the others.</p>' +
      (msg ? '<p style="margin:0 0 10px;color:#ffc4b3;font-size:14px">' + esc(msg) + '</p>' : '') +
      '<label style="font-size:12px;color:#f2bb4e">Email</label>' +
      '<input id="crEmail" type="email" autocomplete="username" style="' + inputStyle + '">' +
      '<label style="font-size:12px;color:#f2bb4e;display:block;margin-top:12px">Password</label>' +
      '<input id="crPass" type="password" autocomplete="current-password" style="' + inputStyle + '">' +
      '<button id="crGo" style="' + btnStyle + '">Sign in</button>' +
      '<button id="crLater" style="' + ghostStyle + '">Use this device only for now</button>'
    );
    document.getElementById('crGo').onclick = doLogin;
    document.getElementById('crLater').onclick = continueOffline;
    document.getElementById('crEmail').focus();
  }

  function screenConflict() {
    showGate(
      '<h2 style="' + h2Style + '">Two versions of the data</h2>' +
      '<p style="margin:0 0 10px;color:#dcb7a2;font-size:14px">The cloud copy changed while this device also has changes that are not uploaded yet. Nothing has been overwritten. Choose one:</p>' +
      '<button id="crUp" style="' + btnStyle + '">Upload this device\'s copy (replaces the cloud copy)</button>' +
      '<button id="crDown" style="' + ghostStyle + '">Use the cloud copy (discards this device\'s unsent changes)</button>' +
      '<button id="crLater" style="' + ghostStyle + '">Decide later: use this device only</button>'
    );
    document.getElementById('crUp').onclick = () => { if (confirm('Replace the cloud copy with this device\'s data?')) forceUpload(); };
    document.getElementById('crDown').onclick = () => { if (confirm('Discard this device\'s unsent changes and load the cloud copy?')) forceDownload(); };
    document.getElementById('crLater').onclick = continueOffline;
  }

  /* ---------- Session ---------- */
  async function doLogin() {
    const email = document.getElementById('crEmail').value.trim();
    const pass = document.getElementById('crPass').value;
    if (!email || !pass) return screenLogin('Enter your email and password.');
    showBusy('Signing in…');
    try {
      const r = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: pass, deviceCode: deviceCode(), deviceName: deviceName(), platform: 'web' })
      });
      if (r.status === 202) return screenLogin('This device is registered and waiting for admin approval. Ask the admin to approve it, then sign in again.');
      if (!r.ok) return screenLogin(r.body.error || 'Sign-in failed. Try again.');
      store.set(KEY.token, r.body.token);
      boot();
    } catch (e) {
      screenLogin('No internet connection. Connect and try again.');
    }
  }

  function continueOffline() {
    declined = true; ready = false; offlineState = false;
    hideGate();
    status('Not syncing on this device', 'bad');
  }

  function finishReady() {
    ready = true; offlineState = false; hideGate(); status('Synced ✓', 'ok');
  }
  function goOffline() {
    ready = false; offlineState = true; hideGate();
    status('Offline: saving on this device', 'bad');
  }
  function settle(res) {
    if (res === 'ok') return finishReady();
    if (res === 'conflict') return screenConflict();
    if (res === 'auth') return screenLogin('Your sign-in ended. Sign in again; unsent changes stay on this device.');
    return goOffline();
  }
  function afterPush(res) {
    if (res === 'conflict') return screenConflict();
    if (res === 'auth') return screenLogin('Your sign-in ended. Sign in again; unsent changes stay on this device.');
  }

  async function adoptServer(payload, rev) {
    const idb = await openDB();
    await new Promise((res, rej) => {
      const t = idb.transaction('state', 'readwrite');
      t.objectStore('state').put(payload && typeof payload === 'object' ? payload : {}, 'main');
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
    store.set(KEY.rev, rev);
    clearDirty();
    location.reload();
  }

  async function forceUpload() {
    showBusy('Uploading this device\'s copy…');
    try {
      const s = await api('/state');
      if (!s.ok) return screenLogin('Could not reach the cloud copy. Try again.');
      store.set(KEY.rev, s.body.revision);
      settle(await pushState());
    } catch (e) { goOffline(); }
  }
  async function forceDownload() {
    showBusy('Loading the cloud copy…');
    try {
      const s = await api('/state');
      if (!s.ok) return screenLogin('Could not load the cloud copy. Try again.');
      await adoptServer(s.body.payload, s.body.revision);
    } catch (e) { goOffline(); }
  }

  /* Decide what to do on load. quiet = retry in the background, no screen flash. */
  async function boot(quiet) {
    ready = false; offlineState = false;
    if (!store.get(KEY.token)) return screenLogin('');
    if (!quiet) showBusy('Checking the cloud copy…');

    let s;
    try { s = await api('/state'); }
    catch (e) { return goOffline(); }
    if (s.status === 401) return screenLogin('Your sign-in ended. Sign in again.');
    if (s.status === 403) { store.del(KEY.token); return screenLogin(s.body.error || 'This device cannot sync yet.'); }
    if (!s.ok) { ready = false; hideGate(); status('Sync error: saving on this device', 'bad'); return; }

    const serverRev = Number(s.body.revision) || 0;
    const serverPayload = s.body.payload;
    const raw = store.get(KEY.rev);
    const localRev = raw === null ? null : Number(raw);
    const dirty = isDirty();
    const localHasData = hasData(db);

    // Cloud copy is empty. The first device that has real data seeds it.
    if (serverRev === 0 && (localRev === null || localRev === 0)) {
      if (!localHasData && !dirty) { store.set(KEY.rev, 0); return finishReady(); }
      store.set(KEY.rev, 0); markDirty(); ready = true;
      return settle(await pushState());
    }
    if (serverRev === 0 && localRev > 0) return screenConflict(); // cloud was emptied after this device synced

    if (localRev !== null && localRev === serverRev) {
      if (!dirty) return finishReady();
      ready = true;
      return settle(await pushState());           // only this device changed
    }
    if (!dirty && localRev !== null && localRev < serverRev) return adoptServer(serverPayload, serverRev); // cloud is newer
    if (!dirty && localRev === null && !localHasData) return adoptServer(serverPayload, serverRev);       // fresh device
    return screenConflict();                       // both sides have changes, or unknown history: person decides
  }

  /* ---------- Uploads (serialised, latest data each time) ---------- */
  function pushState() {
    if (queued) return queued;
    const run = () => { queued = null; return doPush(); };
    const p = chain.then(run, run);
    queued = p;
    chain = p.catch(() => {});
    return p;
  }
  async function doPush() {
    if (!store.get(KEY.token)) { markDirty(); return 'auth'; }
    if (navigator.onLine === false) { markDirty(); status('Offline: will upload when connected', 'bad'); return 'offline'; }
    status('Uploading…', '');
    try {
      const r = await api('/state', {
        method: 'PUT',
        body: JSON.stringify({ expectedRevision: Number(store.get(KEY.rev) || 0), payload: db })
      });
      if (r.ok) { store.set(KEY.rev, r.body.revision); clearDirty(); status('Synced ✓', 'ok'); return 'ok'; }
      markDirty();
      if (r.status === 409) { status('Conflict: needs a choice', 'bad'); return 'conflict'; }
      if (r.status === 401 || r.status === 403) { status('Sign in again', 'bad'); return 'auth'; }
      status('Upload failed: will retry', 'bad');
      return 'error';
    } catch (e) {
      markDirty(); status('Offline: will upload when connected', 'bad');
      return 'offline';
    }
  }

  function wrapSaves() {
    const origSave = window.save;
    if (typeof origSave === 'function') {
      window.save = async function () {
        const out = await origSave.apply(this, arguments);
        markDirty();
        if (ready) afterPush(await pushState());
        return out;
      };
    }
    const origAcc = window.saveAccountsOnly;
    if (typeof origAcc === 'function') {
      window.saveAccountsOnly = async function () {
        const out = await origAcc.apply(this, arguments);
        markDirty();
        if (ready) afterPush(await pushState());
        return out;
      };
    }
  }

  /* ---------- Start ---------- */
  function whenAppLoaded(cb) {
    const start = Date.now();
    (function poll() {
      if ((typeof dbReady !== 'undefined' && dbReady) || Date.now() - start > 8000) cb();
      else setTimeout(poll, 60);
    })();
  }

  whenAppLoaded(() => {
    buildGate();
    wrapSaves();
    boot(false);
    window.addEventListener('online', () => {
      if (ready && isDirty()) pushState().then(afterPush);
      else if (!ready && !declined && store.get(KEY.token)) boot(true);
    });
    setInterval(() => {
      if (ready && isDirty() && navigator.onLine !== false) pushState().then(afterPush);
      else if (offlineState && !declined && store.get(KEY.token)) boot(true);
    }, 30000);
  });
})();
