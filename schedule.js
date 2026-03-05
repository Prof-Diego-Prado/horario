// ============================================================
//  WORK DASHBOARD — Schedule Parser & Google Calendar Importer
//  Suporte: CSV (ponto-e-vírgula ou vírgula), texto colado
//  Formato esperado: Dia, Horário Início, Horário Fim, Matéria/Evento
// ============================================================

'use strict';

const ScheduleManager = (() => {

    const DAYS_MAP = {
        // PT keys — sem acento (após NFD normalize) e com acento
        'segunda': 'MO', 'seg': 'MO', 'mon': 'MO', 'monday': 'MO',
        'terca': 'TU', 'ter': 'TU', 'tue': 'TU', 'tuesday': 'TU',
        'quarta': 'WE', 'qua': 'WE', 'wed': 'WE', 'wednesday': 'WE',
        'quinta': 'TH', 'qui': 'TH', 'thu': 'TH', 'thursday': 'TH',
        'sexta': 'FR', 'sex': 'FR', 'fri': 'FR', 'friday': 'FR',
        'sabado': 'SA', 'sab': 'SA', 'sat': 'SA', 'saturday': 'SA',
        'domingo': 'SU', 'dom': 'SU', 'sun': 'SU', 'sunday': 'SU',
        // também aceita abreviações numéricas comuns
        'seg-feira': 'MO', 'ter-feira': 'TU', 'qua-feira': 'WE',
        'qui-feira': 'TH', 'sex-feira': 'FR',
    };

    const DAY_NAMES_PT = { MO: 'Segunda', TU: 'Terça', WE: 'Quarta', TH: 'Quinta', FR: 'Sexta', SA: 'Sábado', SU: 'Domingo' };
    const SHIFT_COLORS = {
        morning: '#f5c400',
        afternoon: '#60a5fa',
        night: '#a3e635',
    };

    // ── Parsed events in memory ──────────────────────────────
    let _parsedEvents = [];

    // ── Detect shift ─────────────────────────────────────────
    function detectShift(timeStr) {
        const [h] = timeStr.split(':').map(Number);
        if (h >= 6 && h < 12) return 'morning';
        if (h >= 12 && h < 18) return 'afternoon';
        return 'night';
    }

    // ── Normalize day string ──────────────────────────────────
    function normalizeDay(dayStr) {
        const key = dayStr.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .trim();
        return DAYS_MAP[key] || null;
    }

    // ── Parse time string HH:MM or H:MM ──────────────────────
    function parseTime(str) {
        if (!str) return null;
        str = str.trim().replace(/[hH]/, ':').replace(/\s/g, '');
        const match = str.match(/^(\d{1,2}):?(\d{2})$/);
        if (!match) return null;
        return `${String(match[1]).padStart(2, '0')}:${match[2]}`;
    }

    // ── Guess end time if missing (defaults +1h) ─────────────
    function guessEndTime(startStr, dur = 60) {
        const [h, m] = startStr.split(':').map(Number);
        const total = h * 60 + m + dur;
        return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }

    // ── Parse CSV (delimiters: ; , \t) ───────────────────────
    function parseCSV(text) {
        const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return [];

        // Detect delimiter
        const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
        const headers = lines[0].split(delim).map(h => h.trim().toLowerCase().replace(/"/g, ''));

        // Find column indices flexibly
        function findCol(...candidates) {
            for (const c of candidates) {
                const idx = headers.findIndex(h => h.includes(c));
                if (idx >= 0) return idx;
            }
            return -1;
        }

        const colDay = findCol('dia', 'day', 'weekday', 'semana');
        const colStart = findCol('início', 'inicio', 'start', 'hora inicio', 'horário', 'horario');
        const colEnd = findCol('fim', 'end', 'hora fim', 'término', 'termino');
        const colTitle = findCol('matéria', 'materia', 'disciplina', 'evento', 'event', 'title', 'nome', 'assunto', 'subject', 'aula');
        const colLocal = findCol('local', 'sala', 'location', 'room');

        if (colDay < 0 || colStart < 0 || colTitle < 0) return parseByPosition(lines, delim);

        const events = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = splitCSVLine(lines[i], delim);
            const day = normalizeDay(cols[colDay] || '');
            const start = parseTime(cols[colStart] || '');
            const end = colEnd >= 0 ? parseTime(cols[colEnd] || '') : null;
            const title = (cols[colTitle] || '').replace(/"/g, '').trim();
            if (!day || !start || !title) continue;
            events.push({
                id: `sch_${Date.now()}_${i}`,
                day, dayName: DAY_NAMES_PT[day] || day,
                start, end: end || guessEndTime(start),
                title,
                location: colLocal >= 0 ? (cols[colLocal] || '') : '',
                shift: detectShift(start),
                color: SHIFT_COLORS[detectShift(start)],
            });
        }
        return events;
    }

    // Splits a CSV line respecting quoted fields
    function splitCSVLine(line, delim) {
        const result = [];
        let cur = ''; let inQ = false;
        for (const ch of line) {
            if (ch === '"') { inQ = !inQ; continue; }
            if (ch === delim && !inQ) { result.push(cur.trim()); cur = ''; }
            else { cur += ch; }
        }
        result.push(cur.trim());
        return result;
    }

    // Fallback: assume columns 0=day, 1=start, 2=end, 3=title
    function parseByPosition(lines, delim) {
        const events = [];
        for (let i = 0; i < lines.length; i++) {
            const cols = splitCSVLine(lines[i], delim);
            if (cols.length < 3) continue;
            const day = normalizeDay(cols[0] || '');
            const start = parseTime(cols[1] || '');
            const end = parseTime(cols[2] || '');
            const title = (cols[3] || cols[2] || '').replace(/"/g, '').trim();
            if (!day || !start || !title) continue;
            events.push({
                id: `sch_${Date.now()}_${i}`,
                day, dayName: DAY_NAMES_PT[day] || day,
                start, end: end || guessEndTime(start),
                title, location: '',
                shift: detectShift(start),
                color: SHIFT_COLORS[detectShift(start)],
            });
        }
        return events;
    }

    // ── Parse school-style table text (copy/paste from PDF/image) ──
    // Expected pattern: each line like "Segunda 08:00 09:00 Matemática Sala 1"
    function parseTableText(text) {
        const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
        const events = [];
        const timeRe = /\b(\d{1,2}:\d{2})\b/g;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const times = [...line.matchAll(timeRe)].map(m => parseTime(m[1])).filter(Boolean);
            if (times.length === 0) continue;

            // Find day keyword
            let dayCode = null;
            for (const [key, code] of Object.entries(DAYS_MAP)) {
                if (line.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(key)) {
                    dayCode = code; break;
                }
            }

            // Extract title = everything that's not a time, not a day keyword, not a known word
            let titlePart = line
                .replace(/\b\d{1,2}:\d{2}\b/g, '')
                .replace(/segunda|terça|quarta|quinta|sexta|sábado|domingo|seg|ter|qua|qui|sex|sab|dom/gi, '')
                .replace(/\s{2,}/g, ' ').trim();

            if (!titlePart || titlePart.length < 2) continue;

            // If no day found, skip or use previous
            if (!dayCode && events.length > 0) dayCode = events[events.length - 1].day;
            if (!dayCode) continue;

            const start = times[0];
            const end = times[1] || guessEndTime(start);

            events.push({
                id: `sch_${Date.now()}_${i}`,
                day: dayCode, dayName: DAY_NAMES_PT[dayCode],
                start, end, title: titlePart, location: '',
                shift: detectShift(start), color: SHIFT_COLORS[detectShift(start)],
            });
        }
        return events;
    }

    // ── Parse weekly grid table (school timetable format) ────
    // Handles:
    //  • PDF-extracted text (fixed-width columns)
    //  • OCR text (approximate column positions)
    //  • Copy-paste from spreadsheet (tab or multi-space delimited)
    //
    // Expected format:
    //   DIEGO                          ← optional person name
    //   Hor   Seg    Ter   Qua   Qui   Sex    ← header row
    //   07:30                          ← empty row (between-class break)
    //   08:00  ----   ----  3° C (MAT)/FIS 3  ----  ----
    //   10:20  2° C (MAT)/ROBOTI  ----  2° C (MAT)/ROBOTI  ----  2° GT/TEINTU
    // ─────────────────────────────────────────────────────────
    function parseGridTable(text) {
        const lines = text.trim().split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim());
        if (lines.length < 3) return [];

        // Expand tabs to spaces (assume 8-char tab stops, common in PDFs)
        function expandTabs(s, tabSize = 8) {
            let out = '';
            for (const ch of s) {
                if (ch === '\t') { const spaces = tabSize - (out.length % tabSize); out += ' '.repeat(spaces); }
                else out += ch;
            }
            return out;
        }

        const DAY_HEADERS = {
            'hor': 'TIME', 'hora': 'TIME',
            'seg': 'MO', 'segunda': 'MO', 'mon': 'MO', 'monday': 'MO',
            'ter': 'TU', 'terca': 'TU', 'terca-feira': 'TU', 'tue': 'TU', 'tuesday': 'TU',
            'qua': 'WE', 'quarta': 'WE', 'qua-feira': 'WE', 'wed': 'WE', 'wednesday': 'WE',
            'qui': 'TH', 'quinta': 'TH', 'qui-feira': 'TH', 'thu': 'TH', 'thursday': 'TH',
            'sex': 'FR', 'sexta': 'FR', 'sex-feira': 'FR', 'fri': 'FR', 'friday': 'FR',
            'sab': 'SA', 'sabado': 'SA', 'sat': 'SA', 'saturday': 'SA',
            'dom': 'SU', 'domingo': 'SU', 'sun': 'SU', 'sunday': 'SU',
        };

        function normKey(s) {
            return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        }

        // ── Scan for header row ──────────────────────────────────
        let headerIdx = -1;
        let columns = []; // [{charStart, charEnd, dayCode}]

        for (let li = 0; li < Math.min(lines.length, 10); li++) {
            const expanded = expandTabs(lines[li]);
            // Split by 2+ consecutive spaces to get tokens with their positions
            const tokens = [];
            const tokenRe = /(\S+)/g;
            let m;
            while ((m = tokenRe.exec(expanded)) !== null) {
                tokens.push({ text: m[1], start: m.index });
            }

            const dayTokens = tokens.filter(t => DAY_HEADERS[normKey(t.text)] && DAY_HEADERS[normKey(t.text)] !== 'TIME');
            if (dayTokens.length >= 3) {
                headerIdx = li;
                // Build column boundaries:
                // Each day column starts where the token starts.
                // Column ends at the midpoint between this start and next start.
                const allCols = tokens
                    .filter(t => DAY_HEADERS[normKey(t.text)])
                    .map(t => ({ text: t.text, start: t.start, dayCode: DAY_HEADERS[normKey(t.text)] }));

                for (let ci = 0; ci < allCols.length; ci++) {
                    const cur = allCols[ci];
                    const next = allCols[ci + 1];
                    if (cur.dayCode === 'TIME') continue; // skip Hor column itself
                    // Column band: from this token's start until next token's start (or end of line)
                    columns.push({
                        charStart: cur.start,
                        charEnd: next ? next.start : Infinity,
                        dayCode: cur.dayCode,
                        label: cur.text,
                    });
                }
                break;
            }
        }

        if (headerIdx < 0 || columns.length < 2) return [];

        // ── Person name (first non-empty, non-header, non-time line before header) ──
        let personName = '';
        for (let i = 0; i < headerIdx; i++) {
            const l = lines[i].trim();
            const k = normKey(l);
            if (l && !/^\d/.test(l) && !DAY_HEADERS[k] && l.length >= 2) { personName = l; break; }
        }

        // ── Collect time slots ───────────────────────────────────
        const timeRe = /^\s*(\d{1,2}[:.h]\d{2})/;
        const timeSlots = [];
        for (let li = headerIdx + 1; li < lines.length; li++) {
            const expanded = expandTabs(lines[li]);
            const m = expanded.match(timeRe);
            if (m) {
                const t = parseTime(m[1]);
                if (t) timeSlots.push({ time: t, lineIdx: li, rawLine: expanded });
            }
        }

        if (timeSlots.length < 2) return [];

        // ── Extract cell within a column band ───────────────────
        function extractCell(rawLine, charStart, charEnd) {
            const end = charEnd === Infinity ? rawLine.length : Math.min(charEnd, rawLine.length);
            const seg = rawLine.substring(charStart, end);
            return seg.trim();
        }

        function isEmpty(cell) {
            // Empty: blank, only dashes, only dots
            return !cell || /^[-–—.\s]*$/.test(cell) || cell.length < 2;
        }

        // ── Build events ─────────────────────────────────────────
        const events = [];
        const SHIFT_COLORS_LOCAL = { morning: '#f5c400', afternoon: '#60a5fa', night: '#a3e635' };

        for (let si = 0; si < timeSlots.length; si++) {
            const slot = timeSlots[si];
            const nextSlot = timeSlots[si + 1];
            const endTime = nextSlot ? nextSlot.time : guessEndTime(slot.time, 50);

            for (let ci = 0; ci < columns.length; ci++) {
                const col = columns[ci];
                let cell = extractCell(slot.rawLine, col.charStart, col.charEnd);

                // Sometimes OCR produces the time at start of line; strip it
                cell = cell.replace(/^\d{1,2}[:.h]\d{2}\s*/, '').trim();
                if (isEmpty(cell)) continue;

                // Strip trailing separator dashes
                const title = cell.replace(/\s*[-–—]+\s*$/, '').trim();
                if (!title || title.length < 2) continue;

                const shift = detectShift(slot.time);
                events.push({
                    id: `sch_grid_${Date.now()}_${si}_${ci}`,
                    day: col.dayCode,
                    dayName: DAY_NAMES_PT[col.dayCode] || col.dayCode,
                    start: slot.time,
                    end: endTime,
                    title,
                    location: personName,
                    shift,
                    color: SHIFT_COLORS_LOCAL[shift],
                });
            }
        }

        return events;
    }

    // ── Main Parse Entry Point ────────────────────────────────
    // Tries: 1) Grid table (school timetable format)  2) CSV  3) Free-form text
    function parse(text) {
        if (!text || !text.trim()) return [];

        // 1. Try grid table first (weekly timetable with day-column headers)
        const grid = parseGridTable(text);
        if (grid.length > 0) { _parsedEvents = grid; return grid; }

        // 2. Try CSV/TSV (has delimiters in first line)
        if (/[;,\t]/.test(text.split('\n')[0])) {
            const csv = parseCSV(text);
            if (csv.length > 0) { _parsedEvents = csv; return csv; }
        }

        // 3. Fallback: free-form text with time tokens
        const tbl = parseTableText(text);
        _parsedEvents = tbl;
        return tbl;
    }

    function getParsedEvents() { return _parsedEvents; }
    function clearParsed() { _parsedEvents = []; }

    // ── Render Preview Table ──────────────────────────────────
    function renderPreview(events, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        if (!events.length) {
            container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:.82rem;">Nenhum evento reconhecido. Verifique o formato dos dados.</div>`;
            return;
        }

        const shiftLabel = { morning: '🌅 Manhã', afternoon: '☀️ Tarde', night: '🌙 Noite' };
        const shiftBadge = { morning: 'badge-morning', afternoon: 'badge-afternoon', night: 'badge-night' };
        const rows = events.map(ev => `
      <tr>
        <td><strong style="color:var(--accent-pale)">${ev.dayName}</strong></td>
        <td style="font-family:Orbitron,monospace;font-size:.7rem;color:var(--accent-gold)">${ev.start} – ${ev.end}</td>
        <td>${ev.title}</td>
        <td>${ev.location || '—'}</td>
        <td><span class="badge-shift ${shiftBadge[ev.shift]}">${shiftLabel[ev.shift]}</span></td>
      </tr>`).join('');

        container.innerHTML = `
      <div class="schedule-preview">
        <table>
          <thead>
            <tr>
              <th>Dia</th><th>Horário</th><th>Evento / Matéria</th><th>Local</th><th>Turno</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

        // Update footer count
        const countEl = document.getElementById('schedule-count');
        if (countEl) countEl.textContent = events.length;
        document.getElementById('btn-schedule-all').disabled = events.length === 0;
    }

    // ── Add Events to Google Calendar (Weekly Recurrence) ────
    async function scheduleAllToCalendar(events) {
        if (!state.isAuthenticated) {
            showToast('⚠️ Conecte sua conta Google primeiro.', 'error');
            return 0;
        }

        let success = 0;
        const today = new Date();
        // Find the next occurrence of each weekday starting from today
        const DAY_NUM = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

        for (const ev of events) {
            try {
                const targetDay = DAY_NUM[ev.day] ?? 1;
                const base = new Date(today);
                // Advance to next occurrence of that weekday
                while (base.getDay() !== targetDay) base.setDate(base.getDate() + 1);

                const [sh, sm] = ev.start.split(':').map(Number);
                const [eh, em] = ev.end.split(':').map(Number);

                const startDT = new Date(base);
                startDT.setHours(sh, sm, 0, 0);
                const endDT = new Date(base);
                endDT.setHours(eh, em, 0, 0);

                const event = {
                    summary: ev.title,
                    location: ev.location || undefined,
                    start: { dateTime: startDT.toISOString(), timeZone: 'America/Sao_Paulo' },
                    end: { dateTime: endDT.toISOString(), timeZone: 'America/Sao_Paulo' },
                    recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${ev.day}`],
                    colorId: ev.shift === 'morning' ? '5' : ev.shift === 'afternoon' ? '1' : '9',
                    description: `Importado do Work Dashboard — ${new Date().toLocaleDateString('pt-BR')}`,
                };

                await gapi.client.request({
                    path: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
                    method: 'POST',
                    body: JSON.stringify(event),
                });
                success++;
            } catch (e) {
                console.error('[Schedule] Error adding event:', ev.title, e);
            }
        }
        return success;
    }

    // ── File type detection ───────────────────────────────────
    const FILE_TYPES = {
        pdf: ['application/pdf'],
        image: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'image/tiff', 'image/gif'],
        text: ['text/csv', 'text/plain', 'text/tab-separated-values'],
    };

    function detectFileType(file) {
        const mime = file.type.toLowerCase();
        const ext = file.name.split('.').pop().toLowerCase();
        if (FILE_TYPES.pdf.includes(mime) || ext === 'pdf') return 'pdf';
        if (FILE_TYPES.image.includes(mime) || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'gif'].includes(ext)) return 'image';
        return 'text';
    }

    // ── PDF.js text extraction (uses global window.pdfjsLib from UMD build) ──
    async function extractTextFromPDF(file) {
        const lib = window.pdfjsLib;
        if (!lib) throw new Error('PDF.js não carregou. Verifique a conexão.');

        // Worker already configured in index.html
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            // Reconstruct lines by grouping items by approximate Y position
            const lineMap = {};
            for (const item of content.items) {
                if (!item.str) continue;
                const y = Math.round(item.transform[5] / 5) * 5; // bucket by 5px
                if (!lineMap[y]) lineMap[y] = [];
                lineMap[y].push(item.str);
            }
            const sortedYs = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
            for (const y of sortedYs) fullText += lineMap[y].join(' ') + '\n';
            fullText += '\n';
        }
        return fullText.trim();
    }

    // ── Tesseract.js OCR ──────────────────────────────────────
    async function extractTextFromImage(file, onProgress) {
        if (typeof Tesseract === 'undefined') {
            throw new Error('Tesseract.js não carregou. Verifique a conexão.');
        }

        const imageUrl = URL.createObjectURL(file);
        try {
            const result = await Tesseract.recognize(imageUrl, 'por+eng', {
                logger: m => {
                    if (m.status === 'recognizing text' && onProgress) {
                        onProgress(Math.round(m.progress * 100));
                    }
                },
            });
            return result.data.text;
        } finally {
            URL.revokeObjectURL(imageUrl);
        }
    }

    return {
        parse, parseCSV, parseTableText, getParsedEvents, clearParsed,
        renderPreview, scheduleAllToCalendar,
        extractTextFromPDF, extractTextFromImage, detectFileType,
    };
})();


// ── Schedule Modal Controller ────────────────────────────────────────────────
const ScheduleModal = (() => {

    function open() {
        document.getElementById('schedule-modal').classList.add('open');
    }
    function close() {
        document.getElementById('schedule-modal').classList.remove('open');
    }

    // ── Drop zone status helpers ──────────────────────────────
    function setDropZoneStatus(icon, text, sub, isProcessing = false) {
        const zoneIcon = document.getElementById('drop-zone-icon');
        const zoneText = document.querySelector('.drop-zone-text');
        const zoneSub = document.querySelector('.drop-zone-sub');
        if (zoneIcon) zoneIcon.textContent = icon;
        if (zoneText) zoneText.textContent = text;
        if (zoneSub) zoneSub.innerHTML = sub;
        const zone = document.getElementById('drop-zone');
        if (isProcessing) zone.style.cursor = 'wait';
        else zone.style.cursor = 'pointer';
    }

    function resetDropZone() {
        setDropZoneStatus('📂', 'Arraste um arquivo aqui', 'CSV · TXT · <strong>PDF · PNG · JPG · WEBP</strong>');
    }

    // ── Main file handler ─────────────────────────────────────
    async function handleFile(file) {
        const type = ScheduleManager.detectFileType(file);
        const preview = document.getElementById('schedule-preview-container');
        if (preview) preview.innerHTML = '';
        document.getElementById('btn-schedule-all').disabled = true;
        document.getElementById('schedule-count').textContent = '0';
        document.getElementById('paste-area').value = '';

        try {
            if (type === 'text') {
                // ── CSV / TXT ─────────────────────────────────────
                setDropZoneStatus('📄', `Lendo ${file.name}…`, 'Processando texto…', true);
                const text = await readAsText(file);
                document.getElementById('paste-area').value = text;
                const events = ScheduleManager.parse(text);
                ScheduleManager.renderPreview(events, 'schedule-preview-container');
                setDropZoneStatus('✅', file.name, `<strong>${events.length}</strong> evento(s) encontrado(s)`);

            } else if (type === 'pdf') {
                // ── PDF ───────────────────────────────────────────
                setDropZoneStatus('📑', `Lendo PDF: ${file.name}`, '⏳ Extraindo texto do PDF…', true);
                let text;
                try {
                    text = await ScheduleManager.extractTextFromPDF(file);
                } catch (e) {
                    showToast(`❌ Erro ao ler PDF: ${e.message}`, 'error');
                    resetDropZone(); return;
                }
                document.getElementById('paste-area').value = text;
                const events = ScheduleManager.parse(text);
                ScheduleManager.renderPreview(events, 'schedule-preview-container');
                if (events.length === 0) {
                    if (preview) preview.innerHTML = `
            <div style="padding:16px;border:1px solid rgba(245,196,0,.2);border-radius:10px;background:rgba(245,196,0,.04);">
              <p style="color:var(--accent-amber);font-size:.82rem;font-weight:600;margin-bottom:8px;">⚠️ Texto extraído do PDF, mas nenhum horário reconhecido automaticamente.</p>
              <p style="color:var(--text-secondary);font-size:.76rem;">Verifique o texto extraído na caixa abaixo e ajuste o formato, ou tente a versão em imagem do arquivo.</p>
            </div>`;
                }
                setDropZoneStatus('✅', file.name, `PDF · <strong>${events.length}</strong> evento(s) encontrado(s)`);

            } else if (type === 'image') {
                // ── IMAGEM com OCR ────────────────────────────────
                setDropZoneStatus('🖼️', `Analisando imagem…`, '⏳ OCR em progresso — pode levar até 30s', true);

                // Show image preview in drop zone while processing
                const imgUrl = URL.createObjectURL(file);
                const zoneIcon = document.getElementById('drop-zone-icon');
                if (zoneIcon) zoneIcon.innerHTML = `<img src="${imgUrl}" style="max-height:80px;max-width:180px;border-radius:6px;object-fit:cover;margin-bottom:4px;" />`;

                let text;
                try {
                    text = await ScheduleManager.extractTextFromImage(file, pct => {
                        const sub = document.querySelector('.drop-zone-sub');
                        if (sub) sub.innerHTML = `⏳ <strong>OCR ${pct}%</strong> — aguarde…
              <div style="height:3px;background:rgba(245,196,0,.15);border-radius:2px;margin-top:6px;">
                <div style="height:100%;width:${pct}%;background:var(--accent-gold);border-radius:2px;transition:width .3s;"></div>
              </div>`;
                    });
                    URL.revokeObjectURL(imgUrl);
                } catch (e) {
                    URL.revokeObjectURL(imgUrl);
                    showToast(`❌ Erro OCR: ${e.message}`, 'error');
                    resetDropZone(); return;
                }

                document.getElementById('paste-area').value = text;
                const events = ScheduleManager.parse(text);
                ScheduleManager.renderPreview(events, 'schedule-preview-container');
                setDropZoneStatus('✅', file.name, `Imagem · <strong>${events.length}</strong> evento(s) encontrado(s)`);

                if (events.length === 0) {
                    if (preview) preview.innerHTML = `
            <div style="padding:16px;border:1px solid rgba(245,196,0,.2);border-radius:10px;background:rgba(245,196,0,.04);">
              <p style="color:var(--accent-amber);font-size:.82rem;font-weight:600;margin-bottom:8px;">⚠️ Texto extraído pela OCR, mas nenhum horário reconhecido.</p>
              <p style="color:var(--text-secondary);font-size:.76rem;">O texto extraído aparece na caixa abaixo. Corrija-o manualmente ou use um CSV.</p>
            </div>`;
                }
            }
        } catch (e) {
            console.error('[ScheduleModal] handleFile error:', e);
            showToast('❌ Erro ao processar o arquivo.', 'error');
            resetDropZone();
        }
    }

    function readAsText(file) {
        return new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = e => res(e.target.result);
            r.onerror = () => rej(new Error('Erro ao ler arquivo'));
            r.readAsText(file, 'utf-8');
        });
    }

    function parseAndPreview() {
        const text = document.getElementById('paste-area').value.trim();
        if (!text) return;
        const events = ScheduleManager.parse(text);
        ScheduleManager.renderPreview(events, 'schedule-preview-container');
    }

    async function scheduleAll() {
        const events = ScheduleManager.getParsedEvents();
        const btn = document.getElementById('btn-schedule-all');
        btn.disabled = true;
        btn.textContent = 'Agendando…';

        const count = await ScheduleManager.scheduleAllToCalendar(events);
        btn.textContent = '📅 Agendar Semanalmente';
        btn.disabled = false;

        if (count > 0) {
            showToast(`✅ ${count} evento(s) adicionado(s) ao Google Calendar!`, 'success');
            if (state.isAuthenticated) fetchCalendarEvents().then(renderAgenda);
            ScheduleManager.getParsedEvents().forEach(ev => DriveDB.saveEvent(ev).catch(() => { }));
            close();
        } else {
            showToast('❌ Nenhum evento agendado. Verifique os dados.', 'error');
        }
    }

    function init() {
        const modal = document.getElementById('schedule-modal');
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');
        const pasteArea = document.getElementById('paste-area');

        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        document.getElementById('btn-modal-close').addEventListener('click', close);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); fileInput.value = ''; });

        dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', e => {
            e.preventDefault(); dropZone.classList.remove('drag-over');
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
        });
        dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

        document.getElementById('btn-parse').addEventListener('click', parseAndPreview);
        pasteArea.addEventListener('input', () => {
            if (pasteArea.value.trim().split('\n').length >= 2) parseAndPreview();
        });

        document.getElementById('btn-schedule-all').addEventListener('click', scheduleAll);
    }

    return { open, close, init };
})();
