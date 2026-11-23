/* Forgiving natural-language parsing for dates, times, break lengths and whole entries.
 * Works on typed text and on speech-recognition transcripts, e.g.
 *   "930", "9:30a", "9.30 pm", "half past nine", "quarter to 5", "noon", "17:45"
 *   "yesterday 7 to 3:30, 30 min lunch, note: tile job on Elm St"
 *   "monday from eight am until four thirty pm no lunch"
 * Exposed as globalThis.TCParse. No dependencies.
 */
(function (root) {
  'use strict';

  const MIN = 60000, HOUR = 3600000;

  // ---------- word numbers -> digits ----------
  const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50 };
  const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
    eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
  const ordSuffix = (n) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

  function wordsToDigits(s) {
    const toks = s.split(/(\s+|-)/);
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const w = toks[i];
      if (w in TENS) {
        // look ahead past a separator for a ones / ordinal word
        const nx = toks[i + 2];
        if (nx && /^(\s+|-)$/.test(toks[i + 1] || '') && ONES[nx] >= 1 && ONES[nx] <= 9) { out.push(String(TENS[w] + ONES[nx])); i += 2; continue; }
        if (nx && /^(\s+|-)$/.test(toks[i + 1] || '') && ORD[nx] >= 1 && ORD[nx] <= 9) { const n = TENS[w] + ORD[nx]; out.push(n + ordSuffix(n)); i += 2; continue; }
        out.push(String(TENS[w])); continue;
      }
      if (w in ONES) { out.push(String(ONES[w])); continue; }
      if (w in ORD) { out.push(ORD[w] + ordSuffix(ORD[w])); continue; }
      out.push(w);
    }
    return out.join('');
  }

  function normalize(raw) {
    let s = ' ' + String(raw || '').toLowerCase() + ' ';
    s = s.replace(/[’‘`]/g, "'").replace(/[–—]/g, ' - ');
    s = s.replace(/\b([ap])\s*\.\s*m\b\.?/g, '$1m').replace(/\b([ap])\s+m\b/g, '$1m');
    s = s.replace(/\bo\s*'?\s*clock\b/g, ' ');
    // protect dashed dates, then treat any other dash between times as a range separator ("7am-3:30pm", "0700-1530")
    s = s.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, '$1/$2/$3').replace(/\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b/g, '$1/$2/$3');
    s = s.replace(/(\d|[ap]m?)\s*-\s*(?=\d)/g, '$1 - ');
    s = s.replace(/\b(in the morning|this morning)\b/g, ' am ').replace(/\b(in the (afternoon|evening)|at night|tonight)\b/g, ' pm ');
    s = s.replace(/\b(noon|midday|lunchtime)\b/g, ' 12:00pm ').replace(/\bmidnight\b/g, ' 12:00am ');
    s = wordsToDigits(s);
    s = s.replace(/\b(\d{1,2})\s+oh\s+(\d)\b/g, '$1:0$2');
    s = s.replace(/\bhalf\s+past\s+(\d{1,2})\b/g, '$1:30');
    s = s.replace(/\bquarter\s+past\s+(\d{1,2})\b/g, '$1:15');
    s = s.replace(/\b(?:a\s+)?quarter\s+(?:to|till|til|of|before)\s+(\d{1,2})\b/g, (_, h) => `${(+h + 11) % 12 || 12}:45`);
    s = s.replace(/\b(\d{1,2})\s+(?:minutes?\s+)?past\s+(\d{1,2})\b/g, (_, m, h) => `${h}:${String(m).padStart(2, '0')}`);
    s = s.replace(/\s+/g, ' ');
    return s;
  }

  // ---------- durations ("30", "1:15", "an hour and a half", "45 min") ----------
  function parseMinutes(raw) {
    if (raw == null) return null;
    let s = normalize(raw).trim();
    if (!s) return null;
    if (/\b(no|none|zero|skipped?|didn'?t take)\b/.test(s) && !/\d/.test(s)) return 0;
    let m;
    if ((m = /^(\d{1,2}):(\d{2})$/.exec(s))) return +m[1] * 60 + +m[2];
    s = s.replace(/\b(\d+)\s+1\/2\b|(\d+)½/g, (_, a, b) => `${a || b} and a half`).replace(/\b1\/2\b|½/g, 'half').replace(/\b1\/4\b/g, 'quarter');
    let total = 0, hit = false;
    s = s.replace(/\b(?:an?|1)\s+hour\s+and\s+(?:a\s+)?half\b/g, ' 90 min ')
      .replace(/\b(\d+)\s+(?:and\s+(?:a\s+)?half|½)\s+hours?\b/g, (_, h) => ` ${+h * 60 + 30} min `)
      .replace(/\bhalf\s+(?:an?\s+)?h(?:ou)?rs?\b/g, ' 30 min ')
      .replace(/\b(?:a\s+)?quarter\s+(?:of\s+)?(?:an?\s+)?hour\b/g, ' 15 min ')
      .replace(/\ban?\s+hour\b/g, ' 1 hour ');
    const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/g;
    while ((m = re.exec(s))) { hit = true; total += /^h/.test(m[2]) ? parseFloat(m[1]) * 60 : parseFloat(m[1]); }
    if (hit) return Math.round(total);
    if ((m = /(\d+(?:\.\d+)?)/.exec(s))) { const n = parseFloat(m[1]); return Math.round(n <= 8 && /\./.test(m[1]) ? n * 60 : n); }
    return null;
  }
  const DUR = '(?:\\d+(?:\\.\\d+)?\\s*(?:hours?|hrs?|h|minutes?|mins?|m)\\b(?:\\s*(?:and\\s+)?\\d+\\s*(?:minutes?|mins?|m)\\b)?|(?:an?|1)\\s+hour\\s+and\\s+(?:a\\s+)?half|\\d+\\s+and\\s+(?:a\\s+)?half\\s+hours?|half\\s+(?:an?\\s+)?hour|(?:a\\s+)?quarter\\s+(?:of\\s+)?(?:an?\\s+)?hour|an?\\s+hour)';

  // ---------- dates ----------
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
  const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DOW_RE = '\\b(last\\s+|this\\s+|past\\s+|previous\\s+|on\\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\\b';
  const sod = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
  const monIdx = (w) => MONTHS.indexOf(w.slice(0, 3));

  function mkDate(y, mo, d, now, yearGiven) {
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    if (y != null && y < 100) y += 2000;
    let t = new Date(y != null ? y : new Date(now).getFullYear(), mo, d).getTime();
    if (new Date(t).getDate() !== d) return null;
    // A time clock is about the past: a date far in the future without a year means last year.
    if (!yearGiven && t > addDays(sod(now), 31)) t = new Date(new Date(t).getFullYear() - 1, mo, d).getTime();
    return t;
  }

  /** Find a date in a normalized string. Returns { ts, match } or null. */
  function findDate(s, now) {
    let m;
    const today = sod(now);
    if ((m = /\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/.exec(s))) return { ts: mkDate(+m[1], +m[2] - 1, +m[3], now, true), match: m[0] };
    if ((m = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(s))) {
      let mo = +m[1], d = +m[2];
      if (mo > 12 && d <= 12) [mo, d] = [d, mo];
      const ts = mkDate(m[3] ? +m[3] : null, mo - 1, d, now, !!m[3]);
      if (ts != null) return { ts, match: m[0] };
    }
    if ((m = new RegExp('\\b' + MON_RE + '\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?').exec(s)))
      return { ts: mkDate(m[3] ? +m[3] : null, monIdx(m[1]), +m[2], now, !!m[3]), match: m[0] };
    if ((m = new RegExp('\\b(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MON_RE + '(?:,?\\s*(\\d{4}))?').exec(s)))
      return { ts: mkDate(m[3] ? +m[3] : null, monIdx(m[2]), +m[1], now, !!m[3]), match: m[0] };
    if ((m = /\bday before yesterday\b/.exec(s))) return { ts: addDays(today, -2), match: m[0] };
    if ((m = /\b(yesterday|last night)\b/.exec(s))) return { ts: addDays(today, -1), match: m[0] };
    if ((m = /\b(today|tonight|this morning|this afternoon|this evening)\b/.exec(s))) return { ts: today, match: m[0] };
    if ((m = /\b(\d{1,2}) days? ago\b/.exec(s))) return { ts: addDays(today, -m[1]), match: m[0] };
    if ((m = /\b(?:a|1) week ago\b/.exec(s))) return { ts: addDays(today, -7), match: m[0] };
    if ((m = new RegExp(DOW_RE).exec(s))) {
      const want = DOW.indexOf(m[2].slice(0, 3));
      let back = (new Date(today).getDay() - want + 7) % 7;
      if (back === 0 && m[1] && /last|past|previous/.test(m[1])) back = 7;
      return { ts: addDays(today, -back), match: m[0] };
    }
    if ((m = /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/.exec(s))) {
      const n = new Date(now);
      let ts = mkDate(n.getFullYear(), n.getMonth(), +m[1], now, true);
      if (ts != null && ts > today) ts = mkDate(n.getFullYear(), n.getMonth() - 1, +m[1], now, true) ?? new Date(n.getFullYear(), n.getMonth() - 1, +m[1]).getTime();
      if (ts != null) return { ts, match: m[0] };
    }
    return null;
  }
  function parseDate(raw, now) {
    now = now || Date.now();
    const s = normalize(raw);
    if (!s.trim()) return null;
    const r = findDate(s, now);
    return r ? r.ts : null;
  }

  // ---------- times ----------
  const TIME_RE = /(?<![\d:./-])(\d{1,2})(?:(?::|\.|h)(\d{2})|\s(\d{2})(?=\s*(?:am|pm|a|p)?\b(?!\s*(?:min|minute|hr|hour|h\b|day|week))))?\s*(am|pm|a|p)?(?![\d/:-])(?!\s*(?:min|minute|hrs?\b|hours?\b|h\b|days?\b|weeks?\b|st\b|nd\b|rd\b|th\b|%))/g;

  function expandCompact(s) {
    // "930" -> "9:30", "0730" -> "07:30", "1730" -> "17:30" (only when it's a valid clock time)
    return s.replace(/(?<![\d:./-])(\d{3,4})(?=\s*(?:am|pm|a|p)?\b)(?![\d/:-])/g, (all, n) => {
      const h = +n.slice(0, -2), m = +n.slice(-2);
      return h <= 23 && m <= 59 ? `${n.slice(0, -2)}:${n.slice(-2)}` : all;
    });
  }
  function findTimes(s) {
    s = expandCompact(s);
    const out = [];
    let m;
    TIME_RE.lastIndex = 0;
    while ((m = TIME_RE.exec(s))) {
      const h = +m[1], mi = m[2] != null ? +m[2] : m[3] != null ? +m[3] : 0;
      if (h > 23 || mi > 59) continue;
      let mer = m[4] ? (m[4][0] === 'a' ? 'am' : 'pm') : null;
      if (h > 12 || h === 0) mer = null;
      // a bare single number with nothing else is only a time if it could be an hour
      out.push({ h, m: mi, mer, h24: h > 12 || /^0\d/.test(m[1]) || h === 0, index: m.index });
    }
    return out;
  }
  function parseTime(raw) {
    const s = normalize(raw);
    const t = findTimes(s)[0];
    return t || null;
  }

  /** Hour (0-23) for a parsed time used as a clock-in, guessing AM/PM if not said. */
  function inHour(t) {
    if (t.mer) return (t.h % 12) + (t.mer === 'pm' ? 12 : 0);
    if (t.h24) return t.h;
    if (t.h === 12) return 12;
    return t.h >= 5 ? t.h : t.h + 12; // 5-11 -> morning, 1-4 -> afternoon
  }
  function atTime(dayTs, h, m) { const d = new Date(dayTs); d.setHours(h, m, 0, 0); return d.getTime(); }
  /** Timestamp for a clock-in time on a day. */
  function startTs(dayTs, t) { return atTime(dayTs, inHour(t), t.m); }
  /** Timestamp for a clock-out time: the first matching moment after the start. */
  function endTs(start, t) {
    const day = sod(start);
    if (t.mer || t.h24) {
      let e = atTime(day, t.mer ? (t.h % 12) + (t.mer === 'pm' ? 12 : 0) : t.h, t.m);
      while (e <= start) e = addDays(e, 1);
      return e;
    }
    let e = atTime(day, t.h % 12, t.m);
    for (let i = 0; i < 4 && e <= start; i++) e += 12 * HOUR;
    return e;
  }

  // ---------- whole entry ----------
  /**
   * Parse a free-form entry like "yesterday 7 to 3:30 30 min lunch note tile job".
   * Returns { day, inT, outT, breakMin, durationMin, note } with null for anything not mentioned.
   */
  function parseEntry(raw, now) {
    now = now || Date.now();
    const res = { day: null, inT: null, outT: null, breakMin: null, durationMin: null, note: null };
    let text = String(raw || '');
    // note (keep original casing)
    const nm = /\b(?:notes?|memo|comments?|description)\b\s*(?:is|was|says|:|-)?\s*/i.exec(text);
    if (nm) { res.note = text.slice(nm.index + nm[0].length).trim().replace(/^[:,-]\s*/, '') || null; text = text.slice(0, nm.index); }

    let s = normalize(text);
    let m;
    // breaks
    const brkWord = '(?:lunch|break|lunch\\s*break|meal(?:\\s*break)?|unpaid)';
    if ((m = new RegExp('\\b(?:no|without(?:\\s+a)?|skipped(?:\\s+the)?|didn\'?t take(?:\\s+a)?)\\s+' + brkWord + '\\b').exec(s))) { res.breakMin = 0; s = s.replace(m[0], ' '); }
    else if ((m = new RegExp('(?<![\\d:.])(' + DUR + ')\\s*(?:of\\s+)?(?:for\\s+)?' + brkWord + '\\b').exec(s)) ||
             (m = new RegExp('\\b(?:took\\s+(?:a\\s+)?)?' + brkWord + '\\s*(?:of|was|for|:|-)?\\s*(' + DUR + '|\\d+)').exec(s))) {
      res.breakMin = parseMinutes(m[1]); s = s.replace(m[0], ' ');
    }
    // "for 8 hours" / "worked 8 hours"
    if ((m = new RegExp('\\b(?:for|worked|work(?:ed)?\\s+for|total(?:\\s+of)?)\\s+(' + DUR + ')').exec(s))) {
      res.durationMin = parseMinutes(m[1]); s = s.replace(m[0], ' ');
    }
    // date
    const d = findDate(s, now);
    if (d && d.ts != null) {
      res.day = d.ts; s = s.replace(d.match, ' ');
      // drop a leftover weekday name ("thu, nov 20")
      s = s.replace(new RegExp(DOW_RE, 'g'), ' ');
    }
    const times = findTimes(s);
    if (times[0]) res.inT = times[0];
    if (times[1]) res.outT = times[1];
    return res;
  }

  /** Turn parse results into timestamps. */
  function resolve(p, now) {
    now = now || Date.now();
    const day = p.day != null ? p.day : sod(now);
    if (!p.inT) return { start: null, end: null };
    const start = startTs(day, p.inT);
    let end = null;
    if (p.outT) end = endTs(start, p.outT);
    else if (p.durationMin) end = start + p.durationMin * MIN + (p.breakMin || 0) * MIN;
    return { start, end };
  }

  root.TCParse = { normalize, parseMinutes, parseDate, parseTime, parseEntry, resolve, startTs, endTs, inHour };
})(typeof globalThis !== 'undefined' ? globalThis : this);
