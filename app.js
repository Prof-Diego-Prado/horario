// ============================================================
//  WORK DASHBOARD V2 — Main Application
//  Persistent Google Login · Drive/Sheets DB · Schedule Import
// ============================================================

'use strict';

// ── Persistent Auth Storage ─────────────────────────────────
const AuthStore = {
    KEY_USER: 'wd_user',
    KEY_TOKEN: 'wd_token',
    KEY_EXPIRY: 'wd_token_expiry',

    save(user, tokenResp) {
        localStorage.setItem(this.KEY_USER, JSON.stringify(user));
        localStorage.setItem(this.KEY_TOKEN, tokenResp.access_token);
        // expires_in is in seconds, store absolute timestamp
        const expiresAt = Date.now() + (tokenResp.expires_in || 3600) * 1000 - 60_000; // 1min buffer
        localStorage.setItem(this.KEY_EXPIRY, String(expiresAt));
    },

    getUser() { try { return JSON.parse(localStorage.getItem(this.KEY_USER) || 'null'); } catch { return null; } },
    getToken() { return localStorage.getItem(this.KEY_TOKEN); },

    isValid() {
        const expiry = Number(localStorage.getItem(this.KEY_EXPIRY) || 0);
        return !!this.getToken() && Date.now() < expiry;
    },

    clear() {
        localStorage.removeItem(this.KEY_USER);
        localStorage.removeItem(this.KEY_TOKEN);
        localStorage.removeItem(this.KEY_EXPIRY);
    },
};

// ── App State ───────────────────────────────────────────────
const state = {
    isAuthenticated: false,
    user: null,
    todayEvents: [],
    tasks: [],
    emails: [],
    notes: CONFIG.DEMO_NOTES,
    todos: [],
    demoMode: true,
    _tokenClient: null,
};

// ════════════════════════════════════════════════════════════
//  CLOCK
// ════════════════════════════════════════════════════════════
function startClock() {
    function tick() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');

        const timeEl = document.getElementById('clock-time');
        if (timeEl) timeEl.innerHTML = `${h}<span class="clock-colon">:</span>${m}`;
        const secEl = document.getElementById('clock-seconds');
        if (secEl) secEl.textContent = `${s}s`;
        const dateEl = document.getElementById('clock-date');
        if (dateEl) dateEl.textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        const todayEl = document.getElementById('today-label');
        if (todayEl) todayEl.innerHTML = `<strong>${now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</strong>`;

        updateCurrentTimeMarker(now);

        // Silent token refresh ~5 min before expiry
        const expiry = Number(localStorage.getItem(AuthStore.KEY_EXPIRY) || 0);
        if (state.isAuthenticated && expiry && (expiry - Date.now()) < 5 * 60 * 1000) {
            silentRefreshToken();
        }
    }
    tick();
    setInterval(tick, 1000);
}

function updateCurrentTimeMarker(now) {
    const h = now.getHours();
    const sid = h >= 6 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'afternoon' : h >= 18 ? 'night' : null;
    document.querySelectorAll('.current-time-line').forEach(el => el.style.display = 'none');
    if (sid) {
        const mk = document.getElementById(`time-marker-${sid}`);
        if (mk) {
            mk.style.display = 'flex';
            const lbl = mk.querySelector('.time-now-label');
            if (lbl) lbl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        }
    }
}

// ════════════════════════════════════════════════════════════
//  GOOGLE AUTH — PERSISTENT LOGIN
// ════════════════════════════════════════════════════════════
let _gisReady = false;

function waitForGIS(cb, tries = 0) {
    if (typeof google !== 'undefined' && google.accounts?.oauth2) { _gisReady = true; cb(); }
    else if (tries < 30) setTimeout(() => waitForGIS(cb, tries + 1), 300);
    else { console.warn('[Auth] GIS não carregou.'); loadDemoData(); }
}

function initAuth() {
    if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
        loadDemoData(); return;
    }
    waitForGIS(setupTokenClient);
}

function setupTokenClient() {
    state._tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: CONFIG.SCOPES,
        callback: onTokenReceived,
    });

    // Attempt silent restore
    if (AuthStore.isValid()) {
        restoreFromCache();
    } else if (AuthStore.getUser()) {
        // Token expired but user cached — silently refresh
        silentRefreshToken();
    } else {
        // First time — show button
        renderAuthButton();
        loadDemoData();
    }
}

async function restoreFromCache() {
    const user = AuthStore.getUser();
    const token = AuthStore.getToken();
    if (!user || !token) { renderAuthButton(); loadDemoData(); return; }

    // Inject cached token into gapi
    if (typeof gapi !== 'undefined') {
        gapi.load('client', async () => {
            await gapi.client.init({});
            gapi.client.setToken({ access_token: token });
            state.user = user;
            state.isAuthenticated = true;
            renderConnectedState();
            setLoading(true, 'Restaurando sessão...');
            try {
                await DriveDB.init();
                await Promise.all([loadTodosFromDrive(), fetchCalendarEvents(), fetchGoogleTasks(), fetchGmailMessages()]);
                state.demoMode = false;
                renderAll();
                showDriveLink();
            } catch (e) {
                console.warn('[Auth] Restore error — retrying token refresh:', e);
                silentRefreshToken();
            } finally { setLoading(false); }
        });
    }
}

function silentRefreshToken() {
    if (!state._tokenClient) { loadDemoData(); return; }
    state._tokenClient.requestAccessToken({ prompt: '' });
}

async function onTokenReceived(resp) {
    if (resp.error) { console.warn('[Auth] Token error:', resp.error); loadDemoData(); return; }

    if (typeof gapi !== 'undefined') {
        gapi.load('client', async () => {
            await gapi.client.init({});
            gapi.client.setToken(resp);
        });
    }

    try {
        setLoading(true, 'Conectando ao Google...');
        await fetchUserProfile(resp.access_token);
        AuthStore.save(state.user, resp);
        await DriveDB.init();
        await Promise.all([loadTodosFromDrive(), fetchCalendarEvents(), fetchGoogleTasks(), fetchGmailMessages()]);
        state.demoMode = false;
        renderAll();
        renderConnectedState();
        showDriveLink();
        showToast('✅ Conta Google conectada!', 'success');
    } catch (e) {
        console.error('[Auth] Login error:', e);
        showToast('❌ Erro ao conectar. Tente novamente.', 'error');
        loadDemoData();
    } finally { setLoading(false); }
}

async function fetchUserProfile(token) {
    const t = token || (typeof gapi !== 'undefined' ? gapi.client.getToken()?.access_token : null) || AuthStore.getToken();
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${t}` },
    });
    if (!resp.ok) throw new Error('userinfo failed');
    state.user = await resp.json();
    state.isAuthenticated = true;
}

function renderAuthButton() {
    const sec = document.getElementById('auth-section');
    if (!sec) return;
    sec.innerHTML = `
    <button class="btn-google" id="btn-google">
      <svg width="15" height="15" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      Conectar Google
    </button>`;
    document.getElementById('btn-google').addEventListener('click', () => {
        if (state._tokenClient) state._tokenClient.requestAccessToken({ prompt: 'consent' });
    });
}

function renderConnectedState() {
    const sec = document.getElementById('auth-section');
    if (!sec || !state.user) return;
    sec.innerHTML = `
    <div class="user-avatar">
      <img src="${state.user.picture || ''}" alt="Avatar"
           onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(state.user.name || 'U')}&background=f5c400&color=0a0a0a'">
      <div class="user-info">
        <div class="name">${escHtml(state.user.name || 'Usuário')}</div>
        <div class="email">${escHtml(state.user.email || '')}</div>
      </div>
      <button class="btn-logout" onclick="signOut()" title="Sair">✕</button>
    </div>`;
    const badge = document.getElementById('demo-badge');
    if (badge) { badge.textContent = '● Drive'; badge.style.cssText = 'background:rgba(163,230,53,.1);border-color:rgba(163,230,53,.3);color:#a3e635;'; }
}

function showDriveLink() {
    const url = DriveDB.getSheetUrl();
    if (!url) return;
    const bar = document.getElementById('top-bar-right');
    if (!bar || document.getElementById('sheet-link')) return;
    const a = document.createElement('a');
    a.id = 'sheet-link'; a.href = url; a.target = '_blank'; a.title = 'Abrir planilha no Drive';
    a.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Planilha`;
    bar.prepend(a);
}

function signOut() {
    if (typeof google !== 'undefined') {
        const t = typeof gapi !== 'undefined' ? gapi.client.getToken()?.access_token : null;
        if (t) google.accounts.oauth2.revoke(t);
        if (typeof gapi !== 'undefined') gapi.client.setToken(null);
    }
    AuthStore.clear();
    state.isAuthenticated = false; state.user = null; state.demoMode = true;
    document.getElementById('sheet-link')?.remove();
    const badge = document.getElementById('demo-badge');
    if (badge) { badge.textContent = '● Demo'; badge.style.cssText = ''; }
    renderAuthButton();
    loadDemoData();
    showToast('👋 Sessão encerrada.', 'success');
}

// ════════════════════════════════════════════════════════════
//  LOADING OVERLAY
// ════════════════════════════════════════════════════════════
function setLoading(on, msg = '') {
    let el = document.getElementById('loading-overlay');
    if (on) {
        if (!el) {
            el = document.createElement('div');
            el.id = 'loading-overlay';
            el.innerHTML = `<div class="loader-ring"></div><div class="loader-text" id="loader-msg">${msg}</div>`;
            document.body.appendChild(el);
        } else {
            document.getElementById('loader-msg').textContent = msg;
        }
    } else { el?.remove(); }
}

// ════════════════════════════════════════════════════════════
//  TOAST
// ════════════════════════════════════════════════════════════
let _toastTimer = null;
function showToast(msg, type = '') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast ${type}`;
    void el.offsetWidth; // reflow
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ════════════════════════════════════════════════════════════
//  GOOGLE CALENDAR
// ════════════════════════════════════════════════════════════
async function fetchCalendarEvents() {
    try {
        const t = typeof gapi !== 'undefined' ? gapi.client.getToken()?.access_token : AuthStore.getToken();
        const now = new Date();
        const s = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
        const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${s}&timeMax=${e}&singleEvents=true&orderBy=startTime&maxResults=25`, {
            headers: { Authorization: `Bearer ${t}` },
        });
        const data = await resp.json();
        const COLS = ['#f5c400', '#a3e635', '#60a5fa', '#f87171', '#fb923c', '#c084fc'];
        state.todayEvents = (data.items || []).map(ev => {
            const sd = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
            const ed = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
            const sh = sd ? sd.getHours() + sd.getMinutes() / 60 : 9;
            const shift = sh >= 6 && sh < 12 ? 'morning' : sh >= 12 && sh < 18 ? 'afternoon' : 'night';
            return {
                id: ev.id, title: ev.summary || '(Sem título)',
                start: sd ? `${String(sd.getHours()).padStart(2, '0')}:${String(sd.getMinutes()).padStart(2, '0')}` : '',
                end: ed ? `${String(ed.getHours()).padStart(2, '0')}:${String(ed.getMinutes()).padStart(2, '0')}` : '',
                shift, duration: sd && ed ? Math.round((ed - sd) / 60000) + ' min' : '',
                color: COLS[Math.floor(Math.random() * COLS.length)],
                meet: ev.hangoutLink || null,
            };
        });
    } catch (e) {
        console.error('[Calendar]', e);
        state.todayEvents = CONFIG.DEMO_EVENTS;
    }
}

// ════════════════════════════════════════════════════════════
//  GOOGLE TASKS
// ════════════════════════════════════════════════════════════
async function fetchGoogleTasks() {
    try {
        const t = typeof gapi !== 'undefined' ? gapi.client.getToken()?.access_token : AuthStore.getToken();
        const listsR = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1', { headers: { Authorization: `Bearer ${t}` } });
        const listsD = await listsR.json();
        const listId = listsD.items?.[0]?.id;
        if (!listId) { state.tasks = CONFIG.DEMO_TASKS; return; }
        const tasksR = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=true&maxResults=10`, { headers: { Authorization: `Bearer ${t}` } });
        const tasksD = await tasksR.json();
        state.tasks = (tasksD.items || []).map(tk => ({ id: tk.id, title: tk.title, done: tk.status === 'completed', listId }));
        DriveDB.saveTasks(state.tasks).catch(() => { });
    } catch (e) {
        console.error('[Tasks]', e);
        state.tasks = CONFIG.DEMO_TASKS;
    }
}

async function toggleGoogleTask(id, listId, done) {
    try {
        const t = typeof gapi !== 'undefined' ? gapi.client.getToken()?.access_token : AuthStore.getToken();
        await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${id}`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: done ? 'needsAction' : 'completed' }),
        });
        await fetchGoogleTasks();
        renderTaskList();
    } catch (e) { console.error('[Tasks] toggle:', e); }
}

// ════════════════════════════════════════════════════════════
//  GMAIL
// ════════════════════════════════════════════════════════════
async function fetchGmailMessages() {
    try {
        const t = typeof gapi !== 'undefined' ? gapi.client.getToken()?.access_token : AuthStore.getToken();
        const listR = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&labelIds=INBOX', { headers: { Authorization: `Bearer ${t}` } });
        const listD = await listR.json();
        const msgs = listD.messages || [];
        const dets = await Promise.all(msgs.map(m =>
            fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
        ));
        state.emails = dets.map(r => {
            const hdrs = r.payload?.headers || [];
            const getH = n => hdrs.find(h => h.name === n)?.value || '';
            const date = new Date(getH('Date'));
            return {
                from: getH('From').replace(/<.*>/, '').trim(),
                subject: getH('Subject'),
                time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
                read: !r.labelIds?.includes('UNREAD'),
            };
        });
    } catch (e) {
        console.error('[Gmail]', e);
        state.emails = CONFIG.DEMO_EMAILS;
    }
}

// ════════════════════════════════════════════════════════════
//  DEMO DATA
// ════════════════════════════════════════════════════════════
function loadDemoData() {
    state.todayEvents = [...CONFIG.DEMO_EVENTS];
    state.tasks = [...CONFIG.DEMO_TASKS];
    state.emails = [...CONFIG.DEMO_EMAILS];
    state.notes = [...CONFIG.DEMO_NOTES];
    state.todos = JSON.parse(localStorage.getItem('wd_todos') || '[]');
    state.demoMode = true;
    renderAll();
}

// ════════════════════════════════════════════════════════════
//  TO-DO (Drive-backed)
// ════════════════════════════════════════════════════════════
async function loadTodosFromDrive() {
    try { state.todos = await DriveDB.getTodos(); }
    catch { state.todos = JSON.parse(localStorage.getItem('wd_todos') || '[]'); }
}

async function addTodo() {
    const input = document.getElementById('todo-input');
    const dateEl = document.getElementById('todo-date');
    const timeEl = document.getElementById('todo-time');
    const text = input?.value.trim();
    if (!text) { input?.focus(); return; }
    let item;
    if (state.isAuthenticated) {
        try {
            setLoading(true, 'Salvando no Drive...');
            item = await DriveDB.addTodo(text, dateEl?.value || '', timeEl?.value || '');
        } catch { item = { id: Date.now(), text, date: dateEl?.value || '', time: timeEl?.value || '', checked: false }; }
        finally { setLoading(false); }
    } else {
        item = { id: Date.now(), text, date: dateEl?.value || '', time: timeEl?.value || '', checked: false };
        const loc = JSON.parse(localStorage.getItem('wd_todos') || '[]');
        loc.unshift(item); localStorage.setItem('wd_todos', JSON.stringify(loc));
    }
    state.todos.unshift(item);
    if (input) input.value = '';
    if (dateEl) dateEl.value = '';
    if (timeEl) timeEl.value = '';
    renderTodos();
}

async function toggleTodo(i) {
    const item = state.todos[i]; if (!item) return;
    if (state.isAuthenticated) {
        try { const u = await DriveDB.toggleTodo(item.id, item.checked); state.todos[i] = { ...item, checked: u.checked }; }
        catch { state.todos[i].checked = !item.checked; }
    } else {
        state.todos[i].checked = !item.checked;
        localStorage.setItem('wd_todos', JSON.stringify(state.todos));
    }
    renderTodos();
}

async function deleteTodo(i) {
    const item = state.todos[i]; if (!item) return;
    if (state.isAuthenticated) { try { await DriveDB.deleteTodo(item.id); } catch { } }
    else { const l = JSON.parse(localStorage.getItem('wd_todos') || '[]'); l.splice(i, 1); localStorage.setItem('wd_todos', JSON.stringify(l)); }
    state.todos.splice(i, 1); renderTodos();
}

function toggleTask(i) {
    const t = state.tasks[i]; if (!t) return;
    if (state.isAuthenticated && t.listId) toggleGoogleTask(t.id, t.listId, t.done);
    else { t.done = !t.done; renderTaskList(); }
}

function changeDay(dir) {
    if (state.isAuthenticated) fetchCalendarEvents().then(renderAgenda);
    else renderAgenda();
}

// ════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════
function renderAgenda() {
    Object.keys(CONFIG.SHIFTS).forEach(key => {
        const el = document.getElementById(`events-${key}`); if (!el) return;
        const evs = state.todayEvents.filter(e => e.shift === key);
        el.innerHTML = evs.length === 0
            ? `<div class="shift-empty">Nenhum compromisso neste turno</div>`
            : evs.map(ev => `
          <div class="event-pill" style="border-left-color:${ev.color};color:${ev.color}">
            <span class="event-time">${ev.start}${ev.end ? ' – ' + ev.end : ''}</span>
            <span class="event-title">${escHtml(ev.title)}</span>
            ${ev.duration ? `<span class="event-duration">${ev.duration}</span>` : ''}
            ${ev.meet ? `<span style="cursor:pointer;font-size:13px" onclick="window.open('${ev.meet}','_blank')" title="Google Meet">🎥</span>` : ''}
          </div>`).join('');
    });
}

function renderTaskList() {
    const el = document.getElementById('task-list'); if (!el) return;
    el.innerHTML = !state.tasks.length
        ? `<div class="task-empty">Sem tarefas para hoje 🎉</div>`
        : state.tasks.map((t, i) => `
        <div class="task-item ${t.done ? 'done' : ''}" onclick="toggleTask(${i})">
          <div class="task-check">${t.done ? '✓' : ''}</div>
          <span class="task-title">${escHtml(t.title)}</span>
        </div>`).join('');
}

function renderGmail() {
    const el = document.getElementById('email-list'); if (!el) return;
    const badge = document.getElementById('gmail-badge');
    const unread = state.emails.filter(e => !e.read).length;
    if (badge) { badge.textContent = unread; badge.style.display = unread ? 'flex' : 'none'; }
    el.innerHTML = state.emails.map(e => `
    <div class="email-item ${!e.read ? 'unread' : ''}">
      <div class="email-dot"></div>
      <div class="email-content">
        <div class="email-from">${escHtml(e.from)}</div>
        <div class="email-subject">${escHtml(e.subject)}</div>
      </div>
      <div class="email-time">${e.time}</div>
    </div>`).join('');
}

function renderNotes() {
    const el = document.getElementById('notes-grid'); if (!el) return;
    const notes = state.notes.length ? state.notes : CONFIG.DEMO_NOTES;
    el.innerHTML = notes.map(n => `
    <div class="note-item">
      <div class="note-title">${escHtml(n.title)}</div>
      <div class="note-body">${escHtml(n.body)}</div>
    </div>`).join('');
}

function renderTodos() {
    const el = document.getElementById('todo-list'); if (!el) return;
    el.innerHTML = !state.todos.length
        ? `<div class="todo-empty">Nenhum afazer ainda ✏️</div>`
        : state.todos.map((item, i) => `
        <div class="todo-item ${item.checked ? 'checked' : ''}">
          <div class="todo-checkbox" onclick="toggleTodo(${i})">${item.checked ? '✓' : ''}</div>
          <div class="todo-content" onclick="toggleTodo(${i})">
            <div class="todo-text">${escHtml(item.text)}</div>
            <div class="todo-meta">
              ${item.date ? `<span>📅 ${fmtDate(item.date)}</span>` : ''}
              ${item.time ? `<span>🕐 ${item.time}</span>` : ''}
            </div>
          </div>
          <button class="todo-delete" onclick="event.stopPropagation();deleteTodo(${i})" title="Remover">✕</button>
        </div>`).join('');
}

function renderAll() { renderAgenda(); renderTaskList(); renderGmail(); renderNotes(); renderTodos(); }

// ════════════════════════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════════════════════════
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }

document.addEventListener('keydown', e => { if (e.target.id === 'todo-input' && e.key === 'Enter') addTodo(); });

// ════════════════════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
    startClock();
    loadDemoData();   // immediate demo render
    renderAuthButton();
    initAuth();       // will silently restore or show button
    ScheduleModal.init();
});
