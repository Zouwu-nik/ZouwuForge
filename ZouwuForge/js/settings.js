/* Zouwu Forge — окно «Настройки»: модели, качество, файлы */
(function () {
  'use strict';
  var A = window.LTXCore, Mo = window.LTXModels, T = window.LTXTools, I = window.LTXInstaller, store = window.LTXStore;
  var $ = function (id) { return document.getElementById(id); };
  var s = store.load();
  var gpu = I.gpuInfo(), ram = I.ramGB();

  var MODEL_KEYS = ['transformer', 'encoder', 'encoderCpu', 'vae', 'lowvram'];
  var TIER_KEYS = ['transformer', 'encoder', 'encoderCpu', 'vae', 'outSide', 'chunkLen', 'tileSize', 'lowvram'];
  var FIELDS = ['transformer', 'encoder', 'encoderCpu', 'vae', 'lowvram', 'stage2', 'anchor', 'detail', 'resMode', 'customSide', 'outSide', 'chunkLen', 'tileSize', 'seed', 'randomSeed', 'workDir', 'cleanupSource', 'omTemplate', 'cleanupKeep', 'cleanupProtect'];
  var NUM = { customSide: 1, detail: 1, outSide: 1, chunkLen: 1, tileSize: 1, seed: 1, cleanupKeep: 1 };

  // первый запуск: пресет по видеокарте
  function applyPreset() { var p = Mo.presetFor(s.gpuGen, s.vramGb); TIER_KEYS.forEach(function (k) { s[k] = p[k]; }); }
  function samePreset() { var p = Mo.presetFor(s.gpuGen, s.vramGb); return MODEL_KEYS.every(function (k) { return s[k] === p[k]; }); }
  if (!s.gpuGen || !s.vramGb) {
    s.gpuGen = Mo.detectGen(gpu); s.vramGb = Mo.detectVram(gpu);
    if (!s.tier) { applyPreset(); s.tier = 'auto'; }  // первый запуск — сразу набор под карту
    else s.manualModels = !samePreset();              // переход со старых пресетов: уже скачанное не трогаем
    save(true);
  }

  // новые инструменты добавляем в список загрузки один раз
  if (!s._seenRelight) { if (s.toolsToInstall.indexOf('relight') < 0) s.toolsToInstall.push('relight'); s._seenRelight = true; }
  if (!s._seenCamera) { if (s.toolsToInstall.indexOf('camera') < 0) s.toolsToInstall.unshift('camera'); s._seenCamera = true; }
  if (!s._seenCamxfer) { if (s.toolsToInstall.indexOf('camxfer') < 0) s.toolsToInstall.push('camxfer'); s._seenCamxfer = true; }
  if (!s._seenPrompt) { if (s.toolsToInstall.indexOf('prompt') < 0) s.toolsToInstall.unshift('prompt'); s._seenPrompt = true; }

  /* ---------- сохранение ---------- */
  var timer;
  function save(now) {
    clearTimeout(timer);
    var go = function () {
      var cur = store.load();
      FIELDS.concat(['tier', 'gpuGen', 'vramGb', 'manualModels', 'toolsToInstall', 'dlss', '_seenPrompt', '_seenCamera', '_seenCamxfer', '_seenRelight', 'llm', 'cleanMode', 'cleanOrphans', 'cleanTemp', 'cleanRoot']).forEach(function (k) { cur[k] = s[k]; });
      try { store.save(cur); $('saved').textContent = 'Сохранено ' + new Date().toLocaleTimeString(); } catch (e) { $('saved').textContent = 'Ошибка сохранения: ' + e.message; }
    };
    if (now === true) go(); else timer = setTimeout(go, 200);
  }

  /* ---------- вкладки ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
    b.onclick = function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (x) { x.classList.toggle('on', x === b); });
      ['models', 'quality', 'dlss', 'files'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab); });
      if (b.dataset.tab === 'files') refreshEngine();
      if (b.dataset.tab === 'dlss') dlssStatus();
    };
  });

  /* ---------- заполнение ---------- */
  function fill(el, opts, cur) {
    el.innerHTML = '';
    opts.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; if (o[2]) op.disabled = true; el.appendChild(op); });
    el.value = String(cur);
  }
  function renderSelects() {
    var isRtx50 = gpu && /RTX\s*50/i.test(gpu.name);
    var dg = Mo.detectGen(gpu), dv = Mo.detectVram(gpu);
    fill($('gpuGen'), Mo.GENS.map(function (g2) { return [g2[0], g2[1] + (gpu && g2[0] === dg ? ' — ваша' : '')]; }), s.gpuGen);
    fill($('vramGb'), Mo.VRAMS.map(function (v) { return [String(v[0]), v[1] + (gpu && v[0] === dv ? ' — ваша' : '')]; }), String(s.vramGb));
    $('manualModels').checked = !!s.manualModels;
    $('manualBox').classList.toggle('hidden', !s.manualModels);
    fill($('transformer'), Mo.TRANSFORMERS.map(function (m) { return [m.id, m.label + (m.blackwell && !isRtx50 ? ' — не для вашей карты' : '')]; }), s.transformer);
    fill($('encoder'), Mo.ENCODERS.map(function (m) { return [m.id, m.label]; }), s.encoder);
    fill($('vae'), Mo.VAES.map(function (m) { return [m.id, m.label]; }), s.vae);
    $('tierHint').textContent = s.manualModels ? 'Свой набор компонентов.' : Mo.presetFor(s.gpuGen, s.vramGb).hint;
  }
  function renderHW() {
    var h = [];
    h.push('<div>' + (gpu ? gpu.name + ', ' + gpu.vram + ' ГБ видеопамяти' : '<span class="warn">Видеокарта NVIDIA не найдена (nvidia-smi)</span>') + ' · ОЗУ ' + ram + ' ГБ</div>');
    if (gpu) h.push('<div class="muted">Определено: <b>' + Mo.GENS.filter(function (x) { return x[0] === Mo.detectGen(gpu); })[0][1] + ', ' + Mo.detectVram(gpu) + (Mo.detectVram(gpu) >= 32 ? '+' : '') + ' ГБ</b></div>');
    var tr = Mo.byId(Mo.TRANSFORMERS, s.transformer);
    if (tr.blackwell && !(gpu && /RTX\s*50/i.test(gpu.name))) h.push('<div class="bad">NVFP4 работает только на RTX 50 — выберите int8 или GGUF.</div>');
    if (gpu && tr.size > gpu.vram + ram * 0.6) h.push('<div class="warn">Трансформер (' + tr.size + ' ГБ) больше, чем видеопамять + свободная ОЗУ — может не запуститься.</div>');
    $('hw').innerHTML = h.join('');
  }
  function renderTools() {
    var box = $('toolsChecks'); box.innerHTML = '';
    T.TOOLS.filter(function (t) { return t.kind !== 'dlss'; }).forEach(function (t) {
      var l = document.createElement('label'); l.className = 'check';
      var c = document.createElement('input'); c.type = 'checkbox'; c.checked = s.toolsToInstall.indexOf(t.id) >= 0;
      c.onchange = function () {
        s.toolsToInstall = T.TOOLS.filter(function (x) { return x.kind !== 'dlss'; }).map(function (x) { return x.id; }).filter(function (id, i) { return box.querySelectorAll('input')[i].checked; });
        save(); renderFiles();
      };
      l.appendChild(c); l.appendChild(document.createTextNode(t.label.split(' — ')[0]));
      box.appendChild(l);
    });
  }
  function renderFiles() {
    var st = I.fileState(s), need = 0;
    $('fileList').innerHTML = st.map(function (f) {
      if (!f.ok) need += f.size;
      var mark = f.ok ? '<span class="ok">✓</span>' : (f.partial ? '<span class="warn">◐</span>' : '<span class="muted">○</span>');
      return '<div><span>' + mark + ' ' + f.label + '</span><span class="sz">' + f.size.toFixed(1) + ' ГБ</span></div>';
    }).join('');
    $('totalSize').textContent = need ? 'к загрузке ≈ ' + need.toFixed(1) + ' ГБ' : 'всё скачано';
    renderHW();
  }
  function toUI() {
    FIELDS.forEach(function (k) { var el = $(k); if (!el) return; if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = String(s[k]); });
    renderSelects(); renderFiles();
    $('anchor').disabled = !s.stage2;
  }

  function workInfo() {
    var fb = A.freeBytes(s.workDir) ;
    if (fb === null) { try { fb = A.freeBytes(A.path.parse(A.path.resolve(s.workDir)).root); } catch (e) {} }
    $('workInfo').innerHTML = fb === null ? '' : 'Свободно на диске ' + A.path.parse(A.path.resolve(s.workDir)).root + ': <b>' + (fb / 1073741824).toFixed(0) + ' ГБ</b>' + (fb < 50 * 1073741824 ? ' <span class="warn">— маловато для 4K, выберите диск посвободнее</span>' : '');
  }

  /* ---------- события ---------- */
  function bind() {
    FIELDS.forEach(function (k) {
      var el = $(k); if (!el) return;
      el.addEventListener(el.type === 'text' || el.type === 'number' ? 'input' : 'change', function () {
        s[k] = el.type === 'checkbox' ? el.checked : (NUM[k] ? Number(el.value) : el.value);
        if (MODEL_KEYS.indexOf(k) >= 0) { s.manualModels = true; s.tier = 'custom'; $('tierHint').textContent = 'Свой набор компонентов.'; }
        if (k === 'stage2') $('anchor').disabled = !s.stage2;
        if (MODEL_KEYS.indexOf(k) >= 0) renderFiles();
        save();
      });
    });
    function onCard() { s.manualModels = false; s.tier = 'auto'; applyPreset(); toUI(); save(); }
    $('gpuGen').addEventListener('change', function () { s.gpuGen = this.value; onCard(); });
    $('vramGb').addEventListener('change', function () { s.vramGb = Number(this.value); onCard(); });
    $('manualModels').addEventListener('change', function () {
      if (this.checked) { s.manualModels = true; s.tier = 'custom'; toUI(); save(); }
      else onCard();   // выключили ручной режим — возвращаем набор под карту
    });
    $('lnkTokens').onclick = function () { I.openUrl('https://huggingface.co/settings/tokens'); };
    $('token').value = I.getToken();
    $('btnToken').onclick = checkToken;
    $('token').addEventListener('change', function () { I.setToken(this.value); });
    $('btnInstall').onclick = install;
    $('btnStopSetup').onclick = function () { I.stopSetup(); setTimeout(poll, 800); };
    $('btnWork').onclick = function () {
      try {
        var p = A.pickFolder('Папка для результатов и секвенций', s.workDir);
        if (p) { s.workDir = p; $('workDir').value = p; save(); workInfo(); }
      } catch (e) { $('workInfo').innerHTML = '<span class="bad">' + e.message + '</span>'; }
    };
    $('btnWorkOpen').onclick = function () { A.openFolder(s.workDir); };
    $('workDir').addEventListener('change', workInfo);
    workInfo();
    $('btnStart').onclick = function () {
      $('engStatus').textContent = 'Запускаю…';
      A.ensureEngine(new A.Comfy(A.engineUrl()), function (m) { $('engStatus').textContent = m; }, null, window.LTXEngineArgs(s))
        .then(refreshEngine).catch(function (e) { $('engStatus').innerHTML = '<span class="bad">' + e.message + '</span>'; });
    };
    $('btnStop').onclick = function () { A.stopEngine(); setTimeout(refreshEngine, 1500); };
    $('btnOpenRun').onclick = function () { A.openExtension(window.LTX_IDS.RUN); };
    $('btnPickEngine').onclick = function () {
      try {
        var r = window.cep.fs.showOpenDialogEx(false, true, 'Папка ComfyUI_windows_portable', '');
        if (!(r && r.data && r.data.length)) return;
        var dir = decodeURIComponent(String(r.data[0]).replace(/^file:\/+/, ''));
        var py = A.path.join(dir, 'python_embeded', 'python.exe'), main = A.path.join(dir, 'ComfyUI', 'main.py');
        var fs = require('fs');
        if (!fs.existsSync(py) || !fs.existsSync(main)) { $('engStatus').innerHTML = '<span class="bad">В этой папке нет python_embeded\\python.exe и ComfyUI\\main.py</span>'; return; }
        if (!fs.existsSync(A.APPDIR)) fs.mkdirSync(A.APPDIR, { recursive: true });
        fs.writeFileSync(A.ENGINE_FILE, JSON.stringify({ root: A.path.dirname(dir), comfyDir: dir, python: py, main: main, port: 8188, extraArgs: [] }, null, 2));
        refreshEngine(); renderFiles();
      } catch (e) { $('engStatus').innerHTML = '<span class="bad">' + e.message + '</span>'; }
    };
  }

  function checkToken() {
    var t = $('token').value.trim();
    I.setToken(t);
    $('tokenState').textContent = 'Проверяю…';
    I.checkToken(t).then(function (name) {
      $('tokenState').innerHTML = name ? '<span class="ok">✓ Токен принят (' + name + ')</span>' : '<span class="bad">✗ Токен не принят — проверьте его</span>';
    });
  }

  /* ---------- установка ---------- */
  function setupLog(m, frac) {
    var el = $('setupLog'); el.textContent += m + '\n'; el.scrollTop = el.scrollHeight;
    $('setupStage').textContent = m;
    if (frac !== undefined) $('setupBar').style.width = (frac * 100).toFixed(1) + '%';
  }
  function install() {
    if (!$('token').value.trim()) { $('setupStage').innerHTML = '<span class="bad">Сначала вставьте токен Hugging Face</span>'; return; }
    I.setToken($('token').value);
    var tr = Mo.byId(Mo.TRANSFORMERS, s.transformer);
    if (tr.blackwell && !(gpu && /RTX\s*50/i.test(gpu.name)) && !confirm('NVFP4 работает только на RTX 50. Всё равно скачать?')) return;
    $('btnInstall').disabled = true; $('access').classList.add('hidden');
    $('setupLog').textContent = '';
    I.startSetup(s, setupLog).then(function () { setTimeout(poll, 1000); })
      .catch(function (e) { setupLog('Ошибка: ' + e.message); $('setupStage').className = 'status bad'; $('btnInstall').disabled = false; });
  }
  function fmtB(b) { return b > 1073741824 ? (b / 1073741824).toFixed(1) + ' ГБ' : Math.round(b / 1048576) + ' МБ'; }
  function poll() {
    var st = I.readStatus(), run = I.running();
    $('btnStopSetup').disabled = !run;
    $('btnInstall').disabled = run;
    if (!st) return;
    var cls = st.state === 'error' ? 'bad' : (st.state === 'done' ? 'ok' : (st.state === 'need_access' ? 'warn' : ''));
    $('setupStage').className = 'status ' + cls;
    $('setupStage').textContent = (st.state === 'error' ? 'Ошибка: ' + (st.message || '') : st.step || st.state) + (st.count && st.state !== 'done' && st.state !== 'error' ? ' (' + st.index + ' из ' + st.count + ')' : '');
    if (st.total) {
      $('setupBar').style.width = (100 * st.done / st.total).toFixed(1) + '%';
      var eta = st.speed > 0 ? (st.total - st.done) / st.speed : 0;
      $('setupEta').textContent = fmtB(st.done) + ' из ' + fmtB(st.total) + (st.speed ? ' · ' + fmtB(st.speed) + '/с · осталось ~' + A.fmtTime(eta) : '');
    }
    // процесс установки уже не работает, а в статусе осталось «качаю» — это не зависание, а остановленная загрузка
    if (!run && ['done', 'error', 'need_access'].indexOf(st.state) < 0) {
      $('setupStage').className = 'status warn';
      $('setupStage').textContent = 'Загрузка прервана (процесс установки не запущен). Нажмите «Установить / докачать» — продолжится с того же места.';
      if (st.total) $('setupEta').textContent = 'Скачано ' + fmtB(st.done) + ' из ' + fmtB(st.total);
    }
    if (st.state === 'done') { $('setupBar').style.width = '100%'; $('setupEta').textContent = 'Всё установлено. Можно работать в «Zouwu Forge — Инструменты».'; }
    if (st.state === 'need_access') {
      var acc = $('access'); acc.classList.remove('hidden');
      acc.innerHTML = '<div>Откройте каждую страницу, нажмите <b>«Agree and access»</b>, затем «Установить» ещё раз:</div>' +
        st.repos.map(function (r) { return '<a data-u="https://huggingface.co/' + r + '">↗ ' + r + '</a>'; }).join('') +
        '<a data-all="1"><b>Открыть все страницы</b></a>';
      Array.prototype.forEach.call(acc.querySelectorAll('a'), function (a) {
        a.onclick = function () { if (a.dataset.all) st.repos.forEach(function (r, i) { setTimeout(function () { I.openUrl('https://huggingface.co/' + r); }, i * 400); }); else I.openUrl(a.dataset.u); };
      });
    }
    $('setupLog').textContent = I.logTail(14);
    if (st.state === 'done' || st.state === 'error') renderFiles();
  }

  function refreshEngine() {
    var e = A.readEngine();
    $('engPath').textContent = e ? 'Папка: ' + A.path.dirname(e.main) : 'Движок ещё не установлен — вкладка «Модели» → «Установить».';
    new A.Comfy(A.engineUrl()).ping().then(function (st) {
      $('engStatus').innerHTML = st ? '<span class="ok">✓ Движок работает</span>' : '<span class="muted">Остановлен — стартует сам при первом прогоне.</span>';
    });
  }
  function loadTemplates() {
    function put(list) { fill($('omTemplate'), [['', 'Авто (PNG-секвенция)']].concat(list.map(function (t) { return [t, t]; })), s.omTemplate || ''); }
    put([]);
    A.callHost('LTXP', 'listOMTemplates').then(function (r) { put(r.templates || []); }).catch(function () {});
  }

  /* ---------- DLSS 5 ---------- */
  var D = window.LTXDlss;
  var DKEYS = ['factor', 'nr_style', 'nr_preset', 'nr_intensity', 'local_tone_strength', 'local_structure_strength', 'skin_structure_strength', 'warmup'];
  function dlssStatus() {
    var st = D.appStatus(), h = [];
    if (gpu && !/RTX\s*(30|40|50)/i.test(gpu.name)) h.push('<div class="bad">DLSS 5 работает только на RTX 30/40/50.</div>');
    if (st.ok) { h.push('<div class="ok">✓ Сборка DLSS 5 установлена</div><div>' + st.dir + '</div>'); $('btnDlssInstall').textContent = 'Переустановить'; }
    else if (st.workerMissing) h.push('<div class="bad">✗ nvngx.dll удалён Защитником Windows. Добавьте в исключения папку ' + st.dir + ' и нажмите «Установить».</div>');
    else h.push('<div class="warn">Не установлена — скачается при первом запуске или по кнопке «Установить».</div><div>Папка: ' + st.dir + '</div>');
    $('dlssStatus').innerHTML = h.join('');
  }
  function dlssToUI() {
    var d = s.dlss;
    fill($('d_preset'), Object.keys(D.PRESETS).map(function (k) { return [k, D.PRESETS[k].label]; }), d.preset || 'custom');
    fill($('d_factor'), D.UPSCALE, String(d.factor));
    fill($('d_nr_style'), [['Default', 'Default'], ['Natural', 'Natural'], ['Cinematic', 'Cinematic']], d.nr_style);
    fill($('d_nr_preset'), [['Default', 'Default'], ['Preset #1', 'Preset #1'], ['Preset #2', 'Preset #2'], ['Preset #3', 'Preset #3']], d.nr_preset);
    ['nr_intensity', 'local_tone_strength', 'local_structure_strength', 'skin_structure_strength', 'warmup'].forEach(function (k) {
      var el = $('d_' + k); el.value = d[k];
      var v = el.parentNode.querySelector('.val'); if (v) v.textContent = Number(el.value).toFixed(2);
    });
  }
  function dlssBind() {
    $('d_preset').addEventListener('change', function () {
      var p = D.PRESETS[this.value]; s.dlss.preset = this.value;
      if (p && p.v) Object.keys(p.v).forEach(function (k) { s.dlss[k] = p.v[k]; });
      dlssToUI(); save();
    });
    DKEYS.forEach(function (k) {
      var el = $('d_' + k);
      el.addEventListener(el.type === 'range' || el.type === 'number' ? 'input' : 'change', function () {
        s.dlss[k] = (el.type === 'range' || el.type === 'number') ? Number(el.value) : el.value;
        var v = el.parentNode.querySelector('.val'); if (v) v.textContent = Number(el.value).toFixed(2);
        if (k !== 'warmup' && s.dlss.preset !== 'custom') { s.dlss.preset = 'custom'; $('d_preset').value = 'custom'; }
        save();
      });
    });
    $('btnDlssInstall').onclick = function () {
      var st = D.appStatus();
      if (st.ok && !confirm('Переустановить DLSS 5? Папка ' + st.dir + ' будет скачана заново.')) return;
      if (st.ok || st.workerMissing) A.rmrf(st.dir);
      $('btnDlssInstall').disabled = true;
      var lg = $('dlssLog'); lg.classList.remove('hidden'); lg.textContent = '';
      D.ensureDlss(function (m) { lg.textContent += m + '\n'; lg.scrollTop = lg.scrollHeight; })
        .then(dlssStatus)
        .catch(function (e) { $('dlssStatus').innerHTML = '<div class="bad">' + e.message.replace(/\n/g, '<br>') + '</div>'; })
        .then(function () { $('btnDlssInstall').disabled = false; });
    };
  }
  s.dlss = Object.assign({}, window.LTXDefaults.dlss, s.dlss || {});
  dlssToUI(); dlssBind(); dlssStatus();
  // пресет мог смениться в окне инструментов — подхватываем
  store.watch(function (ns) {
    if (ns.dlss && JSON.stringify(ns.dlss) !== JSON.stringify(s.dlss)) { s.dlss = Object.assign({}, window.LTXDefaults.dlss, ns.dlss); dlssToUI(); }
    // эти настройки меняются и в окне инструментов — подхватываем, чтобы не затереть их при следующем сохранении
    ['stage2', 'anchor', 'detail', 'resMode', 'outSide', 'customSide', 'workDir'].forEach(function (k) {
      if (ns[k] !== undefined && ns[k] !== s[k]) { s[k] = ns[k]; var el = $(k); if (el) { if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = String(s[k]); } }
    });
    if ($('anchor')) $('anchor').disabled = !s.stage2;
  });

  /* ---------- помощник (ЛЛМ) ---------- */
  var L = window.LTXLlm, llmBusy = false;
  function llmUI() {
    var sel = $('llm');
    if (!sel.options.length) {
      sel.innerHTML = '<option value="">Выключен</option>' + Object.keys(L.MODELS).map(function (k) { return '<option value="' + k + '">' + L.MODELS[k].label + '</option>'; }).join('');
    }
    sel.value = s.llm || '';
    var st = s.llm ? L.status(s.llm) : null;
    $('btnLlm').disabled = llmBusy || !s.llm || (st && st.bin && st.model);
    $('btnLlm').textContent = st && st.bin && st.model ? 'Установлен' : 'Установить';
    if (llmBusy) return;
    $('llmStatus').innerHTML = !s.llm ? 'Кнопки «Описать» и «Улучшить» будут неактивны.'
      : !st.engine ? '<span class="warn">Сначала установите движок.</span>'
      : st.bin && st.model ? '<span class="ok">✓ Готов к работе</span>'
      : 'Нужно скачать ' + L.MODELS[s.llm].size.toFixed(1) + ' ГБ: llama.cpp и модель.';
  }
  $('llm').onchange = function () { s.llm = this.value; save(); llmUI(); };
  $('btnLlm').onclick = function () {
    if (!s.llm) return;
    llmBusy = true; llmUI(); $('llmBarWrap').classList.remove('hidden');
    L.install(s.llm, gpu, I.getToken(), function (m, frac) {
      $('llmStatus').textContent = m;
      if (frac !== undefined) $('llmBar').style.width = Math.round(frac * 100) + '%';
    }).then(function () { llmBusy = false; $('llmBarWrap').classList.add('hidden'); llmUI(); })
      .catch(function (e) { llmBusy = false; llmUI(); $('llmStatus').innerHTML = '<span class="bad">' + e.message + '</span>'; });
  };
  if (s.llm === undefined || s.llm === null) s.llm = '';
  llmUI();

  /* ---------- очистка генераций ---------- */
  var C = window.LTXCleanup, cleanPlan = null;
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function cleanModeUI() {
    var m = s.cleanMode || 'comp';
    $('cleanMode').value = m;
    $('cleanCompBox').classList.toggle('hidden', m !== 'comp');
    $('cleanCountBox').classList.toggle('hidden', m !== 'count');
    $('cleanOrphans').checked = !!s.cleanOrphans;
    $('cleanTemp').checked = s.cleanTemp !== false;
    $('btnCleanRun').disabled = true; cleanPlan = null; $('cleanList').innerHTML = '';
    $('cleanInfo').textContent = m === 'comp'
      ? 'Выберите композицию и нажмите «Посчитать» — покажу, что уйдёт из проекта и с диска.'
      : 'Удаляются целиком папки прошлых прогонов в рабочей папке. Модели и движок не трогаются.';
  }
  function loadComps() {
    return A.callHost('LTXP', 'listComps').then(function (r) {
      var sel = $('cleanRoot'), keep = sel.value;
      sel.innerHTML = '<option value="">— активная композиция' + '' + ' —</option>' + (r.comps || []).map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
      }).join('');
      if (keep && [].some.call(sel.options, function (o) { return o.value === keep; })) sel.value = keep;
      else if (r.activeId) sel.value = String(r.activeId);
    }).catch(function () {});
  }
  function tempLine(tp) { return tp.list.length ? '<br>Промежуточные файлы у оставшихся: <b>' + tp.list.length + '</b> генераций (' + fmtB(tp.bytes) + ')' : ''; }
  function tempTag(tp, j) {
    var t = tp.list.filter(function (x) { return x.name === j.name; })[0];
    return t ? ' <span class="muted">(− промежуточные ' + fmtB(t.bytes) + ')</span>' : '';
  }
  function scanByComp() {
    var rootId = parseInt($('cleanRoot').value, 10) || 0;
    return A.callHost('LTXP', 'cleanupPlan', { rootId: rootId, workDir: s.workDir }).then(function (plan) {
      var d = C.planByComp(s.workDir, plan, !!s.cleanOrphans);
      var tp = s.cleanTemp !== false ? C.planTemp(d.jobs.filter(function (j) { return j.keep; }), plan.allPaths) : { list: [], bytes: 0 };
      cleanPlan = { mode: 'comp', items: plan.remove, del: d.del, delBytes: d.delBytes, temp: tp };
      var comps = plan.remove.filter(function (x) { return x.type === 'comp'; }).length, foots = plan.remove.length - comps;
      $('cleanInfo').innerHTML = 'Оставляю всё, что нужно композиции <b>' + esc(plan.root) + '</b>.<br>' +
        'Из проекта AE: <b>' + comps + '</b> композиций и <b>' + foots + '</b> секвенций · с диска: <b>' + d.del.length + '</b> папок (' + fmtB(d.delBytes) + ')' + tempLine(tp);
      var rows = plan.remove.map(function (x) {
        return '<div><span><span class="bad">AE</span> ' + (x.type === 'comp' ? '▣ ' : '▤ ') + esc(x.name) + '</span><span class="sz"></span></div>';
      }).concat(d.jobs.map(function (j) {
        var st = !j.keep ? '<span class="bad">диск</span>' : j.used ? '<span class="ok">нужна</span>' : '<span class="muted">не трогаю</span>';
        return '<div><span>' + st + ' ' + esc(j.name) + tempTag(tp, j) + '</span><span class="sz">' + fmtB(j.bytes) + '</span></div>';
      }));
      $('cleanList').innerHTML = rows.join('') || '<div class="muted">Нечего удалять.</div>';
      $('btnCleanRun').disabled = !(plan.remove.length || d.del.length || tp.list.length);
    });
  }
  function scanByCount() {
    var keep = Math.max(0, parseInt($('cleanupKeep').value, 10) || 0);
    var used = s.cleanupProtect
      ? A.callHost('LTXP', 'usedFootagePaths').then(function (r) { return r.paths || []; }).catch(function () { return null; })
      : Promise.resolve([]);
    return used.then(function (paths) {
      if (paths === null) { $('cleanInfo').innerHTML = '<span class="bad">Не удалось узнать, что лежит в проекте AE. Снимите галочку защиты или откройте проект.</span>'; return; }
      var r = C.scan(s.workDir, keep, paths);
      var tp = s.cleanTemp !== false ? C.planTemp(r.jobs.filter(function (j) { return r.del.indexOf(j) < 0; }), paths) : { list: [], bytes: 0 };
      cleanPlan = { mode: 'count', items: [], del: r.del, delBytes: r.delBytes, temp: tp };
      if (!r.jobs.length) { $('cleanInfo').textContent = 'В рабочей папке нет генераций: ' + s.workDir; return; }
      var usedN = r.jobs.filter(function (j) { return !j.keep && j.used; }).length;
      $('cleanInfo').innerHTML = 'Всего генераций: ' + r.jobs.length + ' · к удалению: <b>' + r.del.length + '</b> (' + fmtB(r.delBytes) + ')' +
        (usedN ? ' · ещё ' + usedN + ' старых не трогаю — они в открытом проекте' : '') + tempLine(tp);
      $('cleanList').innerHTML = r.jobs.map(function (j) {
        var st = j.keep ? '<span class="ok">оставить</span>' : j.used ? '<span class="muted">в проекте</span>' : '<span class="bad">удалить</span>';
        return '<div><span>' + st + ' ' + esc(j.name) + tempTag(tp, j) + '</span><span class="sz">' + fmtB(j.bytes) + '</span></div>';
      }).join('');
      $('btnCleanRun').disabled = !(r.del.length || tp.list.length);
    });
  }
  function cleanScan() {
    $('btnCleanRun').disabled = true; cleanPlan = null; $('cleanList').innerHTML = '';
    $('cleanInfo').textContent = 'Считаю…';
    return ((s.cleanMode || 'comp') === 'comp' ? scanByComp() : scanByCount())
      .catch(function (e) { $('cleanInfo').innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; });
  }
  $('cleanMode').onchange = function () { s.cleanMode = this.value; save(); cleanModeUI(); if (s.cleanMode === 'comp') loadComps(); };
  $('cleanOrphans').onchange = function () { s.cleanOrphans = this.checked; save(); $('btnCleanRun').disabled = true; cleanPlan = null; };
  $('cleanTemp').onchange = function () { s.cleanTemp = this.checked; save(); $('btnCleanRun').disabled = true; cleanPlan = null; };
  $('cleanRoot').onchange = function () { $('btnCleanRun').disabled = true; cleanPlan = null; };
  $('btnCleanComps').onclick = loadComps;
  $('btnCleanScan').onclick = cleanScan;
  $('btnCleanRun').onclick = function () {
    var P = cleanPlan; if (!P) return;
    var msg = P.mode === 'comp'
      ? 'Удалить из проекта AE ' + P.items.length + ' элементов Zouwu Forge и с диска ' + P.del.length + ' папок (' + fmtB(P.delBytes) + ')' +
        (P.temp.list.length ? ' + промежуточные файлы ' + fmtB(P.temp.bytes) : '') + '?\n\nИз проекта можно вернуть через Ctrl+Z, файлы с диска — нет.'
      : 'Удалить ' + P.del.length + ' старых генераций (' + fmtB(P.delBytes) + ')' +
        (P.temp.list.length ? ' + промежуточные файлы ' + fmtB(P.temp.bytes) : '') + '?\n\nЕсли эти файлы используются в других проектах AE, там они станут «missing».';
    if (!confirm(msg)) return;
    $('btnCleanRun').disabled = true;
    var step = P.items.length ? A.callHost('LTXP', 'removeItems', { ids: P.items.map(function (x) { return x.id; }) }) : Promise.resolve({ removed: 0 });
    step.then(function (ae) {
      var res = C.remove(P.del), tr = C.removeTemp(P.temp.list);
      res.failed = res.failed.concat(tr.failed);
      return cleanScan().then(function () {
        $('cleanInfo').innerHTML = '<span class="ok">Готово: из проекта убрано ' + (ae.removed || 0) + ', с диска удалено папок ' + res.removed + (tr.trimmed ? ', почищено промежуточных: ' + tr.trimmed + ' (' + fmtB(P.temp.bytes) + ')' : '') + '</span>' +
          (res.failed.length ? '<br><span class="bad">Не удалось: ' + esc(res.failed.join('; ')) + '</span>' : '') + '<br>' + $('cleanInfo').innerHTML;
      });
    }).catch(function (e) { $('cleanInfo').innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; });
  };
  cleanModeUI();
  loadComps();

  renderTools();
  loadTemplates();
  toUI();
  bind();
  poll();
  setInterval(poll, 1500);
  setInterval(renderFiles, 15000);
})();
