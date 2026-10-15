/* Zouwu Forge — установка из панели.
   1) движок: портативный ComfyUI (свой Python) — качает панель (с докачкой);
   2) ноды и модели — фоновый процесс py/ltx_setup.py: живёт, даже если закрыть AE. */
(function (g) {
  'use strict';
  var A = g.LTXCore, Mo = g.LTXModels;
  var fs = require('fs'), path = require('path'), os = require('os'), https = require('https'), cp = require('child_process');
  var APPDIR = A.APPDIR;
  var STATUS = path.join(APPDIR, 'setup_status.json'), LOG = path.join(APPDIR, 'setup.log'), JOB = path.join(APPDIR, 'setup_job.json');
  var TOKEN_FILE = path.join(APPDIR, 'hf_token');
  var NODES_BASE = ['Kosinkadink/ComfyUI-VideoHelperSuite', 'Lightricks/ComfyUI-LTXVideo'];
  var NODE_GGUF = 'city96/ComfyUI-GGUF';

  function mkdirp(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
  function pluginDir() { return path.dirname(decodeURIComponent(g.location.pathname).replace(/^\/([A-Za-z]:)/, '$1')); }

  /* ---------- токен Hugging Face ---------- */
  function getToken() { try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch (e) { return ''; } }
  function setToken(t) { mkdirp(APPDIR); fs.writeFileSync(TOKEN_FILE, (t || '').trim()); }
  function checkToken(t) {
    return new Promise(function (resolve) {
      https.get('https://huggingface.co/api/whoami-v2', { headers: { Authorization: 'Bearer ' + t, 'User-Agent': 'ZouwuForge' } }, function (r) {
        var d = ''; r.on('data', function (c) { d += c; });
        r.on('end', function () { var j = {}; try { j = JSON.parse(d); } catch (e) {} resolve(r.statusCode === 200 ? (j.name || 'ok') : null); });
      }).on('error', function () { resolve(null); });
    });
  }

  /* ---------- загрузка с докачкой (для движка) ---------- */
  function download(url, dest, onProgress, hops) {
    hops = hops || 0;
    var part = dest + '.part';
    var have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    return new Promise(function (resolve, reject) {
      if (hops > 8) { reject(new Error('Слишком много перенаправлений')); return; }
      var h = { 'User-Agent': 'ZouwuForge' };
      if (have) h.Range = 'bytes=' + have + '-';
      https.get(url, { headers: h }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); resolve(download(new URL(res.headers.location, url).toString(), dest, onProgress, hops + 1)); return;
        }
        if (res.statusCode === 416) { res.resume(); fs.renameSync(part, dest); resolve(); return; }
        if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); reject(new Error('HTTP ' + res.statusCode + ' — ' + url)); return; }
        if (res.statusCode === 200) have = 0;
        var total = have + parseInt(res.headers['content-length'] || '0', 10), got = have;
        var f = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
        res.on('data', function (c) { got += c.length; if (onProgress) onProgress(got, total); });
        res.pipe(f);
        f.on('finish', function () { f.close(function () {
          if (total && got < total) { resolve(download(url, dest, onProgress, hops)); return; }   // оборвалось — докачиваем
          fs.renameSync(part, dest); resolve();
        }); });
        res.on('error', reject); f.on('error', reject);
      }).on('error', function (e) {
        setTimeout(function () { resolve(download(url, dest, onProgress, hops)); }, 5000);   // сеть моргнула — повтор
      });
    });
  }
  function getJSON(url) {
    return new Promise(function (resolve, reject) {
      https.get(url, { headers: { 'User-Agent': 'ZouwuForge', Accept: 'application/vnd.github+json' } }, function (r) {
        var d = ''; r.on('data', function (c) { d += c; }); r.on('end', function () { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
  }

  /* ---------- папка установки ---------- */
  function chooseRoot() {
    var ir = A.installRoot && A.installRoot();
    if (ir) {
      try { mkdirp(ir); var t = path.join(ir, '.w'); fs.writeFileSync(t, '1'); fs.unlinkSync(t); return ir; }
      catch (e0) { throw new Error('Нет прав на запись в папку установки ' + ir + ' — перенесите папку Zouwu Forge в другое место и запустите install.bat оттуда'); }
    }
    var c = [];
    try { if (fs.existsSync('D:\\')) c.push('D:\\ZouwuForge'); } catch (e) {}
    c.push(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ZouwuForge'));
    for (var i = 0; i < c.length; i++) {
      try { mkdirp(c[i]); var p = path.join(c[i], '.w'); fs.writeFileSync(p, '1'); fs.unlinkSync(p); return c[i]; } catch (e) {}
    }
    throw new Error('Нет папки, куда можно установить движок (пробовал: ' + c.join(', ') + ')');
  }

  /* ---------- движок ---------- */
  async function ensureEngineInstalled(log) {
    var e = A.readEngine();
    if (e) return e;
    var root = chooseRoot(), engine = path.join(root, 'engine'), tools = path.join(root, 'tools'), dl = path.join(root, 'downloads');
    [engine, tools, dl].forEach(mkdirp);
    var z7 = path.join(tools, '7zr.exe');
    if (!fs.existsSync(z7)) { log('Скачиваю распаковщик 7-Zip…'); await download('https://www.7-zip.org/a/7zr.exe', z7); }
    // Репозиторий ComfyUI переехал в Comfy-Org — берём прямую ссылку на последний релиз (без API)
    var URLS = [
      'https://github.com/Comfy-Org/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z',
      'https://github.com/Comfy-Org/ComfyUI/releases/download/v0.39.0/ComfyUI_windows_portable_nvidia.7z'
    ];
    var arc = path.join(dl, 'ComfyUI_windows_portable_nvidia.7z'), last = 0, ok = false, lastErr = null;
    log('Скачиваю ComfyUI (≈1.9 ГБ) в ' + root);
    for (var i = 0; i < URLS.length && !ok; i++) {
      try {
        await download(URLS[i], arc, function (got, total) {
          var now = Date.now(); if (now - last < 1500) return; last = now;
          log('ComfyUI: ' + Math.round(got / 1048576) + (total ? ' / ' + Math.round(total / 1048576) : '') + ' МБ', total ? got / total : undefined);
        });
        ok = true;
      } catch (e1) { lastErr = e1; log('Не удалось: ' + e1.message + (i + 1 < URLS.length ? ' — пробую запасную ссылку' : '')); }
    }
    if (!ok) throw new Error('Не удалось скачать ComfyUI: ' + (lastErr ? lastErr.message : ''));
    log('Распаковываю ComfyUI…');
    await new Promise(function (resolve, reject) {
      var p = cp.spawn(z7, ['x', arc, '-o' + engine, '-y'], { windowsHide: true });
      var err = ''; p.stderr.on('data', function (d) { err += d; });
      p.on('error', reject);
      p.on('close', function (c) { c === 0 ? resolve() : reject(new Error('7-Zip: код ' + c + ' ' + err.slice(-300))); });
    });
    try { fs.unlinkSync(arc); } catch (e2) {}
    e = A.readEngine();
    if (!e) throw new Error('ComfyUI распакован, но не найден python_embeded в ' + engine);
    log('Движок установлен: ' + path.dirname(e.main));
    return e;
  }

  /* ---------- фоновая установка нод и моделей ---------- */
  function readStatus() { try { return JSON.parse(fs.readFileSync(STATUS, 'utf8')); } catch (e) { return null; } }
  function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
  function running() { var st = readStatus(); return !!(st && st.pid && alive(st.pid) && ['done', 'error', 'need_access'].indexOf(st.state) < 0); }

  async function startSetup(s, log) {
    if (running()) throw new Error('Установка уже идёт');
    var e = await ensureEngineInstalled(log);
    var token = getToken();
    if (!token) throw new Error('Вставьте токен Hugging Face (вкладка «Модели»)');
    var tr = Mo.byId(Mo.TRANSFORMERS, s.transformer);
    var nodes = NODES_BASE.slice();
    if (tr.loader === 'gguf') nodes.push(NODE_GGUF);
    var job = {
      comfyDir: path.dirname(e.main), python: e.python, nodes: nodes, files: Mo.selectedFiles(s),
      token: token, statusFile: STATUS, logFile: LOG
    };
    mkdirp(APPDIR);
    fs.writeFileSync(JOB, JSON.stringify(job, null, 2));
    try { fs.unlinkSync(STATUS); } catch (e1) {}
    fs.appendFileSync(LOG, '\n===== ' + new Date().toLocaleString() + ' =====\n');
    A.stopEngine();     // pip не должен трогать пакеты работающего движка
    var out = fs.openSync(LOG, 'a');
    var env = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', PYTHONNOUSERSITE: '1' });
    var child = cp.spawn(e.python, ['-s', path.join(pluginDir(), 'py', 'ltx_setup.py'), JOB],
      { cwd: path.dirname(e.main), env: env, detached: true, stdio: ['ignore', out, out], windowsHide: true });
    child.unref();
    log('Установка запущена в фоне (PID ' + child.pid + '). Можно закрыть панель — она продолжится.');
    return child.pid;
  }
  function stopSetup() {
    var st = readStatus();
    if (st && st.pid) { try { cp.execSync('taskkill /PID ' + st.pid + ' /T /F', { windowsHide: true, stdio: 'ignore' }); } catch (e) {} }
  }
  function logTail(n) { try { var t = fs.readFileSync(LOG, 'utf8').split('\n'); return t.slice(-(n || 12)).join('\n'); } catch (e) { return ''; } }

  /* ---------- что уже лежит на диске ---------- */
  function fileState(s) {
    var e = A.readEngine();
    var models = e ? path.join(path.dirname(e.main), 'models') : null;
    return Mo.selectedFiles(s).map(function (f) {
      var p = models ? path.join(models, f.dir, f.file) : null;
      var ok = !!(p && fs.existsSync(p));
      var part = p && fs.existsSync(p + '.part') ? fs.statSync(p + '.part').size : 0;
      return { label: f.label, file: f.file, size: f.size, ok: ok, partial: part };
    });
  }
  function nodesState() {
    var e = A.readEngine(); if (!e) return {};
    var nd = path.join(path.dirname(e.main), 'custom_nodes'), r = {};
    NODES_BASE.concat([NODE_GGUF]).forEach(function (n) { r[n] = fs.existsSync(path.join(nd, n.split('/')[1], '__init__.py')); });
    return r;
  }
  function gpuInfo() {
    try {
      var o = cp.execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', { windowsHide: true, timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n')[0].split(',');
      return { name: o[0].trim(), vram: Math.round(parseInt(o[1], 10) / 1024) };
    } catch (e) { return null; }
  }
  function ramGB() { return Math.round(os.totalmem() / 1073741824); }
  function openUrl(u) {
    try { if (g.cep && g.cep.util && g.cep.util.openURLInDefaultBrowser) { g.cep.util.openURLInDefaultBrowser(u); return; } } catch (e) {}
    try { cp.exec('start "" "' + u + '"', { windowsHide: true }); } catch (e2) {}
  }

  g.LTXInstaller = {
    getToken: getToken, setToken: setToken, checkToken: checkToken,
    ensureEngineInstalled: ensureEngineInstalled, startSetup: startSetup, stopSetup: stopSetup,
    readStatus: readStatus, running: running, logTail: logTail, fileState: fileState, nodesState: nodesState,
    gpuInfo: gpuInfo, ramGB: ramGB, openUrl: openUrl, NODE_GGUF: NODE_GGUF
  };
})(window);
