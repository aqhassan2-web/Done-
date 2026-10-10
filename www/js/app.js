/* ==========================================================
   منجِز - منطق التطبيق
   - التخزين: Preferences (تخزين الهاتف الأصلي) مع نسخة في localStorage
   - التذكيرات: LocalNotifications (تعمل والتطبيق مغلق) + تنبيه وصوت داخل التطبيق
   - لا يوجد حذف للمهام: المهمة المنجزة تنتقل إلى الأرشيف ويمكن إعادة فتحها
   ========================================================== */
(function () {
  'use strict';

  /* ---------- ثوابت ---------- */
  var CATS = [
    { id: 'work', name: 'عمل الشركة', color: 'var(--c-work)' },
    { id: 'mine', name: 'عملي الخاص', color: 'var(--c-mine)' },
    { id: 'personal', name: 'مهام شخصية', color: 'var(--c-personal)' },
    { id: 'home', name: 'مهام المنزل', color: 'var(--c-home)' },
    { id: 'other', name: 'أخرى', color: 'var(--c-other)' }
  ];
  var TONES = [
    { id: 'paper', name: 'سادة', swatch: '#f5f6f8' },
    { id: 'mint', name: 'نعناع', swatch: '#e6f1ed' },
    { id: 'sky', name: 'سماء', swatch: '#e6eef8' },
    { id: 'warm', name: 'دافئ', swatch: '#f1ede7' }
  ];
  var PRIO_NAME = ['عادية', 'مهمة', 'عاجلة'];
  var REP_NAME = { daily: 'يومياً', weekly: 'أسبوعياً', monthly: 'شهرياً' };
  var CHANNEL = 'reminders';
  var KEY = 'munjiz.v1';
  var LOCK_AFTER_MS = 20000; /* يُقفل التطبيق إذا غاب أكثر من 20 ثانية */
  var catById = {};
  CATS.forEach(function (c) { catById[c.id] = c; });

  var LOC = 'ar-IQ-u-nu-latn';
  var fWeekday = new Intl.DateTimeFormat(LOC, { weekday: 'long' });
  var fWeekdayShort = new Intl.DateTimeFormat(LOC, { weekday: 'short' });
  var fDate = new Intl.DateTimeFormat(LOC, { day: 'numeric', month: 'long' });
  var fFull = new Intl.DateTimeFormat(LOC, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  var fTime = new Intl.DateTimeFormat(LOC, { hour: 'numeric', minute: '2-digit' });

  /* ---------- الحالة ---------- */
  var data = { v: 2, tasks: [], settings: { tone: 'paper', mode: 'light', quick: true, lock: null }, acked: [] };
  var ackSet = new Set();
  var tab = 'active', catFilter = 'all', weekOffset = 0, dayFilter = null;
  var statsRange = 7, statSel = null, query = '', searchOpen = false;
  var editingId = null, finishingId = null, finishMode = 'finish', openSheet = null;
  var draftSubs = [], draftPrio = 0;
  var alerts = new Set();
  var audio = null, alarmTimer = null, persistTimer = null, schedTimer = null, toastTimer = null;
  var ready = false, channelReady = false, lastUndo = null, pendingActions = [], busy = {};
  var lockMode = null, lockBuf = '', lockFirst = '', lockFails = 0, lockUntil = 0, hiddenAt = 0;
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ---------- أدوات ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function newId() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toInput(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fromInput(v) {
    if (!v) return null;
    var t = new Date(v).getTime();
    return isNaN(t) ? null : t;
  }
  function dur(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return 'أقل من دقيقة';
    var d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60, p = [];
    if (d) p.push(d + ' يوم');
    if (h) p.push(h + ' س');
    if (mm && !d) p.push(mm + ' د');
    return p.join(' و ');
  }
  function rel(ms) {
    var diff = ms - Date.now(), m = Math.round(Math.abs(diff) / 60000), txt;
    if (m < 1) return 'الآن';
    if (m < 60) txt = m + ' د';
    else if (m < 1440) txt = Math.round(m / 60) + ' س';
    else txt = Math.round(m / 1440) + ' يوم';
    return diff >= 0 ? 'بعد ' + txt : 'منذ ' + txt;
  }
  function countWord(n) { return n === 1 ? 'مهمة واحدة' : n === 2 ? 'مهمتان' : n + ' مهام'; }
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  }
  function findTask(id) { return data.tasks.find(function (t) { return t.id === id; }); }
  function plugin(name) {
    try {
      var C = window.Capacitor;
      if (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins[name]) return C.Plugins[name];
    } catch (e) {}
    return null;
  }
  function platform() { try { return window.Capacitor && Capacitor.getPlatform ? Capacitor.getPlatform() : 'web'; } catch (e) { return 'web'; } }
  function haptic(kind) {
    try {
      var H = plugin('Haptics');
      if (H) {
        if (kind === 'success') H.notification({ type: 'SUCCESS' });
        else if (kind === 'warn') H.notification({ type: 'WARNING' });
        else H.impact({ style: 'LIGHT' });
        return;
      }
      if (navigator.vibrate) navigator.vibrate(kind === 'success' ? [12, 40, 12] : 8);
    } catch (e) {}
  }
  function hideToast() { $('toast').classList.remove('show'); }
  function toast(msg, actions) {
    var el = $('toast');
    el.innerHTML = '';
    var sp = document.createElement('span');
    sp.textContent = msg;
    el.appendChild(sp);
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      b.addEventListener('click', function () { hideToast(); a.fn(); });
      el.appendChild(b);
    });
    if (actions && actions.length) el.classList.add('has-action'); else el.classList.remove('has-action');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actions && actions.length ? 7000 : 2200);
  }

  /* ---------- التخزين الدائم ---------- */
  function readRaw() {
    var pr = plugin('Preferences'), local = null;
    try { local = localStorage.getItem(KEY); } catch (e) {}
    if (!pr) return Promise.resolve(local);
    return pr.get({ key: KEY }).then(function (r) { return (r && r.value) || local; }).catch(function () { return local; });
  }
  function writeRaw(s) {
    try { localStorage.setItem(KEY, s); } catch (e) {}
    var pr = plugin('Preferences');
    if (pr) return pr.set({ key: KEY, value: s }).catch(function (e) { console.error(e); });
    return Promise.resolve();
  }
  function persist(now) {
    clearTimeout(persistTimer);
    var run = function () {
      data.v = 2;
      data.acked = Array.from(ackSet).slice(-300);
      return writeRaw(JSON.stringify(data));
    };
    if (now) return run();
    persistTimer = setTimeout(run, 250);
  }
  function normalizeTask(t) {
    if (t.prio == null) t.prio = 0;
    if (!t.repeat) t.repeat = 'none';
    if (!Array.isArray(t.subs)) t.subs = [];
    if (t.note == null) t.note = '';
    return t;
  }
  function load() {
    return readRaw().then(function (raw) {
      if (raw) {
        try {
          var d = JSON.parse(raw);
          if (d && Array.isArray(d.tasks)) {
            data.tasks = d.tasks.map(normalizeTask);
            data.settings = Object.assign({ tone: 'paper', mode: 'light', quick: true, lock: null }, d.settings || {});
            (d.acked || []).forEach(function (k) { ackSet.add(k); });
          }
        } catch (e) { console.error(e); }
      }
    });
  }

  /* ---------- المظهر ---------- */
  function effectiveScheme() {
    var m = data.settings.mode;
    if (m === 'light' || m === 'dark') return m;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'light'; }
  }
  function applyTheme() {
    var root = document.documentElement, s = effectiveScheme();
    var tone = TONES.some(function (t) { return t.id === data.settings.tone; }) ? data.settings.tone : 'paper';
    root.setAttribute('dir', 'rtl');
    root.setAttribute('lang', 'ar');
    root.setAttribute('data-scheme', s);
    root.setAttribute('data-tone', tone);
    var sb = plugin('StatusBar');
    if (sb) {
      try {
        sb.setStyle({ style: s === 'dark' ? 'DARK' : 'LIGHT' });
        if (platform() === 'android') sb.setBackgroundColor({ color: getComputedStyle(root).getPropertyValue('--bg').trim() || '#f5f6f8' });
      } catch (e) {}
    }
  }
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (data.settings.mode === 'auto') applyTheme();
    });
  } catch (e) {}

  /* ---------- التذكيرات الأصلية (تعمل والتطبيق مغلق) ---------- */
  function nid(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (Math.abs(h) % 2000000000) + 10;
  }
  function permState() {
    var LN = plugin('LocalNotifications');
    if (!LN) return Promise.resolve('unsupported');
    return LN.checkPermissions().then(function (r) { return r.display; }).catch(function () { return 'unsupported'; });
  }
  function requestPerm() {
    var LN = plugin('LocalNotifications');
    if (!LN) return Promise.resolve('unsupported');
    return LN.requestPermissions().then(function (r) { return r.display; }).catch(function () { return 'denied'; });
  }
  function ensureChannel() {
    var LN = plugin('LocalNotifications');
    if (!LN || channelReady || platform() !== 'android') return Promise.resolve();
    return LN.createChannel({
      id: CHANNEL, name: 'تذكيرات المهام', description: 'تنبيهات مواعيد المهام',
      importance: 5, visibility: 1, vibration: true, lights: true
    }).then(function () { channelReady = true; }).catch(function (e) { console.error(e); });
  }
  /* أزرار «تم الإنجاز» و«غفوة» داخل الإشعار */
  function registerActions() {
    var LN = plugin('LocalNotifications');
    if (!LN || !LN.registerActionTypes) return Promise.resolve();
    return LN.registerActionTypes({
      types: [{
        id: 'TASK',
        actions: [
          { id: 'done', title: 'تم الإنجاز', foreground: true },
          { id: 'snooze', title: 'غفوة 10 دقائق', foreground: true }
        ]
      }]
    }).catch(function (e) { console.error(e); });
  }
  function queueSchedule() {
    clearTimeout(schedTimer);
    schedTimer = setTimeout(scheduleAll, 400);
  }
  function scheduleAll() {
    var LN = plugin('LocalNotifications');
    if (!LN) return Promise.resolve();
    return ensureChannel().then(function () {
      return LN.getPending();
    }).then(function (p) {
      var pend = (p && p.notifications) || [];
      var toCancel = pend.filter(function (n) { return n.id !== 1; }).map(function (n) { return { id: n.id }; });
      return toCancel.length ? LN.cancel({ notifications: toCancel }) : null;
    }).then(function () {
      var now = Date.now();
      var list = data.tasks.filter(function (t) { return !t.done && t.remindAt && t.remindAt > now; })
        .sort(function (a, b) { return a.remindAt - b.remindAt; })
        .slice(0, 60); /* آيفون يسمح بحد أقصى 64 تنبيهاً مجدولاً */
      if (!list.length) return null;
      return LN.schedule({
        notifications: list.map(function (t) {
          var c = catById[t.cat] || catById.other;
          return {
            id: nid(t.id),
            title: t.prio === 2 ? 'عاجل: حان موعد مهمتك' : 'حان موعد مهمتك',
            body: t.title + ' · ' + c.name,
            schedule: { at: new Date(t.remindAt), allowWhileIdle: true },
            channelId: CHANNEL,
            actionTypeId: 'TASK',
            extra: { taskId: t.id }
          };
        })
      });
    }).catch(function (e) { console.error('schedule', e); });
  }
  function testNotification() {
    var LN = plugin('LocalNotifications');
    if (!LN) { toast('التنبيهات الأصلية تعمل فقط داخل تطبيق الهاتف'); return; }
    requestPerm().then(function (st) {
      if (st !== 'granted') { toast('اسمح بالإشعارات من إعدادات الهاتف أولاً'); return; }
      return ensureChannel().then(function () {
        return LN.schedule({
          notifications: [{
            id: 1, title: 'تجربة منجِز', body: 'إذا ظهر هذا التنبيه فكل شيء يعمل',
            schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true }, channelId: CHANNEL
          }]
        });
      }).then(function () { toast('أغلق التطبيق وانتظر 5 ثوانٍ'); });
    }).catch(function (e) { console.error(e); toast('تعذّرت التجربة'); });
  }
  function handleAction(ev) {
    var id = ev && ev.actionId, x = ev && ev.notification && ev.notification.extra, tid = x && x.taskId;
    if (!tid) return;
    if (!ready) { pendingActions.push(ev); return; }
    var t = findTask(tid);
    if (!t || t.done) return;
    if (id === 'done') completeTask(tid, '');
    else if (id === 'snooze') snooze(tid, 10);
    else { tab = 'active'; closeSheet(); renderAll(); }
  }

  /* ---------- التنبيه داخل التطبيق (صوت + بطاقة) ---------- */
  function unlockAudio() {
    if (audio) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio = new AC();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) { audio = null; }
    syncAlarm();
  }
  function beep() {
    if (!audio) return;
    try {
      [0, 0.28].forEach(function (off, i) {
        var o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + off;
        o.type = 'sine';
        o.frequency.value = i ? 1046 : 784;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
        o.connect(g);
        g.connect(audio.destination);
        o.start(t0);
        o.stop(t0 + 0.26);
      });
    } catch (e) {}
  }
  function syncAlarm() {
    if (alerts.size > 0 && audio) {
      if (!alarmTimer) { beep(); alarmTimer = setInterval(beep, 1800); }
    } else if (alarmTimer) {
      clearInterval(alarmTimer);
      alarmTimer = null;
    }
  }
  function ackKey(t) { return t.id + ':' + t.remindAt; }
  function tick() {
    if (!ready) return;
    var now = Date.now(), changed = false;
    data.tasks.forEach(function (t) {
      if (t.done || !t.remindAt) return;
      if (t.remindAt <= now && !ackSet.has(ackKey(t)) && !alerts.has(t.id)) {
        alerts.add(t.id);
        changed = true;
        haptic('warn');
      }
    });
    Array.from(alerts).forEach(function (id) {
      var t = findTask(id);
      if (!t || t.done || !t.remindAt || t.remindAt > now || ackSet.has(ackKey(t))) { alerts.delete(id); changed = true; }
    });
    if (changed) { renderBanner(); syncAlarm(); }
  }
  function dismissAlert(id) {
    var t = findTask(id);
    if (t) { ackSet.add(ackKey(t)); persist(); }
    alerts.delete(id);
    renderBanner();
    syncAlarm();
  }
  function snooze(id, min) {
    var t = findTask(id);
    if (!t) return;
    alerts.delete(id);
    var c = Object.assign({}, t);
    c.remindAt = Date.now() + min * 60000;
    saveTask(c);
    syncAlarm();
    haptic('light');
    toast('سأذكّرك بعد ' + min + ' دقائق');
  }

  /* ---------- العمليات على المهام (بدون حذف) ---------- */
  function upsert(t) {
    var i = data.tasks.findIndex(function (x) { return x.id === t.id; });
    if (i < 0) data.tasks.push(t); else data.tasks[i] = t;
  }
  function commit() {
    persist();
    queueSchedule();
    renderAll();
    tick();
  }
  function saveTask(t) { t.updated = Date.now(); upsert(t); commit(); }

  function stepDue(ms, rep) {
    var d = new Date(ms);
    if (rep === 'daily') d.setDate(d.getDate() + 1);
    else if (rep === 'weekly') d.setDate(d.getDate() + 7);
    else if (rep === 'monthly') {
      var day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
    }
    return d.getTime();
  }
  function nextOccurrence(due, rep, now) {
    var n = stepDue(due, rep), guard = 0;
    while (n <= now && guard < 500) { n = stepDue(n, rep); guard++; }
    return n;
  }
  function completeTask(id, note) {
    var t = findTask(id);
    if (!t || t.done) return;
    var prev = JSON.parse(JSON.stringify(t)), now = Date.now();
    var c = Object.assign({}, t, { done: true, doneAt: now, doneNote: note || '', updated: now });
    var next = null;
    if (t.repeat && t.repeat !== 'none' && t.due) {
      var nd = nextOccurrence(t.due, t.repeat, now);
      var off = t.due - (t.start || t.created);
      if (!(off >= 0)) off = 0;
      next = {
        id: newId(), title: t.title, cat: t.cat, note: t.note, prio: t.prio || 0, repeat: t.repeat, lead: t.lead || 0,
        subs: (t.subs || []).map(function (s) { return { id: s.id, t: s.t, d: false }; }),
        start: nd - off, due: nd, remindAt: nd - (t.lead || 0) * 60000,
        created: now, updated: now, done: false, doneAt: null, doneNote: ''
      };
    }
    alerts.delete(id);
    upsert(c);
    if (next) upsert(next);
    lastUndo = { prev: prev, nextId: next ? next.id : null };
    commit();
    syncAlarm();
    haptic('success');
    var acts = [{ label: 'تراجع', fn: undoComplete }];
    if (!note) acts.push({ label: 'ملاحظة', fn: function () { openNoteSheet(id); } });
    toast(next ? 'أُنجزت. وأُضيف التكرار التالي' : 'نُقلت إلى المنجزة', acts);
  }
  function undoComplete() {
    var u = lastUndo;
    if (!u) return;
    lastUndo = null;
    if (u.nextId) data.tasks = data.tasks.filter(function (x) { return x.id !== u.nextId; });
    u.prev.updated = Date.now();
    upsert(u.prev);
    commit();
    haptic('light');
    toast('تم التراجع');
  }
  function reopenTask(id) {
    var t = findTask(id);
    if (!t) return;
    var c = Object.assign({}, t);
    if (c.doneNote) c.note = (c.note ? c.note + '\n' : '') + '[ملاحظة الإنجاز السابقة] ' + c.doneNote;
    c.done = false;
    c.doneAt = null;
    c.doneNote = '';
    c.repeat = 'none';
    saveTask(c);
    toast('أُعيدت إلى المهام الحالية');
  }
  function toggleSub(id, i) {
    var t = findTask(id);
    if (!t || !t.subs[i]) return;
    var c = Object.assign({}, t);
    c.subs = t.subs.map(function (s, k) { return k === i ? { id: s.id, t: s.t, d: !s.d } : s; });
    saveTask(c);
    haptic('light');
  }

  /* ---------- العرض: أدوات مشتركة ---------- */
  var CHECK = '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  function visible(t) {
    if (catFilter !== 'all' && t.cat !== catFilter) return false;
    if (!query) return true;
    var c = catById[t.cat] || catById.other;
    var hay = norm([t.title, t.note, t.doneNote, c.name].concat((t.subs || []).map(function (s) { return s.t; })).join(' '));
    return hay.indexOf(query) !== -1;
  }
  function subsHtml(t, ro) {
    if (!t.subs || !t.subs.length) return '';
    var max = ro ? 99 : 6, h = '<div class="subs' + (ro ? ' ro' : '') + '">';
    t.subs.slice(0, max).forEach(function (s, i) {
      h += (ro ? '<div class="sub' + (s.d ? ' on' : '') + '">' : '<button type="button" data-act="sub" data-id="' + esc(t.id) + '" data-i="' + i + '" class="sub' + (s.d ? ' on' : '') + '">') +
        '<span class="box">' + CHECK + '</span><span class="st">' + esc(s.t) + '</span>' + (ro ? '</div>' : '</button>');
    });
    if (t.subs.length > max) h += '<div class="hint">+' + (t.subs.length - max) + ' خطوات أخرى، المس المهمة لعرضها</div>';
    return h + '</div>';
  }
  function progress(t) {
    if (!t.subs || !t.subs.length) return '';
    var d = t.subs.filter(function (s) { return s.d; }).length;
    return d + '/' + t.subs.length;
  }
  function weekStart(ms) {
    var d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); /* الأسبوع يبدأ يوم السبت */
    return d.getTime();
  }
  function dayStart(ws, i) { var d = new Date(ws); d.setDate(d.getDate() + i); return d.getTime(); }

  /* ---------- العرض: الشاشات ---------- */
  function renderBanner() {
    var h = '';
    alerts.forEach(function (id) {
      var t = findTask(id);
      if (!t) return;
      h += '<div class="alert" role="alert"><strong>حان موعد: ' + esc(t.title) + '</strong>' +
        '<span class="sub">' + esc((catById[t.cat] || catById.other).name) + (t.due ? ' · ' + esc(fFull.format(t.due)) : '') + '</span>' +
        '<div class="actions">' +
        '<button type="button" class="btn small" data-act="ack" data-id="' + esc(id) + '">إيقاف التنبيه</button>' +
        '<button type="button" class="btn small ghost" data-act="snooze" data-id="' + esc(id) + '">غفوة 10 دقائق</button>' +
        '<button type="button" class="btn small ghost" data-act="banner-finish" data-id="' + esc(id) + '">تم الإنجاز</button>' +
        '</div></div>';
    });
    if (h && !audio) h += '<p class="hint">المس أي مكان في الشاشة لتفعيل صوت المنبّه داخل التطبيق.</p>';
    $('banner').innerHTML = h;
  }
  function renderFilters() {
    $('filters').hidden = tab === 'stats';
    var h = '<button type="button" class="chip" data-cat="all" aria-pressed="' + (catFilter === 'all') + '">الكل</button>';
    CATS.forEach(function (c) {
      h += '<button type="button" class="chip" style="--cat:' + c.color + '" data-cat="' + c.id + '" aria-pressed="' + (catFilter === c.id) + '"><i class="dot"></i>' + esc(c.name) + '</button>';
    });
    $('filters').innerHTML = h;
  }
  function renderTabs() {
    var a = data.tasks.filter(function (t) { return !t.done; }).length;
    var d = data.tasks.filter(function (t) { return t.done; }).length;
    $('cntActive').textContent = a ? String(a) : '';
    $('cntDone').textContent = d ? String(d) : '';
    $('tabActive').setAttribute('aria-selected', tab === 'active');
    $('tabDone').setAttribute('aria-selected', tab === 'done');
    $('tabStats').setAttribute('aria-selected', tab === 'stats');
  }

  var SECTIONS = [
    { id: 'late', name: 'متأخرة' }, { id: 'today', name: 'اليوم' }, { id: 'tomorrow', name: 'غداً' },
    { id: 'later', name: 'لاحقاً' }, { id: 'nodue', name: 'بدون موعد' }
  ];
  function sectionOf(t, now) {
    if (!t.due) return 'nodue';
    if (t.due < now) return 'late';
    var d = new Date(now); d.setHours(0, 0, 0, 0);
    var t1 = new Date(d); t1.setDate(t1.getDate() + 1);
    var t2 = new Date(d); t2.setDate(t2.getDate() + 2);
    if (t.due < t1.getTime()) return 'today';
    if (t.due < t2.getTime()) return 'tomorrow';
    return 'later';
  }
  function dueText(t, sec) {
    if (!t.due) return '';
    if (sec === 'late') return 'متأخرة · ' + rel(t.due);
    if (sec === 'later') return fFull.format(t.due);
    return fTime.format(t.due);
  }

  function renderActive() {
    var all = data.tasks.filter(function (t) { return !t.done; });
    var list = all.filter(visible);
    if (!list.length) {
      if (query) return '<div class="empty"><b>لا توجد نتائج</b>جرّب كلمة أخرى.</div>';
      return '<div class="empty"><b>' + (all.length ? 'لا توجد مهام في هذا التصنيف' : 'لا توجد مهام حالية') + '</b>' +
        (all.length ? 'اختر تصنيفاً آخر من الأعلى.' : 'المس زر + لإضافة مهمتك الأولى، وسيصلك تنبيه في موعدها.') + '</div>';
    }
    var now = Date.now(), by = {}, h = '';
    list.forEach(function (t) { var s = sectionOf(t, now); (by[s] = by[s] || []).push(t); });
    SECTIONS.forEach(function (sec) {
      var items = by[sec.id];
      if (!items) return;
      items.sort(function (a, b) {
        return (b.prio || 0) - (a.prio || 0) || (a.due || 9e15) - (b.due || 9e15) || (a.created || 0) - (b.created || 0);
      });
      h += '<h2 class="gh' + (sec.id === 'late' ? ' late' : '') + '">' + sec.name + '<small>' + items.length + '</small></h2><div class="rows">';
      items.forEach(function (t) {
        var c = catById[t.cat] || catById.other, dt = dueText(t, sec.id), pg = progress(t);
        var rs = '<i class="dot"></i><span>' + esc(c.name) + '</span>';
        if (dt) rs += '<span class="sep">·</span><span class="due' + (sec.id === 'late' ? ' late' : '') + '">' + esc(dt) + '</span>';
        if (t.prio > 0) rs += '<span class="sep">·</span><span class="pr pr' + t.prio + '">' + PRIO_NAME[t.prio] + '</span>';
        if (t.repeat && t.repeat !== 'none') rs += '<span class="sep">·</span><span>يتكرر ' + REP_NAME[t.repeat] + '</span>';
        if (pg) rs += '<span class="sep">·</span><span>' + pg + '</span>';
        h += '<div class="row p' + (t.prio || 0) + '" style="--cat:' + c.color + '">' +
          '<button type="button" class="tick" data-act="finish" data-id="' + esc(t.id) + '" aria-label="إنجاز: ' + esc(t.title) + '">' + CHECK + '</button>' +
          '<div class="rc"><div data-act="edit" data-id="' + esc(t.id) + '" role="button" tabindex="0"><div class="rt">' + esc(t.title) + '</div>' +
          '<div class="rs">' + rs + '</div>' +
          (t.note ? '<div class="rn">' + esc(t.note) + '</div>' : '') + '</div>' +
          subsHtml(t, false) + '</div></div>';
      });
      h += '</div>';
    });
    return h;
  }

  function doneRow(t) {
    var c = catById[t.cat] || catById.other;
    var h = '<div class="row" style="--cat:' + c.color + '"><span class="tick on" aria-hidden="true">' + CHECK + '</span>' +
      '<div class="rc"><div class="rt">' + esc(t.title) + '</div>' +
      '<div class="rs"><i class="dot"></i><span>' + esc(c.name) + '</span><span class="sep">·</span><span>المدة: ' + esc(dur(t.doneAt - (t.start || t.created))) + '</span>' +
      (t.prio > 0 ? '<span class="sep">·</span><span class="pr pr' + t.prio + '">' + PRIO_NAME[t.prio] + '</span>' : '') + '</div>' +
      '<div class="rd"><b>بدأت</b> ' + esc(fFull.format(t.start || t.created)) + '</div>' +
      '<div class="rd"><b>أُنجزت</b> ' + esc(fFull.format(t.doneAt)) + '</div>' + subsHtml(t, true);
    if (t.note) h += '<div class="rnote"><small>ملاحظة الإضافة</small>' + esc(t.note) + '</div>';
    if (t.doneNote) h += '<div class="rnote"><small>ملاحظة الإنجاز</small>' + esc(t.doneNote) + '</div>';
    h += '<div class="actions" style="gap:18px"><button type="button" class="link" data-act="note" data-id="' + esc(t.id) + '">' + (t.doneNote ? 'تعديل ملاحظة الإنجاز' : 'إضافة ملاحظة إنجاز') + '</button>' +
      '<button type="button" class="link" data-act="reopen" data-id="' + esc(t.id) + '">إعادة فتح</button></div></div></div>';
    return h;
  }
  function groupByDay(list) {
    var groups = {}, order = [], h = '';
    list.forEach(function (t) {
      var d = new Date(t.doneAt); d.setHours(0, 0, 0, 0);
      var k = d.getTime();
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(t);
    });
    order.forEach(function (k) {
      h += '<h2 class="gh">' + esc(fWeekday.format(+k)) + '<small>' + esc(fDate.format(+k)) + ' · ' + countWord(groups[k].length) + '</small></h2><div class="rows">';
      groups[k].forEach(function (t) { h += doneRow(t); });
      h += '</div>';
    });
    return h;
  }
  function renderDone() {
    var done = data.tasks.filter(function (t) { return t.done && t.doneAt && visible(t); });
    if (query) {
      if (!done.length) return '<div class="empty"><b>لا توجد نتائج</b>جرّب كلمة أخرى.</div>';
      done.sort(function (x, y) { return y.doneAt - x.doneAt; });
      return '<p class="wkinfo" style="margin-top:16px">نتائج البحث في كل المنجزة: ' + done.length + '</p>' + groupByDay(done.slice(0, 200));
    }
    var d0 = new Date(weekStart(Date.now()));
    d0.setDate(d0.getDate() + weekOffset * 7);
    var ws = d0.getTime(), we = dayStart(ws, 7);
    var inWeek = done.filter(function (t) { return t.doneAt >= ws && t.doneAt < we; });
    var td = new Date(); td.setHours(0, 0, 0, 0);
    var h = '<div class="weekbar"><div class="wknav">' +
      '<button type="button" class="navb" data-act="wk" data-d="-1">السابق</button>' +
      '<span>' + (weekOffset === 0 ? 'هذا الأسبوع' : esc(fDate.format(ws) + ' - ' + fDate.format(dayStart(ws, 6)))) + '</span>' +
      '<button type="button" class="navb" data-act="wk" data-d="1"' + (weekOffset >= 0 ? ' disabled' : '') + '>التالي</button></div><div class="days">';
    for (var i = 0; i < 7; i++) {
      var s = dayStart(ws, i), e = dayStart(ws, i + 1);
      var n = inWeek.filter(function (t) { return t.doneAt >= s && t.doneAt < e; }).length;
      h += '<button type="button" class="day' + (s === td.getTime() ? ' now' : '') + '" data-act="day" data-i="' + i + '" aria-pressed="' + (dayFilter === i) + '">' +
        esc(fWeekdayShort.format(s)) + '<b>' + new Date(s).getDate() + '</b><em>' + (n || '') + '</em></button>';
    }
    h += '</div></div><p class="wkinfo">المنجز في هذا الأسبوع: ' + inWeek.length + (dayFilter !== null ? ' · المس اليوم المحدد مرة أخرى لعرض كل الأيام' : '') + '</p>';
    var shown = inWeek;
    if (dayFilter !== null) {
      var a = dayStart(ws, dayFilter), b = dayStart(ws, dayFilter + 1);
      shown = inWeek.filter(function (t) { return t.doneAt >= a && t.doneAt < b; });
    }
    if (!shown.length) {
      return h + '<div class="empty"><b>لا توجد مهام منجزة</b>' + (dayFilter !== null ? 'في هذا اليوم.' : 'في هذا الأسبوع.') + '</div>';
    }
    shown.sort(function (x, y) { return y.doneAt - x.doneAt; });
    return h + groupByDay(shown);
  }

  function renderStats() {
    var range = statsRange, now = Date.now();
    var t0 = new Date(now); t0.setHours(0, 0, 0, 0);
    var days = [], i;
    for (i = 0; i < range; i++) {
      var d = new Date(t0); d.setDate(d.getDate() - (range - 1 - i));
      days.push({ s: d.getTime(), n: 0 });
    }
    var from = days[0].s;
    var done = data.tasks.filter(function (t) { return t.done && t.doneAt && t.doneAt >= from; });
    done.forEach(function (t) {
      for (var j = days.length - 1; j >= 0; j--) { if (t.doneAt >= days[j].s) { days[j].n++; break; } }
    });
    var total = done.length;
    var withDue = done.filter(function (t) { return t.due; });
    var onTime = withDue.filter(function (t) { return t.doneAt <= t.due + 60000; }).length;
    var pct = withDue.length ? Math.round(onTime / withDue.length * 100) + '%' : '—';
    var avg = total ? dur(done.reduce(function (a, t) { return a + (t.doneAt - (t.start || t.created)); }, 0) / total) : '—';
    var keys = {};
    data.tasks.forEach(function (t) { if (t.done && t.doneAt) { var k = new Date(t.doneAt); k.setHours(0, 0, 0, 0); keys[k.getTime()] = 1; } });
    var streak = 0, cur = new Date(t0);
    if (!keys[cur.getTime()]) cur.setDate(cur.getDate() - 1);
    while (keys[cur.getTime()]) { streak++; cur.setDate(cur.getDate() - 1); }
    var open = data.tasks.filter(function (t) { return !t.done; });
    var late = open.filter(function (t) { return t.due && t.due < now; }).length;

    var h = '<div class="seg statrange" id="rangeSeg">' +
      '<button type="button" data-act="range" data-r="7" aria-pressed="' + (range === 7) + '">آخر 7 أيام</button>' +
      '<button type="button" data-act="range" data-r="30" aria-pressed="' + (range === 30) + '">آخر 30 يوماً</button></div>';
    h += '<div class="kpis">' +
      '<div class="kpi"><b>' + total + '</b><span>مهمة منجزة</span></div>' +
      '<div class="kpi"><b>' + pct + '</b><span>أُنجزت في موعدها</span></div>' +
      '<div class="kpi"><b style="font-size:1.25rem;line-height:2.1rem">' + esc(avg) + '</b><span>متوسط مدة الإنجاز</span></div>' +
      '<div class="kpi"><b>' + streak + '</b><span>' + (streak === 1 ? 'يوم متتالٍ' : 'أيام متتالية') + '</span></div></div>';
    h += '<p class="wkinfo">المفتوحة الآن: ' + open.length + (late ? ' · المتأخرة: ' + late : '') + '</p>';
    if (!total) {
      return h + '<div class="empty"><b>لا توجد بيانات بعد</b>أنجز بعض المهام وستظهر هنا رسوم نشاطك.</div>';
    }
    var max = 1;
    days.forEach(function (x) { if (x.n > max) max = x.n; });
    var sel = statSel != null && days[statSel] ? statSel : null;
    var read = sel != null
      ? esc(fWeekday.format(days[sel].s) + ' ' + fDate.format(days[sel].s)) + ': ' + countWord(days[sel].n)
      : 'المجموع: ' + countWord(total) + ' في آخر ' + (range === 7 ? '7 أيام' : '30 يوماً') + '. المس عموداً لعرض اليوم.';
    h += '<div class="card2"><h3>المهام المنجزة يومياً</h3><p class="readout" aria-live="polite">' + read + '</p><div class="plot">';
    h += '<div class="gl" style="bottom:88%"><span>' + max + '</span></div>';
    if (max >= 4) h += '<div class="gl" style="bottom:44%"><span>' + Math.round(max / 2) + '</span></div>';
    h += '<div class="gl base" style="bottom:0"><span>0</span></div><div class="bars">';
    days.forEach(function (x, k) {
      var hp = x.n ? Math.max(4, x.n / max * 88) : 0;
      var lbl = range === 7 ? fWeekdayShort.format(x.s) : ((k % 5 === 0 || k === days.length - 1) ? String(new Date(x.s).getDate()) : '');
      h += '<button type="button" class="bcol" data-act="bar" data-i="' + k + '" aria-pressed="' + (sel === k) + '" aria-label="' + esc(fWeekday.format(x.s) + ' ' + fDate.format(x.s) + ': ' + x.n) + '">' +
        '<span class="bar" style="height:' + hp + '%">' + (range === 7 && x.n ? '<i>' + x.n + '</i>' : '') + '</span>' +
        (lbl ? '<em>' + esc(lbl) + '</em>' : '') + '</button>';
    });
    h += '</div></div><details class="tbl"><summary>عرض الجدول</summary><table class="t"><tbody>';
    days.slice().reverse().forEach(function (x) {
      h += '<tr><td>' + esc(fWeekday.format(x.s) + ' ' + fDate.format(x.s)) + '</td><td>' + x.n + '</td></tr>';
    });
    h += '</tbody></table></details></div>';

    var byCat = CATS.map(function (c) { return { c: c, n: done.filter(function (t) { return t.cat === c.id; }).length }; })
      .filter(function (x) { return x.n > 0; }).sort(function (a, b) { return b.n - a.n; });
    var cmax = byCat.length ? byCat[0].n : 1;
    h += '<div class="card2"><h3>حسب التصنيف</h3>';
    byCat.forEach(function (x) {
      h += '<div class="cb" style="--cat:' + x.c.color + '"><span class="nm"><i class="dot"></i>' + esc(x.c.name) + '</span>' +
        '<span class="tr"><i style="width:' + Math.round(x.n / cmax * 100) + '%"></i></span><span class="ct">' + x.n + '</span></div>';
    });
    return h + '</div>';
  }
  function renderView() {
    $('view').innerHTML = tab === 'active' ? renderActive() : tab === 'done' ? renderDone() : renderStats();
  }
  function renderAll() {
    $('today').textContent = fFull.format(Date.now());
    renderTabs();
    renderFilters();
    renderBanner();
    renderView();
  }

  /* ---------- النوافذ ---------- */
  function showSheet(id) {
    if (openSheet) closeSheet(true);
    openSheet = id;
    $('scrim').classList.add('open');
    $(id).classList.add('open');
  }
  function closeSheet(silent) {
    if (!openSheet) return;
    $(openSheet).classList.remove('open');
    $('scrim').classList.remove('open');
    var el = document.activeElement;
    if (el && el.blur) el.blur();
    openSheet = null;
    if (!silent) { editingId = null; finishingId = null; }
  }
  function buildCats(selected) {
    $('fCats').innerHTML = CATS.map(function (c) {
      return '<label class="cat-opt" style="--cat:' + c.color + '"><input type="radio" name="fcat" value="' + c.id + '"' + (c.id === selected ? ' checked' : '') + '><span><i class="dot"></i>' + esc(c.name) + '</span></label>';
    }).join('');
  }
  function renderDraftSubs() {
    $('fSubs').innerHTML = draftSubs.map(function (s, i) {
      return '<div class="fr subrow"><button type="button" class="sub' + (s.d ? ' on' : '') + '" data-subtoggle="' + i + '" style="width:auto;min-height:40px" aria-label="تبديل الإنجاز"><span class="box">' + CHECK + '</span></button>' +
        '<input type="text" maxlength="100" value="' + esc(s.t) + '" data-subtext="' + i + '" aria-label="خطوة ' + (i + 1) + '">' +
        '<button type="button" class="x" data-subdel="' + i + '" aria-label="إزالة الخطوة">&times;</button></div>';
    }).join('');
  }
  function addDraftSub() {
    var v = $('fSubIn').value.trim();
    if (!v) return;
    draftSubs.push({ id: newId(), t: v, d: false });
    $('fSubIn').value = '';
    renderDraftSubs();
  }
  function renderPrioSeg() {
    Array.prototype.forEach.call($('fPrio').children, function (b) {
      b.setAttribute('aria-pressed', String(parseInt(b.dataset.prio, 10) === draftPrio));
    });
  }
  function openTaskSheet(id) {
    editingId = id || null;
    var t = id ? findTask(id) : null;
    $('taskSheetTitle').textContent = t ? 'تعديل المهمة' : 'مهمة جديدة';
    $('fSubmit').textContent = t ? 'حفظ التعديلات' : 'إضافة';
    buildCats(t ? t.cat : (catFilter !== 'all' ? catFilter : 'work'));
    $('fTitle').value = t ? t.title : '';
    $('fStart').value = toInput(t ? (t.start || t.created) : Date.now());
    $('fDue').value = t && t.due ? toInput(t.due) : '';
    $('fLead').value = String(t ? (t.lead || 0) : 0);
    $('fRepeat').value = t ? (t.repeat || 'none') : 'none';
    $('fNote').value = t ? (t.note || '') : '';
    $('fSubIn').value = '';
    draftPrio = t ? (t.prio || 0) : 0;
    draftSubs = t ? t.subs.map(function (s) { return { id: s.id, t: s.t, d: !!s.d }; }) : [];
    renderPrioSeg();
    renderDraftSubs();
    showSheet('sheetTask');
    if (!t) setTimeout(function () { $('fTitle').focus(); }, 280);
  }
  function openFinishSheet(id) {
    var t = findTask(id);
    if (!t) return;
    if (alerts.has(id)) dismissAlert(id);
    finishingId = id;
    finishMode = 'finish';
    $('doneTitle').textContent = 'إنجاز المهمة';
    $('dConfirm').textContent = 'تم الإنجاز';
    $('doneName').textContent = t.title;
    $('dNote').value = '';
    showSheet('sheetDone');
  }
  function openNoteSheet(id) {
    var t = findTask(id);
    if (!t) return;
    finishingId = id;
    finishMode = 'note';
    $('doneTitle').textContent = 'ملاحظة الإنجاز';
    $('dConfirm').textContent = 'حفظ الملاحظة';
    $('doneName').textContent = t.title;
    $('dNote').value = t.doneNote || '';
    showSheet('sheetDone');
  }
  function quickFinish(id, rowEl) {
    if (busy[id]) return;
    if (!data.settings.quick) { openFinishSheet(id); return; }
    busy[id] = true;
    var go = function () { delete busy[id]; completeTask(id, ''); };
    if (rowEl && !reduceMotion) {
      rowEl.classList.add('leaving');
      var tk = rowEl.querySelector('.tick');
      if (tk) tk.classList.add('on');
      haptic('light');
      setTimeout(go, 230);
    } else go();
  }

  /* ---------- الإعدادات ---------- */
  function setSwitch(id, on) { $(id).setAttribute('aria-checked', String(!!on)); }
  function lockEnabled() { return !!(data.settings.lock && data.settings.lock.hash); }
  function renderSettings() {
    Array.prototype.forEach.call($('segMode').children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === data.settings.mode));
    });
    $('tones').innerHTML = TONES.map(function (t) {
      return '<button type="button" class="tone" data-tone="' + t.id + '" aria-pressed="' + (data.settings.tone === t.id) + '"><i style="background:' + t.swatch + '"></i>' + esc(t.name) + '</button>';
    }).join('');
    setSwitch('swQuick', data.settings.quick);
    setSwitch('swLock', lockEnabled());
    setSwitch('swBio', lockEnabled() && data.settings.lock.bio);
    $('bioRow').hidden = true;
    if (lockEnabled()) bioAvailable().then(function (ok) { $('bioRow').hidden = !ok; });
    var native = !!plugin('LocalNotifications');
    permState().then(function (st) {
      var el = $('permState'), btn = $('btnPerm');
      if (!native) { el.textContent = 'تعمل التنبيهات الأصلية داخل تطبيق الهاتف فقط'; el.className = ''; btn.hidden = true; return; }
      btn.hidden = st === 'granted';
      if (st === 'granted') { el.textContent = 'مفعّلة'; el.className = 'state-ok'; }
      else if (st === 'denied') { el.textContent = 'محظورة، فعّلها من إعدادات الهاتف'; el.className = 'state-bad'; }
      else { el.textContent = 'غير مفعّلة بعد'; el.className = 'state-bad'; }
    });
    var exactRow = $('exactRow');
    exactRow.hidden = true;
    var LN = plugin('LocalNotifications');
    if (LN && platform() === 'android' && LN.checkExactNotificationSetting) {
      LN.checkExactNotificationSetting().then(function (r) {
        var v = r && r.exact_alarm;
        exactRow.hidden = false;
        $('exactState').textContent = v === 'granted' ? 'مفعّلة، ستصل التنبيهات في وقتها بالضبط' : 'فعّلها لتصل التنبيهات في الدقيقة المحددة';
        $('exactState').className = v === 'granted' ? 'state-ok' : 'state-bad';
        $('btnExact').hidden = v === 'granted';
      }).catch(function () {});
    }
    $('aboutHint').textContent = 'تُحفظ مهامك داخل الهاتف وتبقى بعد تحديث التطبيق. احفظ نسخة احتياطية من حين لآخر، لأن حذف التطبيق من الهاتف يمسح بياناته.';
  }
  function exportBackup() {
    var payload = JSON.stringify({ app: 'munjiz', version: 2, exported: Date.now(), tasks: data.tasks, settings: { tone: data.settings.tone, mode: data.settings.mode, quick: data.settings.quick } }, null, 2);
    var name = 'munjiz-backup-' + toInput(Date.now()).slice(0, 10) + '.json';
    var FS = plugin('Filesystem'), SH = plugin('Share');
    if (FS && SH) {
      FS.writeFile({ path: name, data: payload, directory: 'CACHE', encoding: 'utf8' })
        .then(function (r) { return SH.share({ title: 'نسخة منجِز الاحتياطية', url: r.uri, dialogTitle: 'احفظ النسخة الاحتياطية' }); })
        .catch(function (e) { console.error(e); });
      return;
    }
    try {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) { toast('تعذّر حفظ النسخة'); }
  }
  function importBackup(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        if (!d || !Array.isArray(d.tasks)) throw new Error('bad');
        var added = 0;
        d.tasks.forEach(function (it) {
          if (!it || !it.id || !it.title) return;
          normalizeTask(it);
          var cur = findTask(it.id);
          if (!cur) { data.tasks.push(it); added++; }
          else if ((it.updated || it.created || 0) > (cur.updated || cur.created || 0)) { Object.assign(cur, it); added++; }
        });
        persist(true);
        queueSchedule();
        renderAll();
        toast('تمت الاستعادة (' + added + ' مهمة)');
      } catch (e) { toast('الملف غير صالح'); }
    };
    rd.readAsText(file);
  }

  /* ---------- قفل التطبيق (رمز من 4 أرقام + بصمة اختيارية) ---------- */
  function toHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function randSalt() {
    try { var a = new Uint8Array(12); crypto.getRandomValues(a); return toHex(a); } catch (e) { return String(Math.random()).slice(2) + Date.now(); }
  }
  function hashPin(pin, salt) {
    try {
      if (window.crypto && crypto.subtle && window.TextEncoder) {
        var enc = new TextEncoder();
        return crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']).then(function (k) {
          return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, k, 256);
        }).then(toHex);
      }
    } catch (e) {}
    var h = 5381, s = salt + pin;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Promise.resolve('x' + h);
  }
  function verifyPin(pin) {
    var L = data.settings.lock;
    if (!L) return Promise.resolve(true);
    return hashPin(pin, L.salt).then(function (h) { return h === L.hash; });
  }
  function bioPlugin() { return plugin('BiometricAuthNative') || plugin('BiometricAuth'); }
  function bioAvailable() {
    var B = bioPlugin();
    if (!B || !B.checkBiometry) return Promise.resolve(false);
    return B.checkBiometry().then(function (r) { return !!(r && r.isAvailable); }).catch(function () { return false; });
  }
  function bioAuth() {
    var B = bioPlugin();
    if (!B) return Promise.resolve(false);
    var fn = B.internalAuthenticate || B.authenticate;
    if (!fn) return Promise.resolve(false);
    return fn.call(B, { reason: 'افتح منجِز', cancelTitle: 'استخدام الرمز', allowDeviceCredential: false, iosFallbackTitle: 'استخدام الرمز' })
      .then(function () { return true; }).catch(function () { return false; });
  }
  function drawDots() {
    Array.prototype.forEach.call($('lockDots').children, function (el, i) { el.className = i < lockBuf.length ? 'on' : ''; });
  }
  function shakeDots() {
    var el = $('lockDots');
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }
  function showLock(mode, msg) {
    if (openSheet) closeSheet(true);
    lockMode = mode;
    lockBuf = '';
    var titles = { unlock: 'أدخل الرمز', set1: 'اختر رمزاً من 4 أرقام', set2: 'أعد إدخال الرمز للتأكيد', off: 'أدخل الرمز الحالي لإيقاف القفل' };
    $('lockTitle').textContent = titles[mode];
    $('lockMsg').textContent = msg || '';
    $('lock').hidden = false;
    $('lockCancel').hidden = mode === 'unlock';
    var canBio = mode === 'unlock' && lockEnabled() && !!data.settings.lock.bio;
    $('lockBio').style.visibility = canBio ? 'visible' : 'hidden';
    drawDots();
    if (canBio) tryBio();
  }
  function hideLock() { lockMode = null; lockBuf = ''; $('lock').hidden = true; }
  function backToSettings() { hideLock(); renderSettings(); showSheet('sheetSettings'); }
  function tryBio() {
    bioAuth().then(function (ok) { if (ok && lockMode === 'unlock') { hideLock(); haptic('success'); } });
  }
  function lockKey(k) {
    if (!lockMode) return;
    if (k === 'bio') { tryBio(); return; }
    if (Date.now() < lockUntil) { $('lockMsg').textContent = 'حاول بعد ' + Math.ceil((lockUntil - Date.now()) / 1000) + ' ثانية'; return; }
    if (k === 'del') { lockBuf = lockBuf.slice(0, -1); drawDots(); return; }
    if (lockBuf.length >= 4) return;
    lockBuf += k;
    drawDots();
    haptic('light');
    if (lockBuf.length === 4) setTimeout(processLock, 120);
  }
  function processLock() {
    var pin = lockBuf, mode = lockMode;
    if (!mode || pin.length < 4) return;
    if (mode === 'unlock' || mode === 'off') {
      verifyPin(pin).then(function (ok) {
        if (ok) {
          lockFails = 0;
          if (mode === 'unlock') { hideLock(); haptic('success'); }
          else { data.settings.lock = null; persist(true); toast('تم إيقاف القفل'); backToSettings(); }
        } else {
          lockFails++;
          lockBuf = '';
          drawDots();
          shakeDots();
          haptic('warn');
          if (lockFails >= 5) { lockUntil = Date.now() + 30000; lockFails = 0; $('lockMsg').textContent = 'محاولات كثيرة. حاول بعد 30 ثانية'; }
          else $('lockMsg').textContent = 'الرمز غير صحيح';
        }
      });
    } else if (mode === 'set1') {
      lockFirst = pin;
      showLock('set2');
    } else if (mode === 'set2') {
      if (pin !== lockFirst) { lockFirst = ''; showLock('set1', 'الرمزان غير متطابقين، حاول من جديد'); shakeDots(); return; }
      var salt = randSalt();
      hashPin(pin, salt).then(function (h) {
        data.settings.lock = { salt: salt, hash: h, bio: false };
        persist(true);
        toast('تم تفعيل القفل');
        backToSettings();
      });
    }
  }

  /* ---------- الأحداث ---------- */
  function onAction(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var a = b.dataset.act, id = b.dataset.id;
    if (a === 'ack') dismissAlert(id);
    else if (a === 'snooze') snooze(id, 10);
    else if (a === 'banner-finish') { dismissAlert(id); data.settings.quick ? completeTask(id, '') : openFinishSheet(id); }
    else if (a === 'finish') quickFinish(id, b.closest('.row'));
    else if (a === 'edit') openTaskSheet(id);
    else if (a === 'sub') toggleSub(id, parseInt(b.dataset.i, 10));
    else if (a === 'note') openNoteSheet(id);
    else if (a === 'reopen') reopenTask(id);
    else if (a === 'wk') { weekOffset = Math.min(0, weekOffset + parseInt(b.dataset.d, 10)); dayFilter = null; renderAll(); }
    else if (a === 'day') { var i = parseInt(b.dataset.i, 10); dayFilter = dayFilter === i ? null : i; renderAll(); }
    else if (a === 'range') { statsRange = parseInt(b.dataset.r, 10) === 30 ? 30 : 7; statSel = null; renderAll(); }
    else if (a === 'bar') { var k = parseInt(b.dataset.i, 10); statSel = statSel === k ? null : k; renderAll(); haptic('light'); }
  }
  $('view').addEventListener('click', onAction);
  $('banner').addEventListener('click', onAction);
  $('filters').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cat]');
    if (!b) return;
    catFilter = b.dataset.cat;
    renderAll();
  });
  $('mainSeg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    if (tab === 'stats' && searchOpen) toggleSearch(false);
    renderAll();
    window.scrollTo(0, 0);
  });

  /* البحث */
  function toggleSearch(on) {
    searchOpen = on;
    $('searchBar').hidden = !on;
    if (on) {
      if (tab === 'stats') tab = 'active';
      setTimeout(function () { $('q').focus(); }, 50);
    } else {
      $('q').value = '';
      query = '';
    }
    renderAll();
  }
  $('btnSearch').addEventListener('click', function () { toggleSearch(!searchOpen); });
  $('q').addEventListener('input', function () { query = norm($('q').value.trim()); renderAll(); });
  $('qClear').addEventListener('click', function () { $('q').value = ''; query = ''; renderAll(); $('q').focus(); });

  $('btnAdd').addEventListener('click', function () { unlockAudio(); openTaskSheet(null); });
  $('btnSettings').addEventListener('click', function () { renderSettings(); showSheet('sheetSettings'); });
  $('scrim').addEventListener('click', function () { closeSheet(); });
  document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { closeSheet(); }); });

  /* نموذج المهمة */
  $('fPrio').addEventListener('click', function (e) {
    var b = e.target.closest('[data-prio]');
    if (!b) return;
    draftPrio = parseInt(b.dataset.prio, 10);
    renderPrioSeg();
    haptic('light');
  });
  $('btnSubAdd').addEventListener('click', addDraftSub);
  $('fSubIn').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addDraftSub(); }
  });
  $('fSubs').addEventListener('input', function (e) {
    var i = e.target.getAttribute && e.target.getAttribute('data-subtext');
    if (i != null && draftSubs[+i]) draftSubs[+i].t = e.target.value;
  });
  $('fSubs').addEventListener('click', function (e) {
    var tg = e.target.closest('[data-subtoggle]'), dl = e.target.closest('[data-subdel]');
    if (tg) { var i = +tg.dataset.subtoggle; if (draftSubs[i]) draftSubs[i].d = !draftSubs[i].d; renderDraftSubs(); }
    else if (dl) { draftSubs.splice(+dl.dataset.subdel, 1); renderDraftSubs(); }
  });
  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var title = $('fTitle').value.trim();
    if (!title) return;
    addDraftSub();
    var cat = (document.querySelector('input[name="fcat"]:checked') || {}).value || 'other';
    var due = fromInput($('fDue').value), lead = parseInt($('fLead').value, 10) || 0, rep = $('fRepeat').value || 'none', now = Date.now();
    if (rep !== 'none' && !due) { toast('حدّد موعداً للمهمة حتى يعمل التكرار'); return; }
    var old = editingId ? findTask(editingId) : null;
    var t = Object.assign({
      id: newId(), created: now, done: false, doneAt: null, doneNote: ''
    }, old || {}, {
      title: title, cat: cat, note: $('fNote').value.trim(),
      start: fromInput($('fStart').value) || (old && old.start) || now,
      due: due, lead: lead, remindAt: due ? due - lead * 60000 : null,
      prio: draftPrio, repeat: rep,
      subs: draftSubs.filter(function (s) { return s.t.trim(); }).map(function (s) { return { id: s.id, t: s.t.trim(), d: !!s.d }; })
    });
    var isNew = !old;
    closeSheet();
    tab = 'active';
    saveTask(t);
    haptic('light');
    toast(isNew ? 'تمت إضافة المهمة' : 'تم حفظ التعديلات');
    if (t.remindAt) {
      permState().then(function (st) {
        if (st === 'prompt' || st === 'prompt-with-rationale') requestPerm().then(queueSchedule);
      });
    }
  });
  $('dConfirm').addEventListener('click', function () {
    var id = finishingId, note = $('dNote').value.trim(), mode = finishMode;
    closeSheet();
    if (!id) return;
    if (mode === 'note') {
      var t = findTask(id);
      if (t) { var c = Object.assign({}, t); c.doneNote = note; saveTask(c); toast('تم حفظ الملاحظة'); }
    } else completeTask(id, note);
  });

  /* الإعدادات */
  $('segMode').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mode]');
    if (!b) return;
    data.settings.mode = b.dataset.mode;
    persist(); applyTheme(); renderSettings();
  });
  $('tones').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tone]');
    if (!b) return;
    data.settings.tone = b.dataset.tone;
    persist(); applyTheme(); renderSettings();
  });
  $('swQuick').addEventListener('click', function () { data.settings.quick = !data.settings.quick; persist(); renderSettings(); });
  $('swLock').addEventListener('click', function () {
    if (lockEnabled()) showLock('off');
    else { lockFirst = ''; showLock('set1'); }
  });
  $('swBio').addEventListener('click', function () {
    if (!lockEnabled()) return;
    if (data.settings.lock.bio) { data.settings.lock.bio = false; persist(); renderSettings(); return; }
    bioAuth().then(function (ok) {
      if (ok) { data.settings.lock.bio = true; persist(); toast('تم تفعيل الفتح بالبصمة'); }
      else toast('تعذّر التحقق بالبصمة');
      renderSettings();
    });
  });
  $('btnPerm').addEventListener('click', function () { requestPerm().then(function () { renderSettings(); queueSchedule(); }); });
  $('btnExact').addEventListener('click', function () {
    var LN = plugin('LocalNotifications');
    if (LN && LN.changeExactNotificationSetting) LN.changeExactNotificationSetting().then(function () { setTimeout(renderSettings, 500); }).catch(function () {});
  });
  $('btnTest').addEventListener('click', testNotification);
  $('btnExport').addEventListener('click', exportBackup);
  $('btnImport').addEventListener('click', function () { $('fileImport').click(); });
  $('fileImport').addEventListener('change', function (e) {
    importBackup(e.target.files && e.target.files[0]);
    e.target.value = '';
  });

  /* شاشة القفل */
  $('lockPad').addEventListener('click', function (e) {
    var b = e.target.closest('[data-k]');
    if (b) lockKey(b.dataset.k);
  });
  $('lockCancel').addEventListener('click', backToSettings);

  document.addEventListener('pointerdown', unlockAudio, { once: true });
  function onResume() {
    if (lockEnabled() && !lockMode && hiddenAt && Date.now() - hiddenAt >= LOCK_AFTER_MS) showLock('unlock');
    tick();
    renderAll();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); persist(true); }
    else onResume();
  });

  var AppP = plugin('App');
  if (AppP && AppP.addListener) {
    AppP.addListener('backButton', function () {
      if (lockMode) { if (lockMode !== 'unlock') backToSettings(); return; }
      if (openSheet) closeSheet();
      else if (searchOpen) toggleSearch(false);
      else if (tab !== 'active') { tab = 'active'; renderAll(); }
      else if (AppP.exitApp) AppP.exitApp();
    });
    AppP.addListener('appStateChange', function (s) {
      if (s && !s.isActive) hiddenAt = Date.now();
      else if (s && s.isActive) onResume();
    });
  }
  var LNP = plugin('LocalNotifications');
  if (LNP && LNP.addListener) LNP.addListener('localNotificationActionPerformed', handleAction);

  /* ---------- البدء ---------- */
  applyTheme();
  load().then(function () {
    ready = true;
    applyTheme();
    if (lockEnabled()) showLock('unlock');
    renderAll();
    tick();
    registerActions().then(scheduleAll);
    pendingActions.splice(0).forEach(handleAction);
    try { var sp = plugin('SplashScreen'); if (sp && sp.hide) sp.hide(); } catch (e) {}
  });
  setInterval(tick, 15000);
  setInterval(function () { if (!openSheet && !lockMode) renderAll(); }, 60000);
})();
