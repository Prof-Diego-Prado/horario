// ============================================================
//  WORK DASHBOARD — Google Drive / Sheets Database Layer
//  Persiste todos os dados em uma planilha no Google Drive
//  do próprio usuário. Criada automaticamente no primeiro uso.
// ============================================================

'use strict';

const DriveDB = (() => {

    const SHEET_NAME = 'WorkDashboard';
    const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
    const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
    const STORAGE_KEY = 'wd_sheet_id';

    // Abas da planilha
    const TABS = {
        TODO: 'Todo',
        TASKS: 'Tarefas',
        EVENTS: 'Eventos',
        LOG: 'Histórico',
    };

    // Cabeçalhos de cada aba
    const HEADERS = {
        TODO: ['id', 'text', 'date', 'time', 'checked', 'created_at'],
        TASKS: ['id', 'title', 'status', 'due', 'list_id', 'synced_at'],
        EVENTS: ['id', 'title', 'start', 'end', 'shift', 'color', 'location', 'source'],
        LOG: ['timestamp', 'action', 'entity', 'details'],
    };

    let _sheetId = localStorage.getItem(STORAGE_KEY) || null;
    let _token = null;

    // ── Helpers ────────────────────────────────────────────
    function getToken() {
        if (typeof gapi !== 'undefined' && gapi.client.getToken()) {
            return gapi.client.getToken().access_token;
        }
        return _token;
    }

    function headers() {
        return {
            'Authorization': `Bearer ${getToken()}`,
            'Content-Type': 'application/json',
        };
    }

    async function sheetsReq(path, method = 'GET', body = null) {
        const res = await fetch(`${SHEETS_API}${path}`, {
            method,
            headers: headers(),
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) throw new Error(`Sheets API ${method} ${path} → ${res.status}`);
        return res.json();
    }

    async function driveReq(path, method = 'GET', body = null, isJson = true) {
        const res = await fetch(`${DRIVE_API}${path}`, {
            method,
            headers: isJson ? headers() : { 'Authorization': `Bearer ${getToken()}` },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) throw new Error(`Drive API ${method} ${path} → ${res.status}`);
        return res.json();
    }

    function rowToObj(headers, row) {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
        return obj;
    }

    function objToRow(headers, obj) {
        return headers.map(h => String(obj[h] ?? ''));
    }

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    // ── Init & Setup ────────────────────────────────────────

    /**
     * Inicializa o DB: encontra ou cria a planilha no Drive.
     * Retorna o spreadsheet ID.
     */
    async function init() {
        if (_sheetId) {
            // Verifica se ainda existe
            try {
                await sheetsReq(`/${_sheetId}?fields=spreadsheetId`);
                console.info('[DriveDB] Planilha encontrada:', _sheetId);
                return _sheetId;
            } catch {
                _sheetId = null;
                localStorage.removeItem(STORAGE_KEY);
            }
        }

        // Busca planilha existente por nome
        const q = encodeURIComponent(`name='${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
        const found = await driveReq(`?q=${q}&fields=files(id,name)&pageSize=1`);
        if (found.files?.length > 0) {
            _sheetId = found.files[0].id;
            localStorage.setItem(STORAGE_KEY, _sheetId);
            console.info('[DriveDB] Planilha existente encontrada:', _sheetId);
            return _sheetId;
        }

        // Cria nova planilha
        _sheetId = await createSpreadsheet();
        localStorage.setItem(STORAGE_KEY, _sheetId);
        return _sheetId;
    }

    async function createSpreadsheet() {
        console.info('[DriveDB] Criando nova planilha...');

        const body = {
            properties: { title: SHEET_NAME, locale: 'pt_BR', timeZone: 'America/Sao_Paulo' },
            sheets: Object.entries(TABS).map(([, title], index) => ({
                properties: { sheetId: index, title, gridProperties: { rowCount: 1000, columnCount: 10 } },
            })),
        };

        const sheet = await sheetsReq('', 'POST', body);
        const id = sheet.spreadsheetId;

        // Escreve cabeçalhos em cada aba
        const data = Object.entries(TABS).map(([key, tab]) => ({
            range: `${tab}!A1`,
            values: [HEADERS[key]],
        }));

        await sheetsReq(`/${id}/values:batchUpdate`, 'POST', {
            valueInputOption: 'RAW',
            data,
        });

        // Formata cabeçalhos (negrito + fundo azul)
        const sheetIds = { Todo: 0, Tarefas: 1, Eventos: 2, Histórico: 3 };
        const requests = Object.values(sheetIds).map(shId => ({
            repeatCell: {
                range: { sheetId: shId, startRowIndex: 0, endRowIndex: 1 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: { red: 0.024, green: 0.451, blue: 0.525 },
                        textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                    },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
        }));

        await sheetsReq(`/${id}:batchUpdate`, 'POST', { requests });

        console.info('[DriveDB] Planilha criada com sucesso:', id);
        return id;
    }

    // ── CRUD Genérico ───────────────────────────────────────

    async function readTab(tabKey) {
        const tab = TABS[tabKey];
        const hdrs = HEADERS[tabKey];
        try {
            const resp = await sheetsReq(`/${_sheetId}/values/${tab}!A2:Z`);
            const rows = resp.values || [];
            return rows.map(r => rowToObj(hdrs, r));
        } catch (e) {
            console.error(`[DriveDB] readTab ${tab}:`, e);
            return [];
        }
    }

    async function appendRow(tabKey, obj) {
        const tab = TABS[tabKey];
        const hdrs = HEADERS[tabKey];
        if (!obj.id) obj.id = uid();
        const row = objToRow(hdrs, obj);
        try {
            await sheetsReq(`/${_sheetId}/values/${tab}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, 'POST', {
                values: [row],
            });
            return obj;
        } catch (e) {
            console.error(`[DriveDB] appendRow ${tab}:`, e);
            throw e;
        }
    }

    async function updateRow(tabKey, id, updates) {
        const tab = TABS[tabKey];
        const hdrs = HEADERS[tabKey];
        // Lê todas as linhas para encontrar o índice
        const resp = await sheetsReq(`/${_sheetId}/values/${tab}!A1:Z`);
        const rows = resp.values || [];
        const headerRow = rows[0] || hdrs;
        const idColIdx = headerRow.indexOf('id');

        const rowIdx = rows.findIndex((r, i) => i > 0 && r[idColIdx] === String(id));
        if (rowIdx < 0) throw new Error(`[DriveDB] Row id=${id} não encontrado em ${tab}`);

        const existing = rowToObj(hdrs, rows[rowIdx]);
        const updated = { ...existing, ...updates };
        const newRow = objToRow(hdrs, updated);

        const range = `${tab}!A${rowIdx + 1}`;
        await sheetsReq(`/${_sheetId}/values/${range}?valueInputOption=RAW`, 'PUT', {
            values: [newRow],
        });
        return updated;
    }

    async function deleteRow(tabKey, id) {
        const tab = TABS[tabKey];
        const hdrs = HEADERS[tabKey];
        const resp = await sheetsReq(`/${_sheetId}/values/${tab}!A1:Z`);
        const rows = resp.values || [];
        const headerRow = rows[0] || hdrs;
        const idColIdx = headerRow.indexOf('id');

        const rowIdx = rows.findIndex((r, i) => i > 0 && r[idColIdx] === String(id));
        if (rowIdx < 0) return; // Já removido

        // Deleta a linha via batchUpdate
        const sheetMeta = await sheetsReq(`/${_sheetId}?fields=sheets.properties`);
        const sheetObj = sheetMeta.sheets?.find(s => s.properties.title === tab);
        const sheetId = sheetObj?.properties?.sheetId ?? 0;

        await sheetsReq(`/${_sheetId}:batchUpdate`, 'POST', {
            requests: [{
                deleteDimension: {
                    range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 },
                },
            }],
        });
    }

    async function appendLog(action, entity, details = '') {
        try {
            await appendRow('LOG', {
                timestamp: new Date().toISOString(),
                action, entity,
                details: typeof details === 'object' ? JSON.stringify(details) : String(details),
            });
        } catch { /* Log failures are silent */ }
    }

    // ── Public API: TODO ────────────────────────────────────
    async function getTodos() {
        const rows = await readTab('TODO');
        return rows.map(r => ({ ...r, checked: r.checked === 'true' }));
    }

    async function addTodo(text, date = '', time = '') {
        const obj = { text, date, time, checked: 'false', created_at: new Date().toISOString() };
        const result = await appendRow('TODO', obj);
        await appendLog('CREATE', 'Todo', text);
        return { ...result, checked: false };
    }

    async function toggleTodo(id, currentChecked) {
        const result = await updateRow('TODO', id, { checked: String(!currentChecked) });
        await appendLog('TOGGLE', 'Todo', `id=${id} → checked=${!currentChecked}`);
        return { ...result, checked: !currentChecked };
    }

    async function deleteTodo(id) {
        await deleteRow('TODO', id);
        await appendLog('DELETE', 'Todo', `id=${id}`);
    }

    // ── Public API: EVENTS ──────────────────────────────────
    async function getCustomEvents() {
        return readTab('EVENTS');
    }

    async function saveEvent(event) {
        const obj = { ...event, source: 'manual', id: event.id || uid() };
        if (event._isNew) {
            delete obj._isNew;
            await appendRow('EVENTS', obj);
        } else {
            await updateRow('EVENTS', obj.id, obj);
        }
        await appendLog('SAVE', 'Event', event.title);
        return obj;
    }

    async function deleteEvent(id) {
        await deleteRow('EVENTS', id);
        await appendLog('DELETE', 'Event', `id=${id}`);
    }

    // ── Public API: TASKS ───────────────────────────────────
    async function saveTasks(tasks) {
        // Apaga aba e reescreve (mais simples para sincronização)
        try {
            // Clear all data rows
            await sheetsReq(`/${_sheetId}/values/${TABS.TASKS}!A2:Z?valueInputOption=RAW`, 'PUT', { values: [[]] });
        } catch { /* ignore */ }

        for (const t of tasks) {
            await appendRow('TASKS', {
                id: t.id, title: t.title,
                status: t.done ? 'completed' : 'needsAction',
                due: t.due || '', list_id: t.listId || '',
                synced_at: new Date().toISOString(),
            });
        }
    }

    // ── Public: getSheetUrl ─────────────────────────────────
    function getSheetUrl() {
        return _sheetId ? `https://docs.google.com/spreadsheets/d/${_sheetId}` : null;
    }

    // ── Expose ──────────────────────────────────────────────
    return {
        init,
        getTodos, addTodo, toggleTodo, deleteTodo,
        getCustomEvents, saveEvent, deleteEvent,
        saveTasks,
        getSheetUrl,
        appendLog,
        get sheetId() { return _sheetId; },
    };
})();
