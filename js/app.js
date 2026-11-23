/* Time Clock — offline, single-user time clock PWA.
 * All data lives in localStorage on this device. No network calls.
 */
(() => {
  'use strict';

  // ---------- Storage ----------
  const KEY = 'timeclock.v1';
  const DEFAULT_SETTINGS = {
    name: '', employer: '', position: '',
    rate: 0, currency: '$', otWeekly: 40, otMult: 1.5,
    weekStart: 0, rounding: 0, hoursFmt: 'hm', clock24: false,
  };
  let state = load();

  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    if (!s || !Array.isArray(s.entries)) s = { entries: [], settings: {}, meta: {} };
    s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
    s.meta = s.meta || {};
    s.entries = s.entries.filter(validEntry).map(normEntry);
    return s;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save — storage is full or blocked.'); }
  }
  function validEntry(e) { return e && Number.isFinite(e.start); }
  function normEntry(e) {
    return {
      id: e.id || uid(),
      start: e.start,
      end: Number.isFinite(e.end) ? e.end : null,
      breakMs: Math.max(0, Number(e.breakMs) || 0),
      breakStart: Number.isFinite(e.breakStart) ? e.breakStart : null,
      note: typeof e.note === 'string' ? e.note : '',
    };
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  const S = () => state.settings;

  // ---------- Date helpers ----------
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
  const addMonths = (t, n) => { const d = new Date(t); d.setDate(1); d.setMonth(d.getMonth() + n); return d.getTime(); };
  function startOfWeek(t) {
    const d = new Date(startOfDay(t));
    const diff = (d.getDay() - Number(S().weekStart) + 7) % 7;
    d.setDate(d.getDate() - diff);
    return d.getTime();
  }
  const startOfMonth = (t) => { const d = new Date(startOfDay(t)); d.setDate(1); return d.getTime(); };
  const startOfQuarter = (t) => { const d = new Date(startOfMonth(t)); d.setMonth(Math.floor(d.getMonth() / 3) * 3); return d.getTime(); };
  const startOfYear = (t) => { const d = new Date(startOfDay(t)); d.setMonth(0, 1); return d.getTime(); };
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const toLocalInput = (t) => { const d = new Date(t); return `${dayKey(t)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function fromLocalInput(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v || '');
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime();
  }

  // ---------- Formatting ----------
  const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !S().clock24 });
  const fmtTimeSec = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: !S().clock24 });
  const fmtDate = (t, o) => new Date(t).toLocaleDateString([], o || { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtDow = (t) => new Date(t).toLocaleDateString([], { weekday: 'short' });
  const fmtDowLong = (t) => new Date(t).toLocaleDateString([], { weekday: 'long' });
  function fmtHM(ms) {
    const m = Math.round(Math.max(0, ms) / MIN);
    return `${Math.floor(m / 60)}:${pad(m % 60)}`;
  }
  const fmtDec = (ms) => (Math.max(0, ms) / HOUR).toFixed(2);
  const fmtH = (ms) => (S().hoursFmt === 'dec' ? fmtDec(ms) : fmtHM(ms));
  function fmtClock(ms) {
    const s = Math.floor(Math.max(0, ms) / 1000);
    return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  }
  function fmtMoney(n) {
    return S().currency + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Time math ----------
  function roundTs(t) {
    const r = Number(S().rounding);
    if (!r) return t;
    const step = r * MIN;
    return Math.round(t / step) * step;
  }
  function breakOf(e, now) {
    return e.breakMs + (e.end == null && e.breakStart ? Math.max(0, now - e.breakStart) : 0);
  }
  function durOf(e, now) {
    const s = roundTs(e.start);
    const en = e.end == null ? now : roundTs(e.end);
    return Math.max(0, en - s - breakOf(e, now));
  }
  const openEntry = () => state.entries.find((e) => e.end == null) || null;
  const sorted = () => state.entries.slice().sort((a, b) => a.start - b.start);

  /** Allocate weekly overtime across entries, chronologically within each week. Returns Map id -> otMs. */
  function computeOT(now) {
    const thr = Number(S().otWeekly) * HOUR;
    const out = new Map();
    if (!(thr > 0)) return out;
    const cum = new Map();
    for (const e of sorted()) {
      const wk = startOfWeek(e.start);
      const before = cum.get(wk) || 0;
      const after = before + durOf(e, now);
      cum.set(wk, after);
      const ot = Math.max(0, after - thr) - Math.max(0, before - thr);
      if (ot > 0) out.set(e.id, ot);
    }
    return out;
  }

  function summarize(from, to, now) {
    now = now || Date.now();
    const otMap = computeOT(now);
    const list = sorted().filter((e) => e.start >= from && e.start < to);
    let total = 0, ot = 0, brk = 0;
    const days = new Set();
    const rows = list.map((e) => {
      const d = durOf(e, now), o = otMap.get(e.id) || 0;
      total += d; ot += o; brk += breakOf(e, now);
      if (d > 0) days.add(dayKey(e.start));
      return { e, dur: d, ot: o, brk: breakOf(e, now) };
    });
    const reg = total - ot;
    const rate = Number(S().rate) || 0;
    const pay = rate > 0 ? (reg / HOUR) * rate + (ot / HOUR) * rate * (Number(S().otMult) || 1) : null;
    return { from, to, rows, total, ot, reg, brk, pay, days: days.size };
  }

  // ---------- UI helpers ----------
  const $ = (id) => document.getElementById(id);
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function vibrate() { try { navigator.vibrate && navigator.vibrate(30); } catch (e) { /* ignore */ } }

  let currentView = 'clock';
  function showView(v) {
    currentView = v;
    document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === 'view-' + v));
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    try { sessionStorage.setItem('tc.view', v); } catch (e) { /* ignore */ }
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    if (currentView === 'clock') renderClock();
    else if (currentView === 'sheet') renderSheet();
    else if (currentView === 'reports') renderReports();
    else if (currentView === 'settings') renderSettings();
  }

  // ---------- Clock view ----------
  function renderClock() {
    const now = Date.now();
    $('nowDate').textContent = new Date(now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    $('nowTime').textContent = fmtTimeSec(now);

    const open = openEntry();
    const punch = $('punchBtn'), brkBtn = $('breakBtn'), status = $('status');
    if (open) {
      punch.textContent = 'Clock Out';
      punch.classList.add('out');
      brkBtn.hidden = false;
      brkBtn.textContent = open.breakStart ? 'End Break' : 'Start Break';
      $('noteWrap').hidden = false;
      const noteInput = $('shiftNote');
      if (document.activeElement !== noteInput) noteInput.value = open.note || '';
      if (open.breakStart) {
        status.textContent = `On break since ${fmtTime(open.breakStart)}`;
        status.className = 'status brk';
        $('shiftTimer').textContent = 'Break ' + fmtClock(now - open.breakStart);
      } else {
        status.textContent = `Clocked in at ${fmtTime(open.start)}${startOfDay(open.start) !== startOfDay(now) ? ' (' + fmtDate(open.start, { month: 'short', day: 'numeric' }) + ')' : ''}`;
        status.className = 'status in';
        $('shiftTimer').textContent = fmtClock(durOf(open, now));
      }
    } else {
      punch.textContent = 'Clock In';
      punch.classList.remove('out');
      brkBtn.hidden = true;
      $('noteWrap').hidden = true;
      const last = sorted().filter((e) => e.end != null).pop();
      status.textContent = last ? `Clocked out at ${fmtTime(last.end)}${startOfDay(last.end) !== startOfDay(now) ? ' on ' + fmtDate(last.end, { weekday: 'short', month: 'short', day: 'numeric' }) : ''}` : 'Not clocked in';
      status.className = 'status out';
      $('shiftTimer').textContent = '';
    }

    const today = summarize(startOfDay(now), addDays(startOfDay(now), 1), now);
    const wk0 = startOfWeek(now);
    const week = summarize(wk0, addDays(wk0, 7), now);
    $('todayTotal').textContent = fmtH(today.total);
    $('weekTotal').textContent = fmtH(week.total);
    $('weekOT').textContent = fmtH(week.ot);

    const thr = Number(S().otWeekly) * HOUR;
    const bar = $('weekBar');
    if (thr > 0) {
      bar.style.width = Math.min(100, (week.total / thr) * 100) + '%';
      bar.classList.toggle('over', week.total > thr);
      $('weekBarLabel').textContent = week.total >= thr
        ? `${fmtH(week.total - thr)} overtime this week`
        : `${fmtH(thr - week.total)} until overtime (${S().otWeekly} h)`;
    } else {
      bar.style.width = '0';
      $('weekBarLabel').textContent = '';
    }

    const ul = $('todayList');
    if (!today.rows.length) {
      ul.innerHTML = '<li class="empty">No punches yet today</li>';
    } else {
      ul.innerHTML = today.rows.map(({ e, dur, brk }) =>
        `<li data-id="${e.id}"><span>${esc(fmtTime(e.start))} → ${e.end == null ? '<b>now</b>' : esc(fmtTime(e.end))}${brk >= MIN ? ` <small class="hint">(${Math.round(brk / MIN)}m break)</small>` : ''}${e.note ? `<span class="pnote">${esc(e.note)}</span>` : ''}</span><b>${fmtH(dur)}</b></li>`
      ).join('');
    }
  }

  let punchLock = false;
  function clockIn(at) {
    if (openEntry()) { toast('You are already clocked in.'); return false; }
    const now = Date.now();
    const start = at != null ? at : now;
    if (start > now + MIN) { toast('That clock-in time is in the future.'); return false; }
    const last = sorted().filter((e) => e.end != null).pop();
    if (last && start < last.end) { toast(`That overlaps your last shift (ended ${fmtTime(last.end)}).`); return false; }
    state.entries.push({ id: uid(), start, end: null, breakMs: 0, breakStart: null, note: '' });
    save();
    toast(`Clocked in at ${fmtTime(start)}`);
    return true;
  }
  function clockOut(at) {
    const open = openEntry();
    if (!open) { toast('You are not clocked in.'); return false; }
    const now = Date.now();
    const end = at != null ? at : now;
    if (end > now + MIN) { toast('That clock-out time is in the future.'); return false; }
    if (end <= open.start) { toast(`Clock out must be after ${fmtTime(open.start)}.`); return false; }
    if (open.breakStart) { open.breakMs += Math.max(0, Math.min(end, now) - open.breakStart); open.breakStart = null; }
    const noteEl = $('shiftNote');
    if (document.activeElement === noteEl || noteEl.value.trim() !== (open.note || '')) open.note = noteEl.value.trim();
    open.end = end;
    save();
    toast(`Clocked out at ${fmtTime(end)} — ${fmtH(durOf(open, end))} worked`);
    return true;
  }
  function punch() {
    if (punchLock) return;
    punchLock = true; setTimeout(() => { punchLock = false; }, 900);
    if (openEntry()) clockOut(); else clockIn();
    vibrate();
    render();
  }
  function toggleBreak(want) {
    const open = openEntry();
    if (!open) { toast('You are not clocked in.'); return; }
    const now = Date.now();
    const onBreak = !!open.breakStart;
    if (want === 'start' && onBreak) { toast('Already on break.'); return; }
    if (want === 'end' && !onBreak) { toast('You are not on a break.'); return; }
    if (onBreak) {
      const len = now - open.breakStart;
      open.breakMs += len;
      open.breakStart = null;
      toast(`Break ended (${Math.max(1, Math.round(len / MIN))} min) — back on the clock`);
    } else {
      open.breakStart = now;
      toast('Break started');
    }
    save();
    vibrate();
    render();
  }

  // ---------- Voice ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let activeRec = null;
  function stopListening() { if (activeRec) { try { activeRec.abort(); } catch (e) { /* ignore */ } } }
  /** Listen once; calls onText(finalText) when done. btn gets a listening state. */
  function listen(btn, onText, onInterim) {
    if (!SR) { toast('Voice input is not available here — use the mic key on your keyboard.'); return; }
    if (activeRec) { const same = activeRec._btn === btn; stopListening(); if (same) return; }
    const rec = new SR();
    rec._btn = btn;
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      if (onInterim) onInterim((finalText + ' ' + interim).trim());
    };
    rec.onerror = (ev) => {
      const msg = {
        'not-allowed': 'Microphone permission was denied. Allow it in your browser settings.',
        'service-not-allowed': 'Voice input is blocked on this device. Use the mic key on your keyboard instead.',
        network: 'This browser needs internet for voice input. Offline, use the mic key on your keyboard instead.',
        'no-speech': 'Didn’t hear anything — try again.',
        'audio-capture': 'No microphone found.',
      }[ev.error];
      if (msg) toast(msg);
    };
    rec.onend = () => {
      btn.classList.remove('listening');
      activeRec = null;
      if (finalText.trim()) onText(finalText.trim());
    };
    try { rec.start(); } catch (e) { toast('Could not start voice input.'); return; }
    activeRec = rec;
    btn.classList.add('listening');
    vibrate();
  }
  function micForField(btn) {
    const el = $(btn.dataset.for);
    const append = btn.dataset.mode === 'append';
    const before = el.value;
    const join = (t) => (append && before.trim() ? before.replace(/\s+$/, '') + ' ' + t : t);
    listen(btn, (t) => {
      const text = append ? t.charAt(0).toUpperCase() + t.slice(1) : t;
      el.value = join(text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, (t) => { el.value = join(t); });
  }

  /** Clock-screen voice commands. */
  function voiceCommand(raw) {
    const t = raw.toLowerCase();
    const P = window.TCParse;
    const timeIn = (txt) => { const x = P.parseTime(txt.replace(/\b(clock|punch|check|sign)(ed|ing)?\s*(me\s*)?(in|out)\b/g, ' ')); return x; };
    const open = openEntry();
    const noteM = /^\s*(?:add\s+(?:a\s+)?)?notes?\b\s*(?:that|:|-)?\s*(.*)$/i.exec(raw);
    if (noteM) {
      if (!open) { toast('Clock in first, or add the note on the Timesheet tab.'); return; }
      const add = noteM[1].trim();
      if (!add) return;
      open.note = (open.note ? open.note.replace(/\s+$/, '') + ' ' : '') + add.charAt(0).toUpperCase() + add.slice(1);
      save(); render(); toast('Note added');
      return;
    }
    if (/\b(end|stop|finish(ed)?|done with|back from|over)\b.*\b(break|lunch)\b|\b(break|lunch)\b.*\b(over|done|finished)\b|\bback to work\b/.test(t)) { toggleBreak('end'); return; }
    if (/\b(start|take|taking|going (on|to)|on|begin)\b.*\b(break|lunch)\b|^\s*(break|lunch)( time)?\s*$/.test(t)) { toggleBreak('start'); return; }
    const isIn = /\b(clock|punch|check|sign)(ed|ing)?\s*(me\s*)?in\b|\bstart(ing|ed)?\s+(work|my shift|the day|shift)\b/.test(t);
    const isOut = /\b(clock|punch|check|sign)(ed|ing)?\s*(me\s*)?out\b|\b(done|finished|stop(ping)?|quit(ting)?)\b.*\b(work|day|shift)\b|\bend(ing)?\s+(my\s+|the\s+)?(shift|day)\b|\bgoing home\b/.test(t);
    if (isIn || isOut) {
      const tm = timeIn(t);
      if (isIn) {
        const at = tm ? Math.min(P.startTs(startOfDay(Date.now()), tm), Date.now()) : null;
        if (tm && P.startTs(startOfDay(Date.now()), tm) > Date.now() + MIN) { toast('That clock-in time is later than now.'); return; }
        clockIn(at);
      } else {
        const at = tm && open ? P.endTs(open.start, tm) : null;
        clockOut(at);
      }
      vibrate(); render();
      return;
    }
    // Anything else with a time in it: treat as a manual entry
    const p = P.parseEntry(raw);
    if (p.inT) { openEdit(null, null, raw); return; }
    toast(`Didn’t catch that: “${raw}”`);
  }

  // ---------- Timesheet view ----------
  let sheetWeek = startOfWeek(Date.now());
  function renderSheet() {
    const now = Date.now();
    const from = sheetWeek, to = addDays(sheetWeek, 7);
    const sum = summarize(from, to, now);
    $('weekTitle').textContent = `${fmtDate(from, { month: 'short', day: 'numeric' })} – ${fmtDate(addDays(to, -1), { month: 'short', day: 'numeric', year: 'numeric' })}`;
    $('weekToday').hidden = sheetWeek === startOfWeek(now);
    $('sheetTotal').textContent = fmtH(sum.total);
    $('sheetReg').textContent = fmtH(sum.reg);
    $('sheetOT').textContent = fmtH(sum.ot);
    $('sheetPay').textContent = sum.pay != null ? `Gross pay ${fmtMoney(sum.pay)}  ·  ${sum.days} day${sum.days === 1 ? '' : 's'} worked` : `${sum.days} day${sum.days === 1 ? '' : 's'} worked`;

    const todayKey = dayKey(now);
    let html = '';
    for (let i = 0; i < 7; i++) {
      const d0 = addDays(from, i), d1 = addDays(from, i + 1);
      const rows = sum.rows.filter((r) => r.e.start >= d0 && r.e.start < d1);
      const dayTotal = rows.reduce((a, r) => a + r.dur, 0);
      const cls = ['day', dayKey(d0) === todayKey ? 'today' : '', rows.length ? '' : 'empty-day'].join(' ');
      html += `<div class="${cls}"><div class="day-head"><span>${esc(fmtDowLong(d0))}<span class="dt">${esc(fmtDate(d0, { month: 'short', day: 'numeric' }))}</span></span><span>${rows.length ? fmtH(dayTotal) : '—'}<button class="add-day" data-day="${d0}" aria-label="Add entry for this day">＋</button></span></div>`;
      for (const r of rows) {
        const e = r.e;
        const meta = [];
        if (r.brk >= MIN) meta.push(`${Math.round(r.brk / MIN)} min break`);
        if (r.ot > 0) meta.push(`${fmtH(r.ot)} overtime`);
        if (e.end != null && startOfDay(e.end) !== startOfDay(e.start)) meta.push(`ends ${fmtDate(e.end, { weekday: 'short' })}`);
        if (e.note) meta.push(esc(e.note));
        html += `<button class="entry" data-id="${e.id}"><span class="times">${esc(fmtTime(e.start))} → ${e.end == null ? '<span class="live">on the clock</span>' : esc(fmtTime(e.end))}</span><span class="dur">${fmtH(r.dur)}</span>${meta.length ? `<span class="meta">${meta.join(' · ')}</span>` : ''}</button>`;
      }
      html += '</div>';
    }
    $('sheetDays').innerHTML = html;
  }

  // ---------- Edit dialog ----------
  let editing = null; // entry id or 'new'
  let editDay = null; // default day for new entries
  const F = (n) => $('editForm').elements[n];
  function inputTime(t) {
    const d = new Date(t);
    if (S().clock24) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const h = d.getHours() % 12 || 12;
    return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  }
  const inputDate = (t) => fmtDate(t, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  function openEdit(id, day, quick) {
    const dlg = $('editDlg');
    $('editErr').textContent = '';
    $('kbdHint').hidden = !!SR;
    F('quick').value = '';
    if (id) {
      const e = state.entries.find((x) => x.id === id);
      if (!e) return;
      editing = id;
      $('editTitle').textContent = 'Edit entry';
      F('date').value = inputDate(e.start);
      F('start').value = inputTime(e.start);
      F('end').value = e.end != null ? inputTime(e.end) : '';
      const b = Math.round(breakOf(e, Date.now()) / MIN);
      F('breakMin').value = b ? String(b) : '';
      F('note').value = e.note || '';
      $('editDelete').hidden = false;
    } else {
      editing = 'new';
      editDay = day != null ? day : (currentView === 'sheet' && sheetWeek !== startOfWeek(Date.now()) ? sheetWeek : startOfDay(Date.now()));
      $('editTitle').textContent = 'Add entry';
      F('date').value = inputDate(editDay);
      F('start').value = ''; F('end').value = ''; F('breakMin').value = ''; F('note').value = '';
      $('editDelete').hidden = true;
      if (quick) { F('quick').value = quick; applyQuick(); }
    }
    updatePreview();
    dlg.showModal();
    if (editing === 'new' && !quick) setTimeout(() => F('quick').focus(), 50);
  }

  /** Fill the individual fields from the "all at once" box. */
  function applyQuick() {
    const P = window.TCParse;
    const p = P.parseEntry(F('quick').value);
    const day = p.day != null ? p.day : null;
    if (day != null) F('date').value = inputDate(day);
    const baseDay = day != null ? day : (P.parseDate(F('date').value) ?? startOfDay(Date.now()));
    if (p.inT) {
      const r = P.resolve(Object.assign({}, p, { day: baseDay }));
      F('start').value = inputTime(r.start);
      if (r.end != null) F('end').value = inputTime(r.end);
    }
    if (p.breakMin != null) F('breakMin').value = String(p.breakMin);
    if (p.note) F('note').value = p.note;
    updatePreview();
  }

  /** Read the form into { start, end, breakMs, note } or { error }. */
  function readForm() {
    const P = window.TCParse;
    const now = Date.now();
    const dTxt = F('date').value.trim();
    let day = dTxt ? P.parseDate(dTxt) : (editDay ?? startOfDay(now));
    if (day == null) return { error: `Couldn’t understand the date “${dTxt}”. Try “today”, “mon”, or “11/20”.` };
    const inTxt = F('start').value.trim(), outTxt = F('end').value.trim();
    if (!inTxt) return { error: 'Enter a clock-in time (like 7, 730 or 7:30am).' };
    let start;
    if (/^now$/i.test(inTxt)) start = Math.floor(now / MIN) * MIN;
    else {
      const t = P.parseTime(inTxt);
      if (!t) return { error: `Couldn’t understand the clock-in time “${inTxt}”.` };
      start = P.startTs(day, t);
    }
    let end = null;
    if (outTxt) {
      if (/^now$/i.test(outTxt)) end = Math.floor(now / MIN) * MIN;
      else {
        const t = P.parseTime(outTxt);
        if (!t) return { error: `Couldn’t understand the clock-out time “${outTxt}”.` };
        end = P.endTs(start, t);
      }
    }
    const bTxt = F('breakMin').value.trim();
    const bMin = bTxt ? P.parseMinutes(bTxt) : 0;
    if (bMin == null) return { error: `Couldn’t understand the break “${bTxt}”. Try 30, 1:00 or “half hour”.` };
    return { start, end, breakMs: bMin * MIN, note: F('note').value.trim() };
  }

  function updatePreview() {
    const el = $('editPreview');
    const r = readForm();
    if (r.error) {
      const empty = !F('start').value.trim();
      el.textContent = empty ? '' : r.error;
      el.classList.toggle('bad', !empty);
      return;
    }
    el.classList.remove('bad');
    const d = fmtDate(r.start, { weekday: 'short', month: 'short', day: 'numeric' });
    if (r.end == null) {
      el.textContent = `${d} · ${fmtTime(r.start)} → still on the clock`;
      return;
    }
    const worked = Math.max(0, roundTs(r.end) - roundTs(r.start) - r.breakMs);
    const nextDay = startOfDay(r.end) !== startOfDay(r.start) ? ` (${fmtDow(r.end)})` : '';
    el.textContent = `${d} · ${fmtTime(r.start)} → ${fmtTime(r.end)}${nextDay} · ${fmtH(worked)} worked${r.breakMs ? ` (${Math.round(r.breakMs / MIN)} min break)` : ''}`;
  }

  function saveEdit(ev) {
    ev.preventDefault();
    const err = (m) => { $('editErr').textContent = m; };
    const r = readForm();
    if (r.error) return err(r.error);
    const { start, end, breakMs, note } = r;
    if (end != null && end - start > 2 * 86400000) return err('That shift is longer than 2 days — check the times.');
    if (end != null && breakMs >= end - start) return err('The break is longer than the shift.');
    if (start > Date.now() + MIN && end == null) return err('An open shift can’t start in the future.');
    const others = state.entries.filter((x) => x.id !== editing);
    if (end == null && others.some((x) => x.end == null)) return err('You’re already clocked in on another entry. Add a clock-out time.');
    const overlap = others.find((x) => {
      const xe = x.end == null ? Date.now() : x.end;
      const me = end == null ? Date.now() : end;
      return start < xe && x.start < me;
    });
    if (overlap) return err(`Overlaps with ${fmtDate(overlap.start, { month: 'short', day: 'numeric' })} ${fmtTime(overlap.start)} – ${overlap.end ? fmtTime(overlap.end) : 'now'}.`);

    if (editing === 'new') {
      state.entries.push({ id: uid(), start, end, breakMs, breakStart: null, note });
      toast('Entry added');
    } else {
      const e = state.entries.find((x) => x.id === editing);
      const wasOnBreak = e.end == null && e.breakStart;
      e.start = start; e.end = end; e.note = note;
      if (wasOnBreak && end == null) e.breakMs = Math.max(0, breakMs - (Date.now() - e.breakStart));
      else { e.breakMs = breakMs; e.breakStart = null; }
      toast('Entry saved');
    }
    save();
    closeEdit();
    render();
  }
  function closeEdit() { stopListening(); $('editDlg').close(); }
  function deleteEdit() {
    if (!editing || editing === 'new') return;
    if (!confirm('Delete this entry?')) return;
    state.entries = state.entries.filter((x) => x.id !== editing);
    save();
    closeEdit();
    toast('Entry deleted');
    render();
  }

  // ---------- Reports ----------
  let repType = 'week';
  let repAnchor = Date.now();
  function repRange() {
    const a = repAnchor;
    switch (repType) {
      case 'week': { const f = startOfWeek(a); return [f, addDays(f, 7)]; }
      case 'biweek': { const f = startOfWeek(a); return [f, addDays(f, 14)]; }
      case 'month': { const f = startOfMonth(a); return [f, addMonths(f, 1)]; }
      case 'quarter': { const f = startOfQuarter(a); return [f, addMonths(f, 3)]; }
      case 'year': { const f = startOfYear(a); return [f, addMonths(f, 12)]; }
      default: {
        let f = fromLocalInput($('repFrom').value), t = fromLocalInput($('repTo').value);
        if (f == null) f = startOfMonth(Date.now());
        if (t == null) t = startOfDay(Date.now());
        if (t < f) [f, t] = [t, f];
        return [f, addDays(t, 1)];
      }
    }
  }
  function shiftRep(dir) {
    const a = repAnchor;
    repAnchor = {
      week: () => addDays(a, 7 * dir), biweek: () => addDays(a, 14 * dir), month: () => addMonths(a, dir),
      quarter: () => addMonths(a, 3 * dir), year: () => addMonths(a, 12 * dir),
    }[repType]();
    renderReports();
  }
  function rangeLabel(from, to) {
    const last = addDays(to, -1);
    if (repType === 'month') return new Date(from).toLocaleDateString([], { month: 'long', year: 'numeric' });
    if (repType === 'quarter') return `Q${Math.floor(new Date(from).getMonth() / 3) + 1} ${new Date(from).getFullYear()}`;
    if (repType === 'year') return String(new Date(from).getFullYear());
    if (from === last) return fmtDate(from, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    return `${fmtDate(from)} – ${fmtDate(last)}`;
  }
  function breakdownMode(from, to) {
    const days = Math.round((to - from) / DAY);
    if (repType === 'week' || repType === 'biweek') return 'day';
    if (repType === 'month' || repType === 'quarter') return 'week';
    if (repType === 'year') return 'month';
    return days <= 14 ? 'day' : days <= 120 ? 'week' : 'month';
  }
  /** Breakdown buckets [{label, sum}] for a range. */
  function buckets(from, to, now) {
    const mode = breakdownMode(from, to);
    const out = [];
    if (mode === 'day') {
      for (let d = from; d < to; d = addDays(d, 1)) {
        out.push({ label: `${fmtDow(d)} ${fmtDate(d, { month: 'short', day: 'numeric' })}`, sum: summarize(d, addDays(d, 1), now) });
      }
    } else if (mode === 'week') {
      for (let w = startOfWeek(from); w < to; w = addDays(w, 7)) {
        const f = Math.max(w, from), t = Math.min(addDays(w, 7), to);
        out.push({ label: `Week of ${fmtDate(w, { month: 'short', day: 'numeric' })}`, sum: summarize(f, t, now) });
      }
    } else {
      for (let m = startOfMonth(from); m < to; m = addMonths(m, 1)) {
        const f = Math.max(m, from), t = Math.min(addMonths(m, 1), to);
        out.push({ label: new Date(m).toLocaleDateString([], { month: 'long', year: 'numeric' }), sum: summarize(f, t, now) });
      }
    }
    return { mode, out };
  }
  function renderReports() {
    const now = Date.now();
    $('customRange').hidden = repType !== 'custom';
    $('repNav').hidden = repType === 'custom';
    document.querySelectorAll('#periodSeg button').forEach((b) => b.classList.toggle('on', b.dataset.p === repType));
    const [from, to] = repRange();
    const sum = summarize(from, to, now);
    $('repTitle').textContent = rangeLabel(from, to);
    $('repToday').hidden = repType !== 'custom' && now >= from && now < to;
    $('repTotal').textContent = fmtH(sum.total);
    $('repDays').textContent = sum.days;
    $('repAvg').textContent = fmtH(sum.days ? sum.total / sum.days : 0);
    $('repReg').textContent = fmtH(sum.reg);
    $('repOT').textContent = fmtH(sum.ot);
    $('repPay').textContent = sum.pay != null ? fmtMoney(sum.pay) : '—';

    const { mode, out } = buckets(from, to, now);
    const showPay = sum.pay != null;
    const head = `<thead><tr><th>${mode === 'day' ? 'Day' : mode === 'week' ? 'Week' : 'Month'}</th>${mode !== 'day' ? '<th>Days</th>' : '<th>Shifts</th>'}<th>Hours</th><th>OT</th>${showPay ? '<th>Pay</th>' : ''}</tr></thead>`;
    const rows = out.filter((b) => mode === 'day' || b.sum.rows.length || repType !== 'custom').map((b) =>
      `<tr><td>${esc(b.label)}</td><td>${mode === 'day' ? b.sum.rows.length || '' : b.sum.days || ''}</td><td>${b.sum.total ? fmtH(b.sum.total) : '—'}</td><td>${b.sum.ot ? fmtH(b.sum.ot) : ''}</td>${showPay ? `<td>${b.sum.pay ? fmtMoney(b.sum.pay) : ''}</td>` : ''}</tr>`).join('');
    const foot = `<tfoot><tr><td>Total</td><td>${mode === 'day' ? sum.rows.length : sum.days}</td><td>${fmtH(sum.total)}</td><td>${fmtH(sum.ot)}</td>${showPay ? `<td>${fmtMoney(sum.pay)}</td>` : ''}</tr></tfoot>`;
    $('repTable').innerHTML = head + '<tbody>' + (rows || `<tr><td class="none" colspan="5">No entries</td></tr>`) + '</tbody>' + foot;
  }

  // ---------- PDF ----------
  function fileStamp(from, to) { return from === addDays(to, -1) ? dayKey(from) : `${dayKey(from)}_to_${dayKey(addDays(to, -1))}`; }

  function buildPdf(from, to, label, opts) {
    if (!window.jspdf || !window.jspdf.jsPDF) { toast('PDF library failed to load.'); return null; }
    const now = Date.now();
    const s = S();
    const sum = summarize(from, to, now);
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
    const W = doc.internal.pageSize.getWidth();
    const M = 40;
    const accent = [15, 118, 110];
    const showPay = sum.pay != null;

    // Header
    doc.setFillColor(...accent);
    doc.rect(0, 0, W, 6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(20);
    doc.text('Timesheet', M, 44);
    doc.setFontSize(12); doc.setFont('helvetica', 'normal'); doc.setTextColor(80);
    doc.text(label, M, 62);
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`Generated ${new Date(now).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`, W - M, 44, { align: 'right' });

    let y = 84;
    const info = [];
    if (s.name) info.push(['Name', s.name]);
    if (s.employer) info.push(['Employer', s.employer]);
    if (s.position) info.push(['Position', s.position]);
    info.push(['Period', `${fmtDate(from, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} – ${fmtDate(addDays(to, -1), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`]);
    doc.setFontSize(10);
    for (const [k, v] of info) {
      doc.setFont('helvetica', 'bold'); doc.setTextColor(90); doc.text(k + ':', M, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(20); doc.text(String(v), M + 62, y);
      y += 15;
    }
    y += 6;

    // Summary
    const summaryBody = [
      ['Total hours', `${fmtHM(sum.total)}  (${fmtDec(sum.total)} h)`, 'Days worked', String(sum.days)],
      ['Regular hours', `${fmtHM(sum.reg)}  (${fmtDec(sum.reg)} h)`, 'Shifts', String(sum.rows.length)],
      ['Overtime hours', `${fmtHM(sum.ot)}  (${fmtDec(sum.ot)} h)`, 'Avg per day worked', sum.days ? fmtHM(sum.total / sum.days) : '0:00'],
      ['Unpaid breaks', `${fmtHM(sum.brk)}  (${fmtDec(sum.brk)} h)`, showPay ? 'Gross pay' : 'Overtime rule', showPay ? fmtMoney(sum.pay) : (Number(s.otWeekly) > 0 ? `After ${s.otWeekly} h/week` : 'None')],
    ];
    if (showPay) summaryBody.push(['Hourly rate', fmtMoney(Number(s.rate)), 'Overtime rate', `${fmtMoney(Number(s.rate) * Number(s.otMult))} (x${s.otMult}, after ${s.otWeekly} h/wk)`]);
    doc.autoTable({
      startY: y, margin: { left: M, right: M }, theme: 'plain', body: summaryBody,
      styles: { fontSize: 10, cellPadding: { top: 4, bottom: 4, left: 6, right: 6 } },
      columnStyles: { 0: { fontStyle: 'bold', textColor: 90, cellWidth: 100 }, 2: { fontStyle: 'bold', textColor: 90, cellWidth: 115 } },
      didDrawCell: (d) => { if (d.row.index === 0 && d.column.index === 0) { /* noop */ } },
      tableLineColor: [220, 225, 230], tableLineWidth: 0.5,
    });
    y = doc.lastAutoTable.finalY + 18;

    const headStyle = { fillColor: accent, textColor: 255, fontStyle: 'bold' };
    const sectionTitle = (t) => {
      if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = 50; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20); doc.text(t, M, y); y += 8;
    };

    // Breakdown
    const { mode, out } = buckets(from, to, now);
    const bHead = [mode === 'day' ? 'Day' : mode === 'week' ? 'Week' : 'Month', mode === 'day' ? 'Shifts' : 'Days', 'Hours', 'Decimal', 'Regular', 'Overtime'];
    if (showPay) bHead.push('Gross pay');
    const bBody = out.map((b) => {
      const r = [b.label, String(mode === 'day' ? b.sum.rows.length : b.sum.days), fmtHM(b.sum.total), fmtDec(b.sum.total), fmtHM(b.sum.reg), fmtHM(b.sum.ot)];
      if (showPay) r.push(b.sum.pay ? fmtMoney(b.sum.pay) : '');
      return r;
    });
    const bFoot = ['Total', String(mode === 'day' ? sum.rows.length : sum.days), fmtHM(sum.total), fmtDec(sum.total), fmtHM(sum.reg), fmtHM(sum.ot)];
    if (showPay) bFoot.push(fmtMoney(sum.pay));
    sectionTitle(mode === 'day' ? 'Daily totals' : mode === 'week' ? 'Weekly totals' : 'Monthly totals');
    doc.autoTable({
      startY: y, margin: { left: M, right: M }, head: [bHead], body: bBody, foot: [bFoot],
      headStyles: headStyle, footStyles: { fillColor: [235, 245, 244], textColor: 20, fontStyle: 'bold' },
      styles: { fontSize: 9, halign: 'right' },
      didParseCell: (d) => { d.cell.styles.halign = d.column.index === 0 ? 'left' : 'right'; },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
    y = doc.lastAutoTable.finalY + 20;

    // Detail
    if (opts.detail) {
      sectionTitle('Time entries');
      const dHead = ['Date', 'Day', 'In', 'Out', 'Break', 'Hours', 'OT', 'Note'];
      const dBody = sum.rows.map(({ e, dur, ot, brk }) => [
        fmtDate(e.start, { month: '2-digit', day: '2-digit', year: 'numeric' }),
        fmtDow(e.start),
        fmtTime(e.start),
        e.end == null ? 'In progress' : fmtTime(e.end) + (startOfDay(e.end) !== startOfDay(e.start) ? ` (${fmtDow(e.end)})` : ''),
        brk >= MIN ? `${Math.round(brk / MIN)} min` : '',
        fmtHM(dur),
        ot ? fmtHM(ot) : '',
        e.note || '',
      ]);
      doc.autoTable({
        startY: y, margin: { left: M, right: M }, head: [dHead],
        body: dBody.length ? dBody : [[{ content: 'No time entries in this period.', colSpan: 8, styles: { halign: 'center', textColor: 120 } }]],
        foot: dBody.length ? [['Total', '', '', '', sum.brk >= MIN ? fmtHM(sum.brk) : '', fmtHM(sum.total), fmtHM(sum.ot), '']] : undefined,
        headStyles: headStyle, footStyles: { fillColor: [235, 245, 244], textColor: 20, fontStyle: 'bold' },
        styles: { fontSize: 8.5, cellPadding: 4 },
        columnStyles: { 5: { fontStyle: 'bold' }, 7: { cellWidth: 150 } },
        didParseCell: (d) => { if ([4, 5, 6].includes(d.column.index)) d.cell.styles.halign = 'right'; },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
      y = doc.lastAutoTable.finalY + 20;
    }

    // Signatures
    if (opts.sign) {
      if (y > doc.internal.pageSize.getHeight() - 110) { doc.addPage(); y = 60; }
      y += 30;
      doc.setDrawColor(120); doc.setLineWidth(0.6);
      const colW = (W - 2 * M - 40) / 2;
      doc.line(M, y, M + colW, y); doc.line(M + colW + 40, y, W - M, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
      doc.text(`Employee signature${s.name ? ' — ' + s.name : ''}`, M, y + 13);
      doc.text('Date', M + colW - 60, y + 13);
      doc.text('Supervisor signature', M + colW + 40, y + 13);
      doc.text('Date', W - M - 60, y + 13);
    }

    // Footer page numbers
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(140); doc.setFont('helvetica', 'normal');
      const H = doc.internal.pageSize.getHeight();
      doc.text(`${s.name ? s.name + ' · ' : ''}Timesheet · ${label}`, M, H - 20);
      doc.text(`Page ${i} of ${pages}`, W - M, H - 20, { align: 'right' });
    }
    return doc;
  }

  function exportPdf(from, to, label, opts) {
    const doc = buildPdf(from, to, label, opts);
    if (!doc) return;
    const blob = doc.output('blob');
    saveFile(blob, `Timesheet_${fileStamp(from, to)}.pdf`, 'application/pdf');
  }

  function exportCsv(from, to) {
    const sum = summarize(from, to, Date.now());
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Date', 'Day', 'Clock In', 'Clock Out', 'Break (min)', 'Hours (h:mm)', 'Hours (decimal)', 'Overtime (decimal)', 'Note'].map(q).join(',')];
    for (const { e, dur, ot, brk } of sum.rows) {
      lines.push([dayKey(e.start), fmtDow(e.start), toLocalInput(e.start).replace('T', ' '), e.end == null ? '' : toLocalInput(e.end).replace('T', ' '),
        Math.round(brk / MIN), fmtHM(dur), fmtDec(dur), fmtDec(ot), e.note || ''].map(q).join(','));
    }
    lines.push(['Total', '', '', '', Math.round(sum.brk / MIN), fmtHM(sum.total), fmtDec(sum.total), fmtDec(sum.ot), ''].map(q).join(','));
    saveFile(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }), `Timesheet_${fileStamp(from, to)}.csv`, 'text/csv');
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  async function saveFile(blob, name, type) {
    // iOS home-screen apps can't do normal downloads; use the share sheet ("Save to Files").
    if (isIOS && navigator.canShare) {
      try {
        const file = new File([blob], name, { type });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast(`Saved ${name}`);
  }

  // ---------- Settings ----------
  function renderSettings() {
    const f = $('settingsForm');
    const s = S();
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      const el = f.elements[k];
      if (el && document.activeElement !== el) el.value = String(s[k]);
    }
    $('lastBackup').textContent = state.meta.lastBackup
      ? `Last backup: ${new Date(state.meta.lastBackup).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
      : 'No backup downloaded yet.';
    const n = state.entries.length;
    const first = n ? sorted()[0].start : null;
    $('storageInfo').textContent = `${n} entr${n === 1 ? 'y' : 'ies'} stored on this device${first ? ' since ' + fmtDate(first) : ''}.`;
  }
  function onSettingsInput(ev) {
    const el = ev.target;
    if (!el.name || !(el.name in DEFAULT_SETTINGS)) return;
    let v = el.value;
    const def = DEFAULT_SETTINGS[el.name];
    if (typeof def === 'number') { v = Number(v); if (!Number.isFinite(v) || v < 0) v = def; }
    if (typeof def === 'boolean') v = v === 'true';
    if (el.name === 'otMult' && v < 1) v = 1;
    state.settings[el.name] = v;
    if (el.name === 'weekStart') sheetWeek = startOfWeek(sheetWeek + 3 * DAY);
    save();
    $('savedHint').textContent = 'Saved ✓';
    clearTimeout(onSettingsInput.t);
    onSettingsInput.t = setTimeout(() => { $('savedHint').textContent = 'Changes save automatically.'; }, 1500);
  }

  function backup() {
    const data = { app: 'timeclock', version: 1, exportedAt: new Date().toISOString(), settings: state.settings, entries: state.entries };
    state.meta.lastBackup = Date.now();
    save();
    saveFile(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `TimeClock_backup_${dayKey(Date.now())}.json`, 'application/json');
    renderSettings();
  }
  function restore(file) {
    const r = new FileReader();
    r.onload = () => {
      let data;
      try { data = JSON.parse(r.result); } catch (e) { toast('That file is not a valid backup.'); return; }
      if (!data || !Array.isArray(data.entries)) { toast('That file is not a Time Clock backup.'); return; }
      const entries = data.entries.filter(validEntry).map(normEntry);
      if (!confirm(`Restore ${entries.length} entries from this backup? This replaces the ${state.entries.length} entries currently on this device.`)) return;
      state.entries = entries;
      state.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
      save();
      toast(`Restored ${entries.length} entries`);
      render();
    };
    r.readAsText(file);
  }
  function wipe() {
    if (!confirm('Erase ALL time entries and settings from this device? This cannot be undone.')) return;
    if (prompt('Type ERASE to confirm') !== 'ERASE') return;
    state = { entries: [], settings: Object.assign({}, DEFAULT_SETTINGS), meta: {} };
    save();
    toast('All data erased');
    render();
  }

  // ---------- Wire up ----------
  function init() {
    document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
    $('punchBtn').addEventListener('click', punch);
    $('breakBtn').addEventListener('click', toggleBreak);
    if (!SR) document.body.classList.add('no-sr');
    $('voiceCmdBtn').hidden = !SR;
    $('voiceHint').hidden = !SR;
    $('voiceCmdBtn').addEventListener('click', () => {
      const b = $('voiceCmdBtn');
      listen(b, (t) => { b.textContent = '🎤 Voice command'; voiceCommand(t); }, (t) => { b.textContent = '“' + t + '”'; });
      if (!b.classList.contains('listening')) b.textContent = '🎤 Voice command';
      else b.textContent = 'Listening…';
    });
    document.addEventListener('click', (ev) => { const m = ev.target.closest('.mic'); if (m) { ev.preventDefault(); micForField(m); } });
    $('todayList').addEventListener('click', (ev) => { const li = ev.target.closest('li[data-id]'); if (li) openEdit(li.dataset.id); });
    let noteT;
    $('shiftNote').addEventListener('input', (ev) => {
      clearTimeout(noteT);
      noteT = setTimeout(() => { const o = openEntry(); if (o) { o.note = ev.target.value.trim(); save(); } }, 400);
    });

    $('weekPrev').addEventListener('click', () => { sheetWeek = startOfWeek(addDays(sheetWeek, -7) + 3 * DAY); renderSheet(); });
    $('weekNext').addEventListener('click', () => { sheetWeek = startOfWeek(addDays(sheetWeek, 7) + 3 * DAY); renderSheet(); });
    $('weekToday').addEventListener('click', () => { sheetWeek = startOfWeek(Date.now()); renderSheet(); });
    $('sheetDays').addEventListener('click', (ev) => {
      const a = ev.target.closest('.add-day');
      if (a) { openEdit(null, Number(a.dataset.day)); return; }
      const b = ev.target.closest('.entry'); if (b) openEdit(b.dataset.id);
    });
    $('addEntryBtn').addEventListener('click', () => openEdit(null));
    $('sheetPdfBtn').addEventListener('click', () => {
      const from = sheetWeek, to = addDays(sheetWeek, 7);
      exportPdf(from, to, `Week of ${fmtDate(from, { month: 'long', day: 'numeric', year: 'numeric' })}`, { detail: true, sign: $('optSign').checked });
    });

    $('editForm').addEventListener('submit', saveEdit);
    $('editCancel').addEventListener('click', closeEdit);
    $('editDlg').addEventListener('close', stopListening);
    $('editForm').addEventListener('input', (ev) => { if (ev.target.name === 'quick') applyQuick(); else updatePreview(); $('editErr').textContent = ''; });
    $('editDelete').addEventListener('click', deleteEdit);

    document.querySelectorAll('#periodSeg button').forEach((b) => b.addEventListener('click', () => {
      repType = b.dataset.p;
      if (repType === 'custom' && !$('repFrom').value) {
        const [f, t] = [startOfMonth(repAnchor), addMonths(startOfMonth(repAnchor), 1)];
        $('repFrom').value = dayKey(f); $('repTo').value = dayKey(addDays(t, -1));
      }
      renderReports();
    }));
    $('repPrev').addEventListener('click', () => shiftRep(-1));
    $('repNext').addEventListener('click', () => shiftRep(1));
    $('repToday').addEventListener('click', () => { repAnchor = Date.now(); renderReports(); });
    $('repFrom').addEventListener('change', renderReports);
    $('repTo').addEventListener('change', renderReports);
    $('repPdfBtn').addEventListener('click', () => {
      const [from, to] = repRange();
      const typeName = { week: 'Weekly', biweek: 'Bi-weekly', month: 'Monthly', quarter: 'Quarterly', year: 'Yearly', custom: 'Custom' }[repType];
      exportPdf(from, to, `${typeName} report · ${rangeLabel(from, to)}`, { detail: $('optDetail').checked, sign: $('optSign').checked });
    });
    $('repCsvBtn').addEventListener('click', () => { const [from, to] = repRange(); exportCsv(from, to); });

    $('settingsForm').addEventListener('input', onSettingsInput);
    $('settingsForm').addEventListener('change', onSettingsInput);
    $('settingsForm').addEventListener('submit', (e) => e.preventDefault());
    $('backupBtn').addEventListener('click', backup);
    $('restoreInput').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) restore(f); e.target.value = ''; });
    $('wipeBtn').addEventListener('click', wipe);

    // Keep everything live
    setInterval(() => {
      if (document.hidden) return;
      if (currentView === 'clock') renderClock();
    }, 1000);
    setInterval(() => {
      if (document.hidden || !openEntry()) return;
      if (currentView === 'sheet' && !$('editDlg').open) renderSheet();
      if (currentView === 'reports') renderReports();
    }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { state = load(); render(); } });
    window.addEventListener('storage', (e) => { if (e.key === KEY) { state = load(); render(); } });

    // Install prompt (Android / desktop Chrome)
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('installBtn').hidden = false; });
    $('installBtn').addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null; $('installBtn').hidden = true;
    });
    window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; });

    // Ask the browser to never evict our data
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    // Offline support
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    let v = 'clock';
    try { v = sessionStorage.getItem('tc.view') || 'clock'; } catch (e) { /* ignore */ }
    showView(['clock', 'sheet', 'reports', 'settings'].includes(v) ? v : 'clock');
  }

  // Expose a tiny hook for tests/debugging
  window.TimeClock = { get state() { return state; }, summarize, buildPdf };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
