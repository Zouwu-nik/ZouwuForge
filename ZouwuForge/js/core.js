/* Zouwu Forge core — связь с локальным движком (портативный ComfyUI).
   Связь с локальным движком (портативный ComfyUI) только через Node.js:
   браузерный fetch из панели AE ComfyUI отклоняет как cross-site (403).        */
(function (g) {
  'use strict';
  var http = require('http');
  var fs = require('fs');
  var path = require('path');
  var os = require('os');
  var cp = require('child_process');
  var crypto = require('crypto');

  var APPDIR = path.join(process.env.APPDATA || os.homedir(), 'ZouwuForge');
  // переезд со старого названия (Zouwu Forge): переносим настройки, токен и путь к движку
  (function migrate() {
    try {
      var OLD = path.join(process.env.APPDATA || os.homedir(), 'LTXPost');
      if (!fs.existsSync(OLD)) return;
      if (!fs.existsSync(APPDIR)) fs.mkdirSync(APPDIR, { recursive: true });
      fs.readdirSync(OLD).forEach(function (n) {
        var src = path.join(OLD, n), dst = path.join(APPDIR, n === 'ltxpost.json' ? 'settings.json' : n);
        try { if (fs.statSync(src).isFile() && !fs.existsSync(dst)) fs.copyFileSync(src, dst); } catch (e1) {}
      });
    } catch (e) {}
  })();
  var ENGINE_FILE = path.join(APPDIR, 'engine.json');
  var PID_FILE = path.join(APPDIR, 'engine.pid');

  // Ищет движок: engine.json, иначе портативный ComfyUI в стандартных папках (и записывает engine.json)
  // Папка, откуда запущен install.bat: всё (движок, модели, DLSS, LLM) ставится туда
  var ROOT_FILE = path.join(APPDIR, 'install_root.txt');
  function installRoot() {
    try {
      var r = fs.readFileSync(ROOT_FILE, 'utf8').replace(/^\uFEFF/, '').trim().replace(/[\\\/]+$/, '');
      if (r && fs.existsSync(r)) return r;
    } catch (e) {}
    return null;
  }
  function sameDir(a, b) { return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(); }

  function readEngine() {
    var ir = installRoot();
    try {
      var j = JSON.parse(fs.readFileSync(ENGINE_FILE, 'utf8'));
      // движок из другой папки (например старый D:\ZouwuForge) игнорируем, если задана папка установки
      if (j && j.python && fs.existsSync(j.python) && (!ir || (j.root && sameDir(j.root, ir)))) return j;
    } catch (e) {}
    var roots = ir ? [ir] : ['D:\\ZouwuForge', 'C:\\ZouwuForge', 'D:\\LTXPost', 'C:\\LTXPost', 'D:\\AIPost', 'C:\\AIPost', 'E:\\LTXPost', path.join(process.env.LOCALAPPDATA || os.homedir(), 'ZouwuForge'), path.join(process.env.LOCALAPPDATA || os.homedir(), 'LTXPost')];
    for (var i = 0; i < roots.length; i++) {
      var pd = path.join(roots[i], 'engine', 'ComfyUI_windows_portable');
      var py = path.join(pd, 'python_embeded', 'python.exe'), main = path.join(pd, 'ComfyUI', 'main.py');
      if (fs.existsSync(py) && fs.existsSync(main)) {
        var cfg = { root: roots[i], comfyDir: pd, python: py, main: main, port: 8188, extraArgs: [], components: [], detected: true };
        try { fs.mkdirSync(APPDIR, { recursive: true }); fs.writeFileSync(ENGINE_FILE, JSON.stringify(cfg, null, 2)); } catch (e2) {}
        return cfg;
      }
    }
    return null;
  }

  // Запуск процесса с построчным выводом в лог панели
  function runProcess(exe, args, opts, log) {
    return new Promise(function (resolve, reject) {
      var p = cp.spawn(exe, args, Object.assign({ windowsHide: true }, opts || {}));
      var tail = [];
      function pipe(stream) {
        var buf = '';
        stream.on('data', function (d) {
          buf += d.toString('utf8');
          var lines = buf.split(/\r?\n|\r/); buf = lines.pop();
          lines.forEach(function (l) { l = l.trim(); if (!l) return; tail.push(l); if (tail.length > 30) tail.shift(); if (log) log(l); });
        });
      }
      pipe(p.stdout); pipe(p.stderr);
      p.on('error', reject);
      p.on('close', function (code) { code === 0 ? resolve() : reject(new Error('Процесс завершился с кодом ' + code + ':\n' + tail.slice(-8).join('\n'))); });
    });
  }

  function isEngineRunning(comfy) { return comfy.ping().then(function (x) { return !!x; }); }
  function engineUrl() { var e = readEngine(); return 'http://127.0.0.1:' + ((e && e.port) || 8188); }

  /* ---------------- HTTP ---------------- */
  function request(base, method, p, body, binary) {
    return new Promise(function (resolve, reject) {
      var u = new URL(base.replace(/\/+$/, '') + p);
      var data = body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
      var r = http.request({
        hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: method,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
        timeout: 30000
      }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var buf = Buffer.concat(chunks);
          if (binary) { if (res.statusCode >= 400) reject(new Error('HTTP ' + res.statusCode + ' ' + p)); else resolve(buf); return; }
          var txt = buf.toString('utf8'), j;
          try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = { raw: txt }; }
          if (j && typeof j === 'object' && !Array.isArray(j)) j.__status = res.statusCode;
          resolve(j);
        });
      });
      r.on('timeout', function () { r.destroy(new Error('Таймаут запроса ' + p)); });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  }

  /* ---------------- Мини-клиент WebSocket (без заголовка Origin) ---------------- */
  function WS(base, clientId, onMessage) {
    var self = this;
    this.closed = false;
    var u = new URL(base);
    var key = crypto.randomBytes(16).toString('base64');
    var req = http.request({
      hostname: u.hostname, port: u.port || 80, path: '/ws?clientId=' + encodeURIComponent(clientId),
      headers: { 'Connection': 'Upgrade', 'Upgrade': 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key }
    });
    req.on('upgrade', function (res, socket) {
      self.socket = socket;
      var buf = Buffer.alloc(0);
      socket.on('data', function (d) {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          if (buf.length < 2) return;
          var op = buf[0] & 0x0f, len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          var payload = buf.slice(off, off + len);
          buf = buf.slice(off + len);
          if (op === 1) { try { onMessage(JSON.parse(payload.toString('utf8'))); } catch (e) {} }
          else if (op === 9) self._send(0xA, payload);
          else if (op === 8) { self.close(); return; }
        }
      });
      socket.on('error', function () {});
      socket.on('close', function () { self.closed = true; });
    });
    req.on('error', function () { self.closed = true; });
    req.end();
  }
  WS.prototype._send = function (op, payload) {
    if (!this.socket) return;
    var mask = crypto.randomBytes(4), len = payload.length, head;
    if (len < 126) { head = Buffer.from([0x80 | op, 0x80 | len]); }
    else { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
    var masked = Buffer.alloc(len);
    for (var i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
    try { this.socket.write(Buffer.concat([head, mask, masked])); } catch (e) {}
  };
  WS.prototype.close = function () { this.closed = true; try { this.socket && this.socket.destroy(); } catch (e) {} };

  /* ---------------- Клиент ComfyUI ---------------- */
  function Comfy(base) {
    this.base = String(base || engineUrl()).replace(/\/+$/, '');
    this.clientId = 'zouwuforge-' + Math.random().toString(36).slice(2);
    this.listeners = [];
    this.ws = null;
  }
  Comfy.prototype.get = function (p) {
    return request(this.base, 'GET', p).then(function (j) {
      if (j.__status >= 400) throw new Error('ComfyUI ' + p + ': HTTP ' + j.__status);
      return j;
    });
  };
  Comfy.prototype.post = function (p, body) { return request(this.base, 'POST', p, body || {}); };
  Comfy.prototype.ping = function () { return request(this.base, 'GET', '/system_stats').then(function (j) { return j.__status === 200 ? j : null; }).catch(function () { return null; }); };
  Comfy.prototype.objectInfo = function () { return this.get('/object_info'); };

  Comfy.prototype.openSocket = function () {
    var self = this;
    if (this.ws && !this.ws.closed) return;
    this.ws = new WS(this.base, this.clientId, function (m) { self.listeners.slice().forEach(function (fn) { fn(m); }); });
  };
  Comfy.prototype.closeSocket = function () { if (this.ws) this.ws.close(); this.ws = null; };

  function formatErr(res) {
    var msg = (res.error && (res.error.message || JSON.stringify(res.error))) || ('ComfyUI отклонил задачу (HTTP ' + res.__status + ')');
    if (res.node_errors) {
      Object.keys(res.node_errors).forEach(function (id) {
        var ne = res.node_errors[id];
        (ne.errors || []).forEach(function (e) { msg += '\n• ' + (ne.class_type || 'нода') + ' #' + id + ': ' + (e.message || '') + ' ' + (e.details || ''); });
      });
    }
    return msg;
  }

  // Ставит граф в очередь и ждёт завершения. onProgress(value, max, nodeId)
  // onEvent(type, data) — подробности для лога: executing / cached / executed
  Comfy.prototype.execute = function (prompt, onProgress, job, onEvent) {
    var self = this;
    job = job || {};
    this.openSocket();
    return this.post('/prompt', { prompt: prompt, client_id: this.clientId }).then(function (res) {
      if (!res.prompt_id) throw new Error(formatErr(res));
      var pid = res.prompt_id;
      job.promptId = pid;
      return new Promise(function (resolve, reject) {
        var done = false, timer;
        function finish(err, val) {
          if (done) return; done = true;
          clearInterval(timer);
          self.listeners = self.listeners.filter(function (f) { return f !== onMsg; });
          err ? reject(err) : resolve(val);
        }
        function onMsg(m) {
          var d = m.data || {};
          if (d.prompt_id && d.prompt_id !== pid) return;
          if (onEvent && (m.type === 'executing' || m.type === 'execution_cached' || m.type === 'executed' || m.type === 'execution_start')) {
            try { onEvent(m.type, d); } catch (eE) {}
          }
          if (m.type === 'progress' && onProgress) onProgress(d.value, d.max, d.node);
          else if (m.type === 'execution_error') finish(new Error((d.exception_type || 'Ошибка') + ': ' + (d.exception_message || '') + (d.node_type ? ' [' + d.node_type + ']' : '')));
          else if (m.type === 'execution_interrupted') finish(new Error('Остановлено пользователем'));
          else if ((m.type === 'executing' && d.node === null) || m.type === 'execution_success') check();
        }
        function check() {
          if (job.cancelled) { finish(new Error('Остановлено пользователем')); return; }
          self.get('/history/' + pid).then(function (h) {
            var e = h[pid];
            if (!e) return;
            var st = e.status || {};
            if (st.status_str === 'error') {
              var msg = 'Ошибка выполнения в ComfyUI';
              (st.messages || []).forEach(function (mm) {
                if (mm[0] === 'execution_error') msg = (mm[1].exception_type || '') + ': ' + (mm[1].exception_message || '') + (mm[1].node_type ? ' [' + mm[1].node_type + ']' : '');
              });
              finish(new Error(msg));
            } else if (st.completed || (e.outputs && Object.keys(e.outputs).length)) finish(null, e);
          }).catch(function () {});
        }
        self.listeners.push(onMsg);
        timer = setInterval(check, 2000);
      });
    });
  };

  Comfy.prototype.download = function (img, dest) {
    var q = '/view?filename=' + encodeURIComponent(img.filename) + '&subfolder=' + encodeURIComponent(img.subfolder || '') + '&type=' + encodeURIComponent(img.type || 'output');
    return request(this.base, 'GET', q, undefined, true).then(function (buf) { fs.writeFileSync(dest, buf); });
  };

  Comfy.prototype.cancel = function (job) {
    var self = this;
    var p = job && job.promptId ? this.post('/queue', { 'delete': [job.promptId] }) : Promise.resolve();
    return p.then(function () { return self.post('/interrupt', {}); }).catch(function () {});
  };

  /* ---------------- Движок: автозапуск ---------------- */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function startEngine(log, extra) {
    var e = readEngine();
    if (!e || !e.python || !fs.existsSync(e.python)) {
      throw new Error('Движок не установлен. Откройте «Zouwu Forge — Настройки» → вкладка «Модели» → «Установить».');
    }
    fs.mkdirSync(APPDIR, { recursive: true });
    var logFile = path.join(APPDIR, 'engine.log');
    var out = fs.openSync(logFile, 'w');
    var args = ['-s', e.main, '--listen', '127.0.0.1', '--port', String(e.port || 8188), '--disable-auto-launch'];
    (e.extraArgs || []).concat(extra || []).forEach(function (a) { if (args.indexOf(a) < 0) args.push(a); });
    var child = cp.spawn(e.python, args, { cwd: path.dirname(e.main), detached: true, stdio: ['ignore', out, out], windowsHide: true });
    child.unref();
    fs.writeFileSync(PID_FILE, String(child.pid));
    // сторож: движок выключается сам, когда закрывается After Effects
    try {
      var wd = path.join(path.dirname(decodeURIComponent(g.location.pathname).replace(/^\/([A-Za-z]:)/, '$1')), 'py', 'ae_watchdog.py');
      if (fs.existsSync(wd)) {
        var w = cp.spawn(e.python, ['-s', wd, String(child.pid), APPDIR], { detached: true, stdio: 'ignore', windowsHide: true });
        w.unref();
      }
    } catch (ew) {}
    if (log) log('Запускаю движок (ComfyUI, PID ' + child.pid + '). Первый старт может занять 1–2 минуты.');
    return child.pid;
  }

  // Гарантирует, что движок запущен; при необходимости запускает и ждёт готовности
  async function ensureEngine(comfy, log, job, extra) {
    var st = await comfy.ping();
    if (st) return st;
    startEngine(log, extra);
    var t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      if (job && job.cancelled) throw new Error('Остановлено пользователем');
      await sleep(2000);
      st = await comfy.ping();
      if (st) { if (log) log('Движок готов за ' + Math.round((Date.now() - t0) / 1000) + ' с'); return st; }
    }
    throw new Error('Движок не ответил за 4 минуты. Лог: ' + path.join(APPDIR, 'engine.log'));
  }

  function stopEngine() {
    try {
      var pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
      if (pid) {
        if (process.platform === 'win32') cp.execSync('taskkill /PID ' + pid + ' /T /F', { windowsHide: true, stdio: 'ignore' });
        else process.kill(pid);
      }
      fs.unlinkSync(PID_FILE);
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- Связь с AE ---------------- */
  function evalScript(code) {
    return new Promise(function (res) {
      var cep = g.__adobe_cep__;
      if (!cep) { res(JSON.stringify({ error: 'Панель запущена вне After Effects.' })); return; }
      cep.evalScript(code, res);
    });
  }
  function callHost(ns, fn, args) {
    var payload = JSON.stringify(args || {});
    return evalScript(ns + '.' + fn + '(' + JSON.stringify(payload) + ')').then(function (r) {
      var o;
      try { o = JSON.parse(r); } catch (e) { throw new Error('Ответ AE: ' + r); }
      if (o && o.error) throw new Error(o.error);
      return o;
    });
  }
  function openExtension(id) { try { g.__adobe_cep__.requestOpenExtension(id, ''); } catch (e) {} }

  /* ---------------- Настройки ---------------- */
  function settingsStore(name, defaults) {
    var file = path.join(APPDIR, name + '.json');
    return {
      file: file,
      load: function () {
        var s = {}, k, data = {};
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
        for (k in defaults) s[k] = defaults[k];
        for (k in data) s[k] = data[k];
        return s;
      },
      save: function (s) { fs.mkdirSync(APPDIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 2), 'utf8'); },
      watch: function (cb) { var self = this; try { fs.mkdirSync(APPDIR, { recursive: true }); } catch (e) {} fs.watchFile(file, { interval: 700 }, function () { cb(self.load()); }); }
    };
  }

  /* ---------------- Утилиты ---------------- */
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function stamp() { var d = new Date(); return d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) + '_' + pad(d.getHours(), 2) + pad(d.getMinutes(), 2) + pad(d.getSeconds(), 2); }
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60) || 'comp'; }
  function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }
  function listImages(dir, re) { return fs.readdirSync(dir).filter(function (f) { return (re || /\.(png|tif|tiff|jpe?g|exr)$/i).test(f); }).sort(); }
  // Выбор папки (диалог CEP) с проверкой, что в неё можно писать. Возвращает путь или null.
  function pickFolder(title, initial) {
    var r = null;
    try { r = g.cep.fs.showOpenDialogEx(false, true, title || 'Выберите папку', initial || ''); } catch (e) { return null; }
    if (!r || !r.data || !r.data.length) return null;
    var p = decodeURIComponent(String(r.data[0]).replace(/^file:\/+/, '')).replace(/\//g, '\\');
    try {
      fs.mkdirSync(p, { recursive: true });
      var probe = path.join(p, '.zf_write_test'); fs.writeFileSync(probe, '1'); fs.unlinkSync(probe);
    } catch (e2) { throw new Error('В папку нельзя записывать: ' + p + ' (' + e2.message + ')'); }
    return p;
  }
  function openFolder(p) {
    try { fs.mkdirSync(p, { recursive: true }); } catch (e) {}
    try { cp.exec('explorer "' + p + '"', { windowsHide: true }); } catch (e2) {}
  }
  // Свободное место на диске, где лежит dir (байты; null — не удалось узнать)
  function freeBytes(dir) {
    try { if (fs.statfsSync) { var st = fs.statfsSync(dir); return st.bavail * st.bsize; } } catch (e) {}
    try {
      var drive = path.parse(path.resolve(dir)).root.replace(/[\\\/]+$/, '');
      var out = cp.execSync('powershell -NoProfile -Command "[System.IO.DriveInfo]::new(\'' + drive + '\').AvailableFreeSpace"', { windowsHide: true, timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      var n = Number(out); return isFinite(n) ? n : null;
    } catch (e2) { return null; }
  }
  function dirBytes(dir) {
    var t = 0;
    try { fs.readdirSync(dir).forEach(function (n) { try { var st = fs.statSync(path.join(dir, n)); if (st.isFile()) t += st.size; } catch (e) {} }); } catch (e) {}
    return t;
  }
  function fmtTime(sec) { sec = Math.round(sec); var m = Math.floor(sec / 60); return (m ? m + ' мин ' : '') + (sec % 60) + ' с'; }
  function linkOrCopy(src, dst) { try { fs.linkSync(src, dst); } catch (e) { fs.copyFileSync(src, dst); } }
  function pickFolder(title, initial, cb) {
    try {
      var r = g.cep.fs.showOpenDialogEx ? g.cep.fs.showOpenDialogEx(false, true, title, initial) : g.cep.fs.showOpenDialog(false, true, title, initial);
      if (r && r.data && r.data.length) cb(decodeURIComponent(String(r.data[0]).replace(/^file:\/+/, '')));
    } catch (e) {}
  }

  g.AIPost = g.LTXCore = {
    APPDIR: APPDIR, ENGINE_FILE: ENGINE_FILE, installRoot: installRoot, readEngine: readEngine, engineUrl: engineUrl,
    request: request, runProcess: runProcess, isEngineRunning: isEngineRunning, Comfy: Comfy, ensureEngine: ensureEngine, startEngine: startEngine, stopEngine: stopEngine,
    callHost: callHost, openExtension: openExtension, settingsStore: settingsStore,
    pad: pad, stamp: stamp, safeName: safeName, rmrf: rmrf, listImages: listImages, fmtTime: fmtTime, pickFolder: pickFolder, openFolder: openFolder, freeBytes: freeBytes, dirBytes: dirBytes,
    linkOrCopy: linkOrCopy, pickFolder: pickFolder, sleep: sleep,
    fs: fs, path: path
  };
})(window);
