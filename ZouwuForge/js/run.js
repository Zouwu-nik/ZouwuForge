/* Zouwu Forge — окно «Инструменты»: кадры из композиции → LTX 2.5 IC-LoRA → новая композиция */
(function () {
  'use strict';
  var A = window.AIPost, T = window.LTXTools, store = window.LTXStore;
  var fs = A.fs, path = A.path;
  var $ = function (id) { return document.getElementById(id); };
  var s = store.load();
  var comp = null, job = null, comfy = null, installed = null;

  /* ---------- общий UI ---------- */
  function log(msg, cls) {
    var el = $('log'), line = '[' + new Date().toLocaleTimeString() + '] ' + msg + '\n';
    el.textContent += line;
    if (el.textContent.length > 200000) el.textContent = el.textContent.slice(-150000);
    el.scrollTop = el.scrollHeight;
    // копия лога на диск — её можно прислать при проблеме: %APPDATA%\ZouwuForge\run.log
    try { require('fs').appendFileSync(require('path').join(A.APPDIR, 'run.log'), line); } catch (e) {}
    if (cls) stage(msg, cls);
  }
  // stage — смена этапа: во время прогона пишется в лог и запускает счётчик времени этапа
  var stageMsg = '', stageT0 = 0, stageIv = null;
  function stage(msg, cls) {
    stageLive(msg, cls);
    if (job && msg !== stageMsg && !cls) {
      if (stageMsg && stageT0) { var took = (Date.now() - stageT0) / 1000; if (took >= 2) log('  (этап занял ' + A.fmtTime(took) + ')'); }
      log('● ' + msg);
    }
    if (job && msg !== stageMsg && !cls) $('eta').textContent = '';
    stageMsg = msg; stageT0 = Date.now();
    if (job && !stageIv) stageIv = setInterval(function () {
      if (!job) { clearInterval(stageIv); stageIv = null; return; }
      if (liveTracker) return;
      var sec = (Date.now() - stageT0) / 1000;
      var cur = $('eta').textContent;
      if (cur && !/^Этап идёт/.test(cur) && stageT0 < etaAt) return;   // строку занял более точный прогресс этапа
      if (sec >= 3) $('eta').textContent = 'Этап идёт ' + A.fmtTime(sec) + (/After Effects/.test(stageMsg) ? ' — AE рендерит кадры, панель оживёт после рендера' : '');
    }, 1000);
  }
  function stageLive(msg, cls) { var el = $('stage'); el.textContent = msg; el.className = 'status ' + (cls || ''); }
  var liveTracker = null, etaAt = 0;
  function progress(f) { $('bar').style.width = Math.max(0, Math.min(100, f * 100)).toFixed(1) + '%'; }
  function save() { try { store.save(s); } catch (e) {} }

  // Хватит ли места под результат: need — сколько ещё будет записано (байты)
  function checkSpace(dir, need, what) {
    var free = A.freeBytes(dir);
    if (free === null) return;
    var drive = path.parse(path.resolve(dir)).root;
    log('Место на диске ' + drive + ': свободно ' + (free / 1073741824).toFixed(1) + ' ГБ, нужно ~' + (need / 1073741824).toFixed(1) + ' ГБ (' + what + ')');
    if (free < need) throw new Error('Не хватит места на диске ' + drive + ': свободно ' + (free / 1073741824).toFixed(1) + ' ГБ, а ' + what + ' займёт около ' + (need / 1073741824).toFixed(1) + ' ГБ. ' + SPACE_TIP);
  }
  var SPACE_TIP = 'Освободите место (Настройки → «Очистка» удаляет старые генерации), уменьшите диапазон кадров или перенесите рабочую папку на другой диск (Настройки → «Рабочая папка»).';

  /* ---------- подробный прогресс генерации ----------
     Следит за узлами графа ComfyUI: какой этап идёт, сколько длится, шаги семплера.
     Полоса двигается по весам этапов (загрузка моделей, кодирование, генерация, апскейл, декодирование),
     а в лог идут строки самого движка (engine.log): загрузка моделей, нехватка памяти, предупреждения. */
  var NODE_INFO = [
    [/^(UNETLoader|UnetLoaderGGUF)$/, 'Загрузка модели LTX', 6],
    [/LoRALoader|LoraLoader/, 'Подключение LoRA', 1],
    [/^CLIPLoader/, 'Загрузка текстового энкодера', 4],
    [/^CLIPTextEncode$/, 'Кодирование промта', 3],
    [/^VAELoader$|UpscaleModelLoader/, 'Загрузка VAE / апскейлера', 1],
    [/^VHS_LoadImagesPath$|^LoadImage$/, 'Чтение кадров', 2],
    [/^ImageScale$|Preprocess|^Canny$|Mask/, 'Подготовка кадров', 1],
    [/^VAEEncode/, 'Кодирование кадров в латент', 6],
    [/Guide|ImgToVideo/, 'Подготовка опоры (кодирование кадров)', 4],
    [/^SamplerCustomAdvanced$|^KSampler/, 'Генерация', 30],
    [/LatentUpsampler/, 'Апскейл латента ×2', 3],
    [/^VAEDecode/, 'Декодирование кадров', 10],
    [/^(PreviewImage|SaveImage)$/, 'Сохранение кадров', 2]
  ];
  function nodeInfo(cls) {
    for (var i = 0; i < NODE_INFO.length; i++) if (NODE_INFO[i][0].test(cls)) return { label: NODE_INFO[i][1], w: NODE_INFO[i][2] };
    return { label: cls, w: 0.3 };
  }
  // graph — граф ComfyUI; onFrac(0..1) — доля готовности этого графа; title — префикс для строки статуса
  function makeTracker(graph, title, onFrac) {
    var ids = Object.keys(graph), total = 0, done = {}, doneW = 0, cur = null, curStart = 0, step = null, samplerN = 0;
    var info = {};
    ids.forEach(function (id) { info[id] = nodeInfo(graph[id].class_type); total += info[id].w; });
    var t0 = Date.now();
    function frac() {
      var f = doneW;
      if (cur && info[cur] && step && step.max) f += info[cur].w * Math.min(1, step.value / step.max);
      return total ? Math.min(1, f / total) : 0;
    }
    function markDone(id) { if (!id || done[id] || !info[id]) return; done[id] = 1; doneW += info[id].w; }
    function label() {
      if (!cur || !info[cur]) return title + (doneW ? ': завершение…' : ': запуск…');
      var l = info[cur].label;
      if (/^Генерация$/.test(l)) l = 'Генерация' + (samplerN > 1 ? ' (проход ' + samplerN + ')' : '');
      return title + ': ' + l + (step && step.max ? ' — шаг ' + step.value + '/' + step.max : '') +
        ' · ' + A.fmtTime((Date.now() - curStart) / 1000);
    }
    liveTracker = true;
    var hb = setInterval(function () { stageLive(label()); onFrac(frac()); }, 1000);
    return {
      onEvent: function (type, d) {
        if (type === 'execution_cached') { (d.nodes || []).forEach(markDone); onFrac(frac()); return; }
        if (type === 'executed') { markDone(d.node); return; }
        if (type !== 'executing') return;
        if (cur && cur !== d.node) {
          markDone(cur);
          var took = (Date.now() - curStart) / 1000;
          if (took >= 1) log('  ✓ ' + info[cur].label + ' — ' + A.fmtTime(took));
        }
        cur = d.node; curStart = Date.now(); step = null;
        if (cur && info[cur]) {
          if (/^Генерация$/.test(info[cur].label)) samplerN++;
          log('  ▶ ' + (info[cur].label === 'Генерация' && samplerN > 1 ? 'Генерация (проход ' + samplerN + ')' : info[cur].label) +
            ' [' + graph[cur].class_type + ']');
        }
        stageLive(label()); onFrac(frac());
      },
      onProgress: function (v, m, node) {
        if (node && node !== cur) { cur = node; curStart = curStart || Date.now(); }
        step = { value: v, max: m }; onFrac(frac());
      },
      stop: function () { clearInterval(hb); liveTracker = null; if (cur && info[cur]) markDone(cur); log('  Граф выполнен за ' + A.fmtTime((Date.now() - t0) / 1000)); }
    };
  }

  // Хвост engine.log: новые строки движка → в лог панели, полосы tqdm → в строку под прогрессом
  function tailEngine() {
    var fs = require('fs'), file = require('path').join(A.APPDIR, 'engine.log');
    var pos = 0, rest = '';
    try { pos = fs.statSync(file).size; } catch (e) { pos = 0; }
    var iv = setInterval(function () {
      try {
        var size = fs.statSync(file).size;
        if (size < pos) pos = 0;               // движок перезапустился и начал лог заново
        if (size === pos) return;
        var fd = fs.openSync(file, 'r'), len = Math.min(size - pos, 262144), buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, pos); fs.closeSync(fd); pos += len;
        var parts = (rest + buf.toString('utf8')).split(/\r\n|\n|\r/); rest = parts.pop();
        parts.forEach(function (l) {
          l = l.trim(); if (!l) return;
          if (/\d+%\|/.test(l) || /it\/s\]|s\/it\]/.test(l)) { $('engLine').textContent = 'движок: ' + l.slice(-120); return; }
          if (/^got prompt$|^Prompt executed/.test(l)) return;
          log('  движок: ' + l.slice(0, 400), /error|out of memory|Traceback/i.test(l) ? 'bad' : undefined);
        });
        if (rest && /\d+%\|/.test(rest)) $('engLine').textContent = 'движок: ' + rest.trim().slice(-120);
      } catch (e) {}
    }, 1000);
    return function () { clearInterval(iv); try { $('engLine').textContent = ''; } catch (e) {} };
  }
  // Флаг «идёт генерация»: пока он есть, сторож движка ничего не проверяет
  var BUSY_FILE = require('path').join(A.APPDIR, 'busy.flag');
  function busyFlag(on) {
    var fs = require('fs');
    try { if (on) fs.writeFileSync(BUSY_FILE, String(Date.now())); else if (fs.existsSync(BUSY_FILE)) fs.unlinkSync(BUSY_FILE); } catch (e) {}
  }
  function busy(on) {
    busyFlag(on);
    $('btnRun').disabled = on; $('btnStop').disabled = !on; $('btnRefresh').disabled = on;
    Array.prototype.forEach.call(document.querySelectorAll('input,select,textarea'), function (i) { i.disabled = on; });
  }
  // Для апскейлера ×2 референс берём в половину рабочего разрешения — память та же, что у других инструментов
  function singlePass(t) { return !!t.singleStage || T.isEditMode(t, fieldsOf(t)); }
  function shortSide(cw, ch) { return T.resolveShort(cw, ch, s.resMode || 'preset', s.outSide, s.customSide); }
  function sizes(t, cw, ch) { var ed = T.isEditMode(t, fieldsOf(t)); return T.stageSizes(cw, ch, shortSide(cw, ch), !!s.stage2, ed ? 'v2v' : t.kind, ed ? 1 : t.refDown); }
  function tool() { return T.toolById(s.tool) || T.TOOLS[0]; }
  function fieldsOf(t) { s.fieldsByTool[t.id] = s.fieldsByTool[t.id] || {}; return s.fieldsByTool[t.id]; }

  /* ---------- список инструментов ---------- */
  function renderToolSelect() {
    var sel = $('tool'); sel.innerHTML = '';
    var groups = {};
    T.TOOLS.forEach(function (t) {
      if (!groups[t.group]) { groups[t.group] = document.createElement('optgroup'); groups[t.group].label = t.group; sel.appendChild(groups[t.group]); }
      var o = document.createElement('option');
      o.value = t.id;
      var miss = t.kind === 'dlss' ? !window.LTXDlss.appStatus().ok : (t.kind !== 'prompt' && t.kind !== 'i2v' && installed && installed.loras.indexOf(t.lora) < 0);
      o.textContent = t.label + (miss ? (t.kind === 'dlss' ? '  (скачается при запуске)' : '  (не установлен)') : '');
      groups[t.group].appendChild(o);
    });
    sel.value = s.tool;
  }

  /* ---------- динамическая форма ---------- */
  function visible(fd, vals) {
    if (!fd.showIf) return true;
    for (var k in fd.showIf) {
      var cv = vals[k] !== undefined ? vals[k] : defVal(k), want = fd.showIf[k];
      if (Array.isArray(want) ? want.indexOf(cv) < 0 : cv !== want) return false;
    }
    return true;
  }
  function defVal(key) {
    var t = tool();
    for (var i = 0; i < t.fields.length; i++) if (t.fields[i].key === key) return t.fields[i].value;
    return undefined;
  }

  function renderFields() {
    var t = tool(), vals = fieldsOf(t), box = $('fields');
    box.innerHTML = '';
    $('hint').textContent = t.hint;
    t.fields.forEach(function (fd) {
      if (vals[fd.key] === undefined && fd.value !== undefined) vals[fd.key] = fd.value;
      // сохранённое значение списка, которого больше нет в вариантах (после обновления плагина) → по умолчанию
      if (fd.type === 'select' && fd.options && !fd.options.some(function (o) { return String(o[0]) === String(vals[fd.key]); }))
        vals[fd.key] = fd.value !== undefined ? fd.value : fd.options[0][0];
      if (!visible(fd, vals)) return;
      var wrap = document.createElement('div'); wrap.className = 'field';
      var lbl = document.createElement('span'); lbl.className = 'lbl' + (fd.required ? ' req' : ''); lbl.textContent = fd.label;
      var el;
      if (fd.type === 'area') { el = document.createElement('textarea'); el.placeholder = fd.placeholder || ''; el.value = vals[fd.key] || ''; }
      else if (fd.type === 'select' || fd.type === 'layer') {
        el = document.createElement('select');
        var opts = fd.type === 'layer'
          ? (comp ? comp.layers.map(function (L) { return [String(L.index), L.index + '. ' + L.name + (L.hasMask ? '  [маска]' : '')]; }) : [])
          : fd.options;
        if (fd.type === 'layer' && !opts.length) opts = [['', '— нет слоёв —']];
        opts.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; el.appendChild(op); });
        if (fd.type === 'layer' && !opts.some(function (o) { return o[0] === String(vals[fd.key]); })) vals[fd.key] = opts[0][0];
        if (vals[fd.key] !== undefined) el.value = String(vals[fd.key]);
      } else if (fd.type === 'check') {
        var c = document.createElement('label'); c.className = 'check';
        el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!vals[fd.key];
        c.appendChild(el); c.appendChild(document.createTextNode(fd.label));
        wrap.appendChild(c);
      } else if (fd.type === 'range') {
        var row = document.createElement('div'); row.className = 'ctl';
        el = document.createElement('input'); el.type = 'range'; el.min = fd.min; el.max = fd.max; el.step = fd.step; el.value = vals[fd.key];
        var v = document.createElement('span'); v.className = 'val'; var dig = Number(fd.step) < 0.1 ? 2 : 1;
        v.textContent = Number(el.value).toFixed(dig);
        el.addEventListener('input', function () { v.textContent = Number(el.value).toFixed(dig); });
        row.appendChild(el); row.appendChild(v);
        wrap.appendChild(lbl); wrap.appendChild(row); lbl = null;
      } else {
        el = document.createElement('input'); el.type = fd.type === 'number' ? 'number' : 'text';
        if (fd.type === 'number') { el.min = fd.min; el.max = fd.max; el.step = fd.step; el.style.width = '90px'; }
        el.placeholder = fd.placeholder || ''; el.value = vals[fd.key] !== undefined ? vals[fd.key] : '';
      }
      if (fd.ai && (fd.type === 'area' || fd.type === 'text')) {   // кнопки помощника у текстовых полей
        var row0 = document.createElement('div'); row0.className = 'lblrow';
        var bx = document.createElement('div'); bx.className = 'aibtns';
        var bD = document.createElement('button'); bD.textContent = fd.ai === 'comp' ? '✨ Анализ' : '✨ Описать';
        bD.title = fd.ai === 'comp' ? 'Помощник посмотрит на кадр, опишет сцену и подберёт настройки' : 'Помощник посмотрит на текущий кадр и заполнит поле';
        var bU = document.createElement('button'); bU.textContent = '✎ Улучшить';
        bU.title = 'Помощник перепишет ваш текст (можно по-русски) в промт для модели';
        bD.onclick = function () { aiFill(t, fd, el, 'describe', bD); };
        bU.onclick = function () { aiFill(t, fd, el, 'improve', bU); };
        bx.appendChild(bD); bx.appendChild(bU);
        row0.appendChild(lbl); row0.appendChild(bx);
        wrap.appendChild(row0); wrap.appendChild(el);
        lbl = null;
      }
      if (fd.type !== 'check') { if (lbl) wrap.appendChild(lbl); if (fd.type !== 'range' && !(fd.ai && (fd.type === 'area' || fd.type === 'text'))) wrap.appendChild(el); }
      el.addEventListener(fd.type === 'check' || fd.type === 'select' || fd.type === 'layer' ? 'change' : 'input', function () {
        var nv = fd.type === 'check' ? el.checked : (fd.type === 'number' || fd.type === 'range' ? Number(el.value) : el.value);
        vals[fd.key] = nv; save();
        if (t.fields.some(function (x) { return x.showIf && x.showIf.hasOwnProperty(fd.key); })) renderFields();
        updateInfo();
      });
      box.appendChild(wrap);
    });
    if (!t.fields.length) box.innerHTML = '<div class="small muted">Дополнительных вводных не нужно.</div>';

    var isD = t.kind === 'dlss';
    $('strengthRow').classList.toggle('hidden', isD || t.kind === 'i2v');
    $('stage2Card').classList.toggle('hidden', isD);
    if (isD) {
      var d = s.dlss || {}, P = window.LTXDlss.PRESETS[d.preset], up = window.LTXDlss.UPSCALE.filter(function (u) { return u[0] === String(d.factor); })[0];
      box.innerHTML = '<div class="field"><span class="lbl">Пресет DLSS 5</span><select id="dlssPreset"></select></div>' +
        '<div class="kv small">' +
        '<span>Апскейл</span><span>' + (up ? up[1] : d.factor + '×') + '</span>' +
        '<span>Стиль</span><span>' + d.nr_style + '</span>' +
        '<span>Интенс. / структура</span><span>' + Number(d.nr_intensity).toFixed(2) + ' / ' + Number(d.local_structure_strength).toFixed(2) + '</span>' +
        '<span>Кожа</span><span>' + (Number(d.skin_structure_strength) < 0 ? 'авто' : Number(d.skin_structure_strength).toFixed(2)) + '</span>' +
        '<span>Сборка DLSS 5</span><span>' + (window.LTXDlss.appStatus().ok ? '<span class="ok">установлена</span>' : '<span class="warn">скачается при первом запуске (~450 МБ)</span>') + '</span>' +
        '</div><div class="small" style="margin-top:6px"><a id="lnkDlss">Тонкая настройка DLSS 5</a></div>';
      $('lnkDlss').onclick = function () { A.openExtension(window.LTX_IDS.SETTINGS); };
      var ps = $('dlssPreset');
      Object.keys(window.LTXDlss.PRESETS).forEach(function (k) {
        var o = document.createElement('option'); o.value = k; o.textContent = window.LTXDlss.PRESETS[k].label; ps.appendChild(o);
      });
      ps.value = d.preset || 'custom';
      ps.addEventListener('change', function () {
        var pr = window.LTXDlss.PRESETS[this.value];
        s.dlss = Object.assign({}, window.LTXDefaults.dlss, s.dlss || {}, { preset: this.value });
        if (pr && pr.v) Object.keys(pr.v).forEach(function (k) { s.dlss[k] = pr.v[k]; });
        save(); renderFields();
      });
      $('outModeRow').classList.add('hidden');
      updateInfo();
      return;
    }
    var st = s.strengthByTool[t.id] !== undefined ? s.strengthByTool[t.id] : t.strength;
    $('strength').value = st; $('strength').nextElementSibling.textContent = Number(st).toFixed(2);
    if (t.outputModes) {
      $('outModeRow').classList.remove('hidden');
      var om = $('outMode'); om.innerHTML = '';
      t.outputModes.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; om.appendChild(op); });
      om.value = s.outModeByTool[t.id] || t.outputModes[0][0];
    } else $('outModeRow').classList.add('hidden');
    updateInfo();
  }

  /* ---------- композиция ---------- */
  function rangeFrames() {
    if (!comp) return null;
    switch (s.range) {
      case 'comp': return [comp.displayStartFrame, comp.displayStartFrame + comp.frames - 1];
      case 'selected': return comp.selCount ? [comp.selStart, comp.selEnd] : null;
      case 'custom': return [Number(s.customStart), Number(s.customEnd)];
      default: return [comp.workStart, comp.workEnd];
    }
  }
  function updateInfo() {
    try {
      var t0 = tool(), single = singlePass(t0);
      $('stage2').disabled = single || !!job; $('anchorRun').disabled = single || !s.stage2 || !!job;
      $('stage2Card').title = single ? 'Для этого инструмента Lightricks рекомендует один проход в полном разрешении — апскейлер не используется' : '';
      $('stage2Card').classList.toggle('dim', single);
    } catch (eS) {}
    var r = rangeFrames(), n = r ? Math.max(0, r[1] - r[0] + 1) : 0, t = tool();
    $('btnRun').textContent = n ? '▶ Запустить (' + n + ' кадр.)' : '▶ Запустить';
    $('customRow').classList.toggle('hidden', s.range !== 'custom');
    if (comp && n) {
      var cw = comp.width, ch = comp.height, f = fieldsOf(t);
      if (t.kind === 'inpaint' && f.mode === 'outpaint') {
        cw = Math.round(cw * (1 + ((f.padL || 0) + (f.padR || 0)) / 100));
        ch = Math.round(ch * (1 + ((f.padT || 0) + (f.padB || 0)) / 100));
      }
      if (t.kind === 'i2v') {
        var fv = fieldsOf(t), fpsI = Math.min(comp.fps, 30), lenI = i2vLen(fv.seconds, fpsI), wsI = sizes(t, comp.width, comp.height);
        $('sizeInfo').innerHTML = 'Клип ' + lenI + ' кадр. (' + (lenI / fpsI).toFixed(1) + ' с при ' + Math.round(fpsI) + ' fps), ' +
          (s.stage2 ? wsI.W + '×' + wsI.H + ' → апскейлер ×2 → <b>' + wsI.outW + '×' + wsI.outH + '</b>' : '<b>' + wsI.W + '×' + wsI.H + '</b> <span class="warn">(без апскейлера)</span>') +
          '<br>Стартовый кадр: ' + (fv.frameSrc === 'first' ? 'первый кадр диапазона' : 'под плейхедом (' + comp.curFrame + ')');
        return;
      }
      if (t.kind === 'dlss') {
        var fct = Number((s.dlss || {}).factor) || 1;
        $('sizeInfo').innerHTML = 'DLSS 5: ' + cw + '×' + ch + (fct > 1 ? ' → <b>' + Math.round(cw * fct / 2) * 2 + '×' + Math.round(ch * fct / 2) * 2 + '</b>' : ' (без апскейла)');
        return;
      }
      if (t.kind === 'camxfer') {
        var wc = sizes(t, cw, ch);
        $('sizeInfo').innerHTML = 'Картинка — кадр композиции, длина клипа — по слою-образцу (до 121 кадра).<br>' +
          (s.stage2 ? '1-й проход ' + wc.W + '×' + wc.H + ' → апскейлер ×2 → <b>' + wc.outW + '×' + wc.outH + '</b>' : 'Один проход <b>' + wc.W + '×' + wc.H + '</b>') +
          (Math.min(wc.W, wc.H) < 512 ? ' <span class="warn">— для точного повтора камеры поставьте разрешение 1088</span>' : '');
        return;
      }
      var ws = sizes(t, cw, ch);
      var chunks = T.planChunks(n, Math.min(s.chunkLen, t.maxFrames || 1e9));
      var orient = 'Композиция ' + cw + '×' + ch + ' (' + T.aspectLabel(cw, ch) + ') → результат ' + T.aspectLabel(ws.outW, ws.outH) + '<br>';
      var fvS = fieldsOf(t);
      $('sizeInfo').innerHTML = orient + (s.stage2 && singlePass(t)
        ? 'Один проход в полном разрешении <b>' + ws.outW + '×' + ws.outH + '</b> — ' + (T.isEditMode(t, fvS) ? 'как в воркфлоу автора LoRA' : 'Lightricks рекомендует этот инструмент без апскейлера')
        : s.stage2 && T.restyleDirect(t, fvS)
        ? 'Перерисовка одним проходом в полном разрешении <b>' + ws.outW + '×' + ws.outH + '</b>'
        : s.stage2
        ? '1-й проход ' + ws.W + '×' + ws.H + ' → апскейлер ×2 → <b>' + ws.outW + '×' + ws.outH + '</b>'
        : 'Один проход <b>' + ws.W + '×' + ws.H + '</b> <span class="warn">(без апскейлера)</span>') +
        '<br>Частей: ' + chunks.length + ' по ≤' + chunks[0].len + ' кадр.';
    } else $('sizeInfo').textContent = '';
  }
  function refreshComp() {
    return A.callHost('LTXP', 'getCompInfo').then(function (c) {
      comp = c;
      $('compInfo').innerHTML =
        '<span>Имя</span><span>' + c.name + '</span>' +
        '<span>Размер</span><span>' + c.width + '×' + c.height + ', ' + (+c.fps).toFixed(3).replace(/\.?0+$/, '') + ' fps</span>' +
        '<span>Длина</span><span>' + c.frames + ' кадров</span>';
      $('rWork').textContent = '(' + c.workStart + '–' + c.workEnd + ')';
      $('rComp').textContent = '(' + c.displayStartFrame + '–' + (c.displayStartFrame + c.frames - 1) + ')';
      $('rSel').textContent = c.selCount ? '(' + c.selStart + '–' + c.selEnd + ')' : '(нет выделения)';
      if (s.range !== 'custom' || !s.customEnd) { $('customStart').value = s.customStart = c.workStart; $('customEnd').value = s.customEnd = c.workEnd; }
      renderFields();
    }).catch(function (e) {
      comp = null;
      $('compInfo').innerHTML = '<span>—</span><span class="muted">' + e.message + '</span>';
      updateInfo();
    });
  }

  /* ---------- что установлено в движке ---------- */
  function inspectEngine(info) {
    function opts(cls, key) {
      var d = info[cls]; if (!d) return [];
      var spec = (d.input.required || {})[key] || (d.input.optional || {})[key];
      if (!spec) return [];
      return Array.isArray(spec[0]) ? spec[0] : ((spec[1] && spec[1].options) || []);
    }
    return {
      loras: opts('LTXICLoRALoaderModelOnly', 'lora_name'),
      unets: opts('UNETLoader', 'unet_name').concat(opts('UnetLoaderGGUF', 'unet_name')),
      ups: opts('LatentUpscaleModelLoader', 'model_name'), hasGGUF: !!info.UnetLoaderGGUF,
      clips: opts('CLIPLoader', 'clip_name'),
      vaes: opts('VAELoader', 'vae_name'),
      embeds: opts('LTXVLoadConditioning', 'file_name'),
      hasLTX: !!info.LTXAddVideoICLoRAGuide, hasVHS: !!info.VHS_LoadImagesPath, hasI2VCond: !!info.LTXVImgToVideoConditionOnly
    };
  }
  function i2vLen(sec, fps) { var n = Math.max(9, Math.round((Number(sec) || 5) * fps)); return Math.ceil((n - 1) / 8) * 8 + 1; }
  function checkInstalled(t) {
    var miss = [];
    if (!installed.hasLTX) miss.push('ноды ComfyUI-LTXVideo');
    if (!installed.hasVHS) miss.push('ноды VideoHelperSuite');
    var M = window.LTXCurrentModels(s);
    if (M.loader === 'gguf' && !installed.hasGGUF) miss.push('ноды ComfyUI-GGUF');
    if (installed.unets.indexOf(M.unet) < 0) miss.push(M.unet);
    if (t.kind !== 'hdr' && installed.clips.indexOf(M.clip) < 0) miss.push(M.clip);
    [M.vae, M.audioVae].forEach(function (v) { if (installed.vaes.indexOf(v) < 0) miss.push(v); });
    if (s.stage2 && installed.ups.indexOf(M.upscaler) < 0) miss.push(M.upscaler);
    var pm = fieldsOf(t).mode || 'restyle';
    var restyleOnly = t.kind === 'prompt' && pm !== 'structure';
    if (t.kind === 'prompt' && T.EDIT_LORAS[pm] && installed.loras.indexOf(T.EDIT_LORAS[pm]) < 0) miss.push(T.EDIT_LORAS[pm]);
    if (t.kind === 'i2v') {
      var camL = T.cameraLoraFor(fieldsOf(t));
      if (camL && installed.loras.indexOf(camL) < 0) miss.push(camL);
    } else if (!restyleOnly && installed.loras.indexOf(t.lora) < 0) miss.push(t.lora);
    if (t.embeddings && installed.embeds.indexOf(t.embeddings) < 0) miss.push(t.embeddings);
    return miss;
  }


  // AE не всегда даёт переключить вывод на PNG — приводим видео/TIFF к PNG-секвенции
  async function normalizeFrames(info, dir, prefix) {
    if (!info || (!info.video && info.ext === 'png')) return;
    var e = A.readEngine();
    if (info.fmtLog) log('Формат вывода AE: ' + info.fmtLog);
    log(info.video ? 'AE отрендерил видео вместо кадров — раскладываю на PNG…' : 'Перевожу ' + String(info.ext).toUpperCase() + ' в PNG…');
    await A.runProcess(e.python, ['-s', path.join(pluginDir(), 'py', 'to_png.py'), info.video || dir, dir, prefix],
      { cwd: path.dirname(e.main), env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) }, function (l) { if (/^ERROR/.test(l)) log(l, 'bad'); });
  }
  async function fitFrames(dir, w, h) {
    var e = A.readEngine();
    await A.runProcess(e.python, ['-s', path.join(pluginDir(), 'py', 'fit_frames.py'), dir, String(w), String(h)],
      { cwd: path.dirname(e.main), env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) },
      function (l) {
        var m = /^PROGRESS (\d+) (\d+)/.exec(l);
        if (m) { etaAt = Date.now(); $('eta').textContent = 'Уменьшаю кадры: ' + m[1] + ' из ' + m[2] + ' (' + Math.round(100 * m[1] / m[2]) + '%)'; return; }
        if (/^ERROR/.test(l)) log(l, 'bad'); else if (/^RESULT/.test(l)) log('Кадры: ' + l.replace(/^RESULT /, ''));
      });
  }
  function pluginDir() { return path.dirname(decodeURIComponent(window.location.pathname).replace(/^\/([A-Za-z]:)/, '$1')); }

  /* ---------- прогон ---------- */
  function prepChunkDir(files, srcDir, dir, ch) {
    fs.mkdirSync(dir, { recursive: true });
    for (var i = 0; i < ch.len; i++) {
      var src = files[ch.start + Math.min(i, ch.take - 1)];
      A.linkOrCopy(path.join(srcDir, src), path.join(dir, 'f_' + A.pad(i, 5) + '.png'));
    }
  }

  async function run() {
    if (job) return;
    var t = tool(), f = fieldsOf(t);
    for (var i = 0; i < t.fields.length; i++) {
      var fd = t.fields[i];
      if (fd.required && visible(fd, f) && !String(f[fd.key] || '').trim()) { stage('Заполните поле «' + fd.label + '»', 'bad'); return; }
    }
    if (t.kind === 'inpaint' && (f.mode || 'inpaint') === 'inpaint' && !f.maskLayer) { stage('Выберите слой-маску', 'bad'); return; }
    if (t.kind === 'camxfer' && !f.refLayer) { stage('Выберите слой с видео-образцом движения камеры', 'bad'); return; }
    if (t.kind === 'prompt' && f.mode === 'replace') {
      if (!f.maskLayer) { stage('Выберите слой-маску: что заменить', 'bad'); return; }
      if (!f.refLayer) { stage('Выберите слой-образец: на что заменить', 'bad'); return; }
      if (String(f.maskLayer) === String(f.refLayer)) { stage('Маска и образец должны быть разными слоями', 'bad'); return; }
    }

    s = Object.assign(store.load(), { tool: s.tool, fieldsByTool: s.fieldsByTool, strengthByTool: s.strengthByTool, outModeByTool: s.outModeByTool, range: s.range, customStart: s.customStart, customEnd: s.customEnd, addToSource: s.addToSource, stage2: s.stage2, anchor: s.anchor, detail: s.detail, resMode: s.resMode, outSide: s.outSide, customSide: s.customSide });
    save();
    $('log').textContent = ''; progress(0); $('eta').textContent = '';
    job = { cancelled: false, t0: Date.now() };
    busy(true);
    if (window.LTXLlm) window.LTXLlm.stop();   // помощник освобождает видеопамять для генерации
    var jobDir;
    try {
      await refreshComp();
      if (!comp) throw new Error('Нет активной композиции.');

      if (t.kind === 'dlss') { await runDlssTool(t); return; }

      // 1. Движок
      stage('Проверяю движок…');
      comfy = new A.Comfy(A.engineUrl());
      await A.ensureEngine(comfy, log, job, window.LTXEngineArgs(s));
      installed = inspectEngine(await comfy.objectInfo());
      renderToolSelect();
      var miss = checkInstalled(t);
      if (miss.length) throw new Error('Для «' + t.label + '» не хватает:\n• ' + miss.join('\n• ') + '\nОткройте «Zouwu Forge — Настройки» → «Модели» → «Установить / докачать».');
      if (t.kind === 'i2v') { await runI2V(t, f); return; }
      if (t.kind === 'camxfer') { await runCamXfer(t, f); return; }

      // 2. Кадры из AE
      jobDir = path.join(s.workDir, A.safeName(comp.name) + '_' + t.id + '_' + A.stamp());
      var srcDir = path.join(jobDir, 'src'), maskDir = path.join(jobDir, 'mask'), outDir = path.join(jobDir, 'out');
      fs.mkdirSync(outDir, { recursive: true });
      var mode = 'plain';
      if (t.kind === 'inpaint') mode = (f.mode === 'outpaint') ? 'outpaint' : 'mask';
      var replaceMode = t.kind === 'prompt' && f.mode === 'replace';
      if (replaceMode) mode = 'mask';
      var rfN = rangeFrames(), nPre = rfN ? rfN[1] - rfN[0] + 1 : 0;
      if (nPre && comp) checkSpace(srcDir, comp.width * comp.height * 2 * nPre * (mode === 'plain' ? 1 : 1.3) + 1073741824, 'кадры из AE (' + nPre + ' шт.)');
      stage('Рендер кадров в After Effects… (AE на время замрёт)');
      await A.sleep(80);
      var rr = await A.callHost('LTXP', 'renderInputs', {
        range: s.range, customStart: s.customStart, customEnd: s.customEnd, srcDir: srcDir, maskDir: maskDir,
        omTemplate: s.omTemplate, mode: mode, maskLayer: Number(f.maskLayer), hideLayers: replaceMode ? [Number(f.maskLayer), Number(f.refLayer)] : [],
        pads: { l: f.padL || 0, r: f.padR || 0, t: f.padT || 0, b: f.padB || 0 }
      });
      if (job.cancelled) throw new Error('Остановлено пользователем');
      await normalizeFrames(rr.src, srcDir, 'src');
      if (mode !== 'plain') await normalizeFrames(rr.mask, maskDir, 'mask');
      var files = A.listImages(srcDir, /\.png$/i), mfiles = mode !== 'plain' ? A.listImages(maskDir, /\.png$/i) : null, N = files.length;
      if (!N) throw new Error('Нет кадров для обработки в ' + srcDir);
      log('Кадров из AE: ' + N + (mfiles ? ', маска: ' + mfiles.length : ''));
      checkSpace(outDir, A.dirBytes(srcDir) * (t.kind === 'hdr' ? 4 : 1.6) + 2147483648, 'генерация ' + N + ' кадр.');
      progress(0.04);

      // 2б. Relight: рисуем шар направления света (один на весь прогон)
      var ballDir = '';
      if (t.kind === 'relight') {
        ballDir = path.join(jobDir, 'ball'); fs.mkdirSync(ballDir, { recursive: true });
        var rp = T.relightParams(f);
        var eb = A.readEngine();
        await A.runProcess(eb.python, ['-s', path.join(pluginDir(), 'py', 'relight_ball.py'), path.join(ballDir, 'ball.png'), String(rp.az), String(rp.el), '512'],
          { cwd: path.dirname(eb.main), env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) }, function (l) { if (/^(ERROR|Traceback)/.test(l)) log(l, 'bad'); });
        if (!fs.existsSync(path.join(ballDir, 'ball.png'))) throw new Error('Не удалось нарисовать шар света (py/relight_ball.py)');
        log('Свет: ' + rp.preset[1] + ' · ' + rp.dir[1].toLowerCase() + ' · промт: «' + rp.prompt.replace('relight the video to match the light-direction ball. ', '') + '»');
      }

      // 3. Проходы LTX
      var ws = sizes(t, rr.width, rr.height);
      // кадры больше итогового размера уменьшаем заранее — иначе 4K-кадры не помещаются в память движка
      if (rr.width > ws.outW || rr.height > ws.outH) {
        stage('Уменьшаю кадры до ' + ws.outW + '×' + ws.outH + '…');
        await fitFrames(srcDir, ws.outW, ws.outH);
        if (mode !== 'plain') await fitFrames(maskDir, ws.outW, ws.outH);
      }
      var strip = 0;
      if (replaceMode) {
        // образец: слой целиком (с прозрачностью) в текущем кадре композиции
        stage('Готовлю образец и маску замены…');
        var refPng = path.join(jobDir, 'ref.png');
        await A.callHost('LTXP', 'exportLayerPng', { layer: Number(f.refLayer), path: refPng });
        var lastSz = -1, stable = 0;
        for (var w = 0; w < 150 && stable < 3; w++) { await A.sleep(100); var sz = fs.existsSync(refPng) ? fs.statSync(refPng).size : 0; if (sz > 0 && sz === lastSz) stable++; else stable = 0; lastSz = sz; }
        if (!lastSz) throw new Error('After Effects не сохранил слой-образец');
        strip = T.editStrip(ws.outW, ws.outH);
        var compDir = path.join(jobDir, 'composed');
        await pyRun([path.join(pluginDir(), 'py', 'r2v_prep.py'), srcDir, maskDir, refPng, compDir, String(ws.outW), String(ws.outH), String(strip), String(f.grow === undefined ? 10 : f.grow), String(f.block || 32)],
          function (l) {
            var m = /^PROGRESS (\d+) (\d+)/.exec(l);
            if (m) { etaAt = Date.now(); $('eta').textContent = 'Собираю кадры: ' + m[1] + ' из ' + m[2]; return; }
            if (/^(ERROR|WARN|Traceback)/.test(l)) log(l, /^WARN/.test(l) ? 'warn' : 'bad'); else if (/^INFO/.test(l)) log(l.replace(/^INFO /, ''));
          });
        srcDir = compDir; files = A.listImages(srcDir, /\.png$/i); mfiles = null;
        if (files.length !== N) throw new Error('Собрано кадров ' + files.length + ' из ' + N + ' (py/r2v_prep.py)');
        log('Замена по образцу: полоса с образцом ' + strip + ' px слева (после генерации отрезается), маска +' + (f.grow === undefined ? 10 : f.grow) + ' px, блоки ' + (f.block || 32) + ' px');
      }
      var chunks = T.planChunks(N, Math.min(s.chunkLen, t.maxFrames || 1e9));
      var strength = s.strengthByTool[t.id] !== undefined ? s.strengthByTool[t.id] : t.strength;
      var seed = s.randomSeed ? Math.floor(Math.random() * 1e9) : (s.seed | 0);
      log((T.isEditMode(t, f) ? (f.mode === 'edit' ? 'Правка по описанию' : 'Замена по образцу') + ': один проход ' + ws.outW + '×' + ws.outH + ', CFG ' + Number(f.cfg === undefined ? 1 : f.cfg).toFixed(2) + ', привязка ' + Number(f.hold === undefined ? 1 : f.hold).toFixed(2) + ', сила LoRA ' + Number(s.strengthByTool[t.id] !== undefined ? s.strengthByTool[t.id] : t.strength).toFixed(2) + ' (LoRA сообщества под LTX 2.3)'
        : s.stage2 && t.singleStage ? 'Один проход сразу в ' + ws.outW + '×' + ws.outH + ' (Lightricks рекомендует этот инструмент без апскейлера: второй проход теряет связь с исходником)'
        : s.stage2 && T.restyleDirect(t, f) ? 'Перерисовка одним проходом ' + ws.outW + '×' + ws.outH + ' (сила ≤ 0.75 — без апскейлера, чтобы сохранить детали исходника)'
        : s.stage2 ? '1-й проход ' + ws.W + '×' + ws.H + ' → апскейлер ×2 → ' + ws.outW + '×' + ws.outH + (s.anchor && !(t.kind === 'prompt' && (f.mode || 'restyle') !== 'structure') ? ' (с опорой на исходник)' : '')
        : 'Один проход ' + ws.W + '×' + ws.H + ' (апскейлер выключен)') + ', частей ' + chunks.length + ', seed ' + seed + ', проработка ' + ['', 'стандарт', 'детальнее', 'максимум'][Number(s.detail) || 1] +
        (t.kind === 'prompt' && (f.mode || 'restyle') === 'restyle' ? ', сила изменения ' + Number(f.denoise || 0.6).toFixed(2) : ''));
      var outIdx = 0, tGen = Date.now();
      for (var c = 0; c < chunks.length; c++) {
        if (job.cancelled) throw new Error('Остановлено пользователем');
        var ch = chunks[c];
        var cDir = path.join(jobDir, 'chunks', 'c' + A.pad(c, 3)), cSrc = path.join(cDir, 'src'), cMask = path.join(cDir, 'mask'), cExr = path.join(cDir, 'exr');
        prepChunkDir(files, srcDir, cSrc, ch);
        if (mfiles) prepChunkDir(mfiles, maskDir, cMask, ch);
        stage('LTX: проход ' + (c + 1) + ' из ' + chunks.length + ' (кадры ' + (ch.start + 1) + '–' + (ch.start + ch.take) + ')');
        var built = T.buildGraph({
          tool: t, fields: f, dir: cSrc.replace(/\\/g, '/'), maskDir: cMask.replace(/\\/g, '/'), exrDir: cExr.replace(/\\/g, '/'),
          len: ch.len, W: ws.W, H: ws.H, fps: rr.fps, seed: seed, strength: strength, tileSize: s.tileSize,
          stage2: !!s.stage2, anchor: !!(s.stage2 && s.anchor), models: window.LTXCurrentModels(s), detail: Number(s.detail) || 1,
          ballDir: ballDir ? ballDir.replace(/\\/g, '/') : '', strip: strip
        });
        var cIdx = c;
        log('Проход ' + (c + 1) + '/' + chunks.length + ': узлов в графе ' + Object.keys(built.graph).length);
        var tr = makeTracker(built.graph, 'Проход ' + (c + 1) + '/' + chunks.length, function (cf) {
          var frac = (cIdx + cf) / chunks.length;
          progress(0.05 + 0.85 * frac);
          var el = (Date.now() - tGen) / 1000;
          if (frac > 0.03) $('eta').textContent = 'Готово ' + Math.round(frac * 100) + '% · прошло ' + A.fmtTime(el) + ' · осталось ~' + A.fmtTime(el / frac * (1 - frac));
        });
        var untail = tailEngine(), hist;
        try { hist = await comfy.execute(built.graph, tr.onProgress, job, tr.onEvent); }
        finally { tr.stop(); untail(); }

        if (t.kind === 'hdr') {
          var exrs = A.listImages(cExr, /\.exr$/i).slice(0, ch.take);
          if (exrs.length < ch.take) log('Проход ' + (c + 1) + ': EXR ' + exrs.length + ' из ' + ch.take, 'warn');
          exrs.forEach(function (x) { fs.renameSync(path.join(cExr, x), path.join(outDir, 'ltx_' + A.pad(outIdx++, 6) + '.exr')); });
        } else {
          var imgs = ((hist.outputs || {})[built.saveNode] || {}).images || [];
          if (imgs.length < ch.take) log('Проход ' + (c + 1) + ': вернулось ' + imgs.length + ' из ' + ch.take + ' кадров', 'warn');
          imgs = imgs.slice(0, ch.take);
          for (var k = 0; k < imgs.length; k++) {
            if (job.cancelled) throw new Error('Остановлено пользователем');
            await comfy.download(imgs[k], path.join(outDir, 'ltx_' + A.pad(outIdx++, 6) + '.png'));
          }
        }
        A.rmrf(cDir);
        log('Проход ' + (c + 1) + '/' + chunks.length + ' готов');
      }
      if (outIdx !== N) log('Кадров на выходе ' + outIdx + ' вместо ' + N + ' — тайминг может съехать', 'warn');
      progress(0.93);

      // 4. Новая композиция
      stage('Собираю композицию…');
      var outMode = t.outputModes ? (s.outModeByTool[t.id] || t.outputModes[0][0]) : null;
      var imode = t.kind === 'hdr' ? 'hdr' : (mode === 'outpaint' ? 'outpaint' : (outMode === 'matte' ? 'matte' : 'plain'));
      var fitW = t.kind === 'upscale' ? null : rr.width, fitH = t.kind === 'upscale' ? null : rr.height;
      var ir = await A.callHost('LTXP', 'importResult', {
        dir: outDir, compId: rr.compId, compName: comp.name + ' [' + t.id + ']', fps: rr.fps, startTime: rr.startTime,
        mode: imode, to32: !!f.to32, addToSource: s.addToSource, fitW: fitW, fitH: fitH
      });
      if (s.cleanupSource) { A.rmrf(srcDir); A.rmrf(path.join(jobDir, 'src')); A.rmrf(maskDir); A.rmrf(path.join(jobDir, 'chunks')); }
      progress(1);
      log('Создана «' + ir.comp + '» ' + ir.width + '×' + ir.height + ', ' + ir.frames + ' кадров');
      stage('Готово за ' + A.fmtTime((Date.now() - job.t0) / 1000), 'ok');
      $('eta').textContent = 'Кадры: ' + outDir;
    } catch (e) {
      log(e.message, 'bad');
      if (/ENOSPC|No space left|Errno 28|not enough space|недостаточно места/i.test(e.message)) log('Закончилось место на диске рабочей папки (' + s.workDir + '). ' + SPACE_TIP, 'bad');
      if (/out of memory|CUDA|allocat/i.test(e.message)) log('Подсказка: не хватило видеопамяти. В настройках уменьшите разрешение или «кадров за проход» (например 49), выключите «опору на исходник» или выберите пресет слабее.');
      if (/safetensors|header/i.test(e.message)) log('Подсказка: файл модели повреждён или недокачан. «Zouwu Forge — Настройки» → «Модели» → «Установить / докачать» — докачает.');
    } finally {
      if (comfy) comfy.closeSocket();
      cleanEngineTemp();
      job = null; busy(false); updateInfo();
    }
  }

  /* Движок кладёт каждый готовый кадр ещё и в свою папку temp (превью) — после прогона они не нужны,
     а за день тестов набегают гигабайты. Чистим после каждого прогона. */
  function cleanEngineTemp() {
    try {
      var e = A.readEngine(); if (!e) return;
      var td = path.join(path.dirname(e.main), 'temp');
      if (!fs.existsSync(td)) return;
      fs.readdirSync(td).forEach(function (n) { if (/\.(png|exr|jpg|webp)$/i.test(n)) { try { fs.unlinkSync(path.join(td, n)); } catch (e1) {} } });
    } catch (e0) {}
  }

  function stop() {
    if (!job) return;
    job.cancelled = true;
    stage('Останавливаю…', 'warn');
    if (job.proc) job.proc.kill();
    if (comfy) comfy.cancel(job);
  }

  /* ---------- Помощник (ЛЛМ со зрением) ---------- */
  var L = window.LTXLlm;
  window.addEventListener('beforeunload', function () { busyFlag(false); try { L.stop(); } catch (e) {} });
  async function aiFill(t, fd, el, mode, btn) {
    if (job) return;
    s = Object.assign(store.load(), { fieldsByTool: s.fieldsByTool, tool: s.tool });
    // выбор мог не сохраниться — берём любую уже скачанную модель
    if (!s.llm || !L.ready(s.llm)) s.llm = L.ready('8b') ? '8b' : (L.ready('4b') ? '4b' : '');
    if (!s.llm) {
      var stt = L.status('8b'), st4 = L.status('4b');
      stage(!stt.engine ? 'Помощнику нужен установленный движок: «Настройки» → «Модели» → «Установить».'
        : (!stt.bin ? 'Помощник не установлен (нет llama.cpp): «Zouwu Forge — Настройки» → «Модели» → «Помощник (ЛЛМ)».'
        : 'Не найдена модель помощника в папке движка (llm\\models): «Настройки» → «Модели» → «Помощник (ЛЛМ)» → «Установить».'), 'warn');
      return;
    }
    var cur = String(el.value || '').trim();
    if (mode === 'improve' && !cur) { stage('Сначала напишите в поле, что хотите (можно по-русски) — помощник перепишет это в промт.', 'warn'); return; }
    var old = btn.textContent; btn.classList.add('busy'); btn.textContent = '…';
    try {
      await refreshComp();
      if (!comp) throw new Error('Нет активной композиции.');
      stage('Помощник смотрит на кадр ' + comp.curFrame + '…');
      fs.mkdirSync(A.APPDIR, { recursive: true });
      var raw = path.join(A.APPDIR, 'llm_frame.png'), jpg = path.join(A.APPDIR, 'llm_frame.jpg');
      try { fs.unlinkSync(raw); } catch (e0) {}
      await A.callHost('LTXP', 'grabFrame', { path: raw });
      // AE пишет PNG асинхронно — ждём, пока файл появится и перестанет расти
      var lastSz = -1, stable = 0;
      for (var w = 0; w < 150 && stable < 3; w++) {
        await A.sleep(100);
        var sz = fs.existsSync(raw) ? fs.statSync(raw).size : 0;
        if (sz > 0 && sz === lastSz) stable++; else stable = 0;
        lastSz = sz;
      }
      if (!fs.existsSync(raw) || !lastSz) throw new Error('After Effects не сохранил кадр');
      await pyRun([path.join(pluginDir(), 'py', 'prep_image.py'), raw, jpg, '1024']);
      var sys = 'You help a video editor working in After Effects. The image is the current frame of the composition. ' +
        'Tool: ' + t.label + '. Field: ' + fd.label + '. Answer briefly, without preamble.';
      var task = T.AI_TASKS[fd.ai] || T.AI_TASKS.scene;
      var user = mode === 'improve' ? (fd.aiImprove === 'edit' ? T.AI_IMPROVE_EDIT : T.AI_IMPROVE) + '\nField purpose: ' + task + '\nUser text: ' + cur : task;
      var ans = await L.ask(s.llm, sys, user, [jpg], function (m) { stage(m); });
      ans = ans.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
      ans = ans.replace(/^["«]|["»]$/g, '').trim();
      // поля могли перерисоваться, пока помощник думал — пишем в значения и перерисовываем заново (с заменой текста)
      fieldsOf(t)[fd.key] = ans; save();
      if (tool().id === t.id) renderFields();
      updateInfo();
      stage(mode === 'improve' ? 'Текст переписан помощником' : 'Поле заполнено помощником', 'ok');
    } catch (e) {
      stage(e.message, 'bad'); log(e.message, 'bad');
    } finally { btn.classList.remove('busy'); btn.textContent = old; }
  }

  /* ---------- запуск python-скриптов плагина ---------- */
  function pyRun(args, onLine) {
    var e = A.readEngine();
    if (!e) throw new Error('Движок не установлен: «Zouwu Forge — Настройки» → «Установить / докачать».');
    return A.runProcess(e.python, ['-s'].concat(args), { cwd: path.dirname(e.main), env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) }, onLine);
  }
  /* ---------- Кадр → видео с движением камеры ---------- */
  async function runI2V(t, f) {
    var fr = f.frameSrc === 'first' ? (rangeFrames() || [comp.curFrame])[0] : comp.curFrame;
    var jobDir = path.join(s.workDir, A.safeName(comp.name) + '_camera_' + A.stamp());
    var srcDir = path.join(jobDir, 'src'), outDir = path.join(jobDir, 'out');
    fs.mkdirSync(srcDir, { recursive: true }); fs.mkdirSync(outDir, { recursive: true });
    stage('Беру кадр ' + fr + ' из композиции…');
    await A.sleep(80);
    var rr = await A.callHost('LTXP', 'renderInputs', { range: 'custom', customStart: fr, customEnd: fr, srcDir: srcDir, maskDir: '', omTemplate: s.omTemplate, mode: 'plain' });
    await normalizeFrames(rr.src, srcDir, 'src');
    if (!A.listImages(srcDir, /\.png$/i).length) throw new Error('Не удалось получить стартовый кадр');
    var fps = Math.min(rr.fps, 30), len = i2vLen(f.seconds, fps);
    var ws = sizes(t, rr.width, rr.height);
    var seed = s.randomSeed ? Math.floor(Math.random() * 1e9) : (s.seed | 0);
    var mv = T.CAMERA_MOVES.filter(function (m) { return m[0] === (f.move || 'static'); })[0];
    log('Кадр ' + fr + ' → клип ' + len + ' кадров, камера: ' + (mv ? mv[1] : '—') + (T.cameraLoraFor(f) ? ' (LoRA ' + Number(f.camStrength === undefined ? 1 : f.camStrength).toFixed(2) + ')' : ' (по промту)') +
      ', ' + (s.stage2 ? ws.W + '×' + ws.H + ' → ' + ws.outW + '×' + ws.outH : ws.W + '×' + ws.H) + ', seed ' + seed);
    var lg = T.lockGuides(f, len);
    if (lg.length) log('Фиксация камеры (' + (f.lockZone || 'edges') + '): опорные кадры ' + lg.map(function (x) { return x[0] + '@' + x[1]; }).join(', '));
    progress(0.05);
    stage('LTX: генерирую клип…');
    var built = T.buildI2V({ tool: t, fields: f, dir: srcDir.replace(/\\/g, '/'), len: len, W: ws.W, H: ws.H, fps: fps, seed: seed,
      stage2: !!s.stage2, models: window.LTXCurrentModels(s), tileSize: s.tileSize, detail: Number(s.detail) || 1 });
    var tGen = Date.now();
    var tr = makeTracker(built.graph, 'Клип', function (cf) {
      progress(0.05 + 0.85 * cf);
      var el = (Date.now() - tGen) / 1000;
      if (cf > 0.03) $('eta').textContent = 'Готово ' + Math.round(cf * 100) + '% · прошло ' + A.fmtTime(el) + ' · осталось ~' + A.fmtTime(el / cf * (1 - cf));
    });
    var untail = tailEngine(), hist;
    try { hist = await comfy.execute(built.graph, tr.onProgress, job, tr.onEvent); }
    finally { tr.stop(); untail(); }
    var imgs = ((hist.outputs || {})[built.saveNode] || {}).images || [];
    if (!imgs.length) throw new Error('Движок не вернул кадры');
    stage('Скачиваю кадры…');
    for (var k = 0; k < imgs.length; k++) {
      if (job.cancelled) throw new Error('Остановлено пользователем');
      await comfy.download(imgs[k], path.join(outDir, 'ltx_' + A.pad(k, 6) + '.png'));
    }
    stage('Собираю композицию…');
    var ir = await A.callHost('LTXP', 'importResult', {
      dir: outDir, compId: rr.compId, compName: comp.name + ' [камера]', fps: fps, startTime: rr.startTime,
      mode: 'plain', addToSource: s.addToSource, fitW: rr.width, fitH: rr.height
    });
    if (s.cleanupSource) A.rmrf(srcDir);
    progress(1);
    log('Создана «' + ir.comp + '» ' + ir.width + '×' + ir.height + ', ' + ir.frames + ' кадров');
    stage('Готово за ' + A.fmtTime((Date.now() - job.t0) / 1000), 'ok');
    $('eta').textContent = 'Кадры: ' + outDir;
  }

  /* ---------- Перенос движения камеры: картинка (кадр композиции) + видео-образец (слой) ---------- */
  async function runCamXfer(t, f) {
    var fr = f.frameSrc === 'first' ? (rangeFrames() || [comp.curFrame])[0] : comp.curFrame;
    var jobDir = path.join(s.workDir, A.safeName(comp.name) + '_camxfer_' + A.stamp());
    var srcDir = path.join(jobDir, 'src'), refDir = path.join(jobDir, 'ref'), outDir = path.join(jobDir, 'out');
    [srcDir, refDir, outDir].forEach(function (d) { fs.mkdirSync(d, { recursive: true }); });
    stage('Беру кадр ' + fr + ' из композиции (без слоя-образца)…');
    await A.sleep(80);
    var rr = await A.callHost('LTXP', 'renderInputs', { range: 'custom', customStart: fr, customEnd: fr, srcDir: srcDir, maskDir: '', omTemplate: s.omTemplate, mode: 'plain', hideLayers: [Number(f.refLayer)] });
    await normalizeFrames(rr.src, srcDir, 'src');
    if (!A.listImages(srcDir, /\.png$/i).length) throw new Error('Не удалось получить картинку');
    var fps = Math.min(rr.fps, 30);
    var want = Math.max(9, Math.min(121, Math.round((Number(f.maxSec) || 5) * fps) + 1));
    stage('Рендер видео-образца из слоя… (AE на время замрёт)');
    await A.sleep(80);
    var rf = await A.callHost('LTXP', 'renderLayerSeq', { layer: Number(f.refLayer), dir: refDir, maxFrames: want, omTemplate: s.omTemplate });
    await normalizeFrames(rf.src, refDir, 'ref');
    var nRef = A.listImages(refDir, /\.png$/i).length;
    if (nRef < 9) throw new Error('Видео-образец слишком короткий: ' + nRef + ' кадров (нужно хотя бы 9)');
    var len = Math.floor((Math.min(nRef, want) - 1) / 8) * 8 + 1;
    var ws = sizes(t, rr.width, rr.height);
    var seed = s.randomSeed ? Math.floor(Math.random() * 1e9) : (s.seed | 0);
    var strength = s.strengthByTool[t.id] !== undefined ? s.strengthByTool[t.id] : t.strength;
    log('Перенос камеры: картинка — кадр ' + fr + ', образец — ' + nRef + ' кадр. → клип ' + len + ' кадров (' + (len / fps).toFixed(1) + ' с), ' +
      (s.stage2 ? ws.W + '×' + ws.H + ' → апскейлер ×2 → ' + ws.outW + '×' + ws.outH : ws.W + '×' + ws.H) +
      ', привязка к картинке ' + Number(f.imgStrength === undefined ? 0.5 : f.imgStrength).toFixed(2) + ', сила LoRA ' + Number(strength).toFixed(2) + ', seed ' + seed);
    if (Math.min(ws.W, ws.H) < 512) log('Первый проход меньше 960×544 — автор LoRA советует выше: поставьте разрешение 1088 для точного повтора камеры', 'warn');
    progress(0.05);
    stage('LTX: генерирую клип…');
    var built = T.buildCamXfer({ tool: t, fields: f, dirImg: srcDir.replace(/\\/g, '/'), dirRef: refDir.replace(/\\/g, '/'), len: len, W: ws.W, H: ws.H, fps: fps, seed: seed,
      strength: strength, stage2: !!s.stage2, models: window.LTXCurrentModels(s), tileSize: s.tileSize, detail: Number(s.detail) || 1,
      i2vCls: installed && installed.hasI2VCond ? 'LTXVImgToVideoConditionOnly' : 'LTXVImgToVideoInplace' });
    var tGen = Date.now();
    var tr = makeTracker(built.graph, 'Клип', function (cf) {
      progress(0.05 + 0.85 * cf);
      var el = (Date.now() - tGen) / 1000;
      if (cf > 0.03) $('eta').textContent = 'Готово ' + Math.round(cf * 100) + '% · прошло ' + A.fmtTime(el) + ' · осталось ~' + A.fmtTime(el / cf * (1 - cf));
    });
    var untail = tailEngine(), hist;
    try { hist = await comfy.execute(built.graph, tr.onProgress, job, tr.onEvent); }
    finally { tr.stop(); untail(); }
    var imgs = ((hist.outputs || {})[built.saveNode] || {}).images || [];
    if (!imgs.length) throw new Error('Движок не вернул кадры');
    stage('Скачиваю кадры…');
    for (var k = 0; k < imgs.length; k++) {
      if (job.cancelled) throw new Error('Остановлено пользователем');
      await comfy.download(imgs[k], path.join(outDir, 'ltx_' + A.pad(k, 6) + '.png'));
    }
    stage('Собираю композицию…');
    var ir = await A.callHost('LTXP', 'importResult', {
      dir: outDir, compId: rr.compId, compName: comp.name + ' [перенос камеры]', fps: fps, startTime: rr.startTime,
      mode: 'plain', addToSource: s.addToSource, fitW: rr.width, fitH: rr.height
    });
    if (s.cleanupSource) { A.rmrf(srcDir); A.rmrf(refDir); }
    progress(1);
    log('Создана «' + ir.comp + '» ' + ir.width + '×' + ir.height + ', ' + ir.frames + ' кадров');
    stage('Готово за ' + A.fmtTime((Date.now() - job.t0) / 1000), 'ok');
    $('eta').textContent = 'Кадры: ' + outDir;
  }

  /* ---------- DLSS 5: кадры из AE → DLSS 5 (без ComfyUI) → новая композиция ---------- */
  async function runDlssTool(t) {
    var D = window.LTXDlss, d = s.dlss || {};
    stage('Проверяю DLSS 5…');
    var st = await D.ensureDlss(function (m, fr) { log(m); stage(m); if (fr !== undefined) progress(0.15 * fr); });
    if (job.cancelled) throw new Error('Остановлено пользователем');
    var jobDir = path.join(s.workDir, A.safeName(comp.name) + '_dlss5_' + A.stamp());
    var srcDir = path.join(jobDir, 'src'), outDir = path.join(jobDir, 'out');
    fs.mkdirSync(srcDir, { recursive: true }); fs.mkdirSync(outDir, { recursive: true });
    stage('Рендер кадров в After Effects… (AE на время замрёт)');
    await A.sleep(80);
    var rfD = rangeFrames(), nD = rfD ? rfD[1] - rfD[0] + 1 : 0, fD = Number(d.factor) || 1;
    if (nD && comp) checkSpace(srcDir, comp.width * comp.height * 2 * nD * (1 + fD * fD) + 1073741824, 'кадры из AE и результат DLSS 5 (' + nD + ' шт.' + (fD > 1 ? ', ×' + fD : '') + ')');
    var rr = await A.callHost('LTXP', 'renderInputs', { range: s.range, customStart: s.customStart, customEnd: s.customEnd, srcDir: srcDir, maskDir: '', omTemplate: s.omTemplate, mode: 'plain' });
    if (job.cancelled) throw new Error('Остановлено пользователем');
    if (rr.src && rr.src.fmtLog) log('Формат вывода AE: ' + rr.src.fmtLog);
    if (rr.src && rr.src.video) {
      log('AE отрендерил видео вместо кадров — раскладываю на PNG…');
      await D.videoToFrames(st, rr.src.video, srcDir);
      try { fs.unlinkSync(rr.src.video); } catch (e0) {}
    }
    var N = A.listImages(srcDir, /\.(png|tiff?)$/i).length;
    if (!N) throw new Error('Нет кадров для обработки в ' + srcDir);
    var fct = Number(d.factor) || 1;
    checkSpace(outDir, A.dirBytes(srcDir) * fct * fct * 1.15 + 1073741824, 'результат DLSS 5 (' + N + ' кадр.' + (fct > 1 ? ', ×' + fct : '') + ')');
    log('Кадров из AE: ' + N);
    progress(0.2);
    stage('DLSS 5: запуск… (первый кадр — 10–30 с)');
    var tD = Date.now();
    job.proc = D.runDlss(st, d, srcDir, outDir, function (line) {
      var m = /^PROGRESS (\d+) (\d+)/.exec(line);
      if (m) {
        var done = +m[1], tot = +m[2], el = (Date.now() - tD) / 1000;
        progress(0.2 + 0.72 * done / tot);
        stage('DLSS 5: кадр ' + done + ' из ' + tot);
        if (done > 1) $('eta').textContent = (done / el).toFixed(1) + ' кадр/с · осталось ~' + A.fmtTime(el / done * (tot - done));
        return;
      }
      log(line.replace(/^INFO /, ''));
    });
    var res = await job.proc.promise;
    job.proc = null;
    log('DLSS 5 готов: ' + res.frames + ' кадров ' + res.width + '×' + res.height + ', ' + res.fps + ' кадр/с');
    if (res.verified === false) log('Внимание: подтверждения нейрорендеринга нет — возможно, сработал обычный DLSS. ' + (res.warning || ''), 'warn');
    stage('Собираю композицию…');
    var big = Number(d.factor) > 1;
    var ir = await A.callHost('LTXP', 'importResult', {
      dir: outDir, compId: rr.compId, compName: comp.name + ' [DLSS5]', fps: rr.fps, startTime: rr.startTime,
      mode: 'plain', addToSource: s.addToSource, fitW: big ? null : rr.width, fitH: big ? null : rr.height
    });
    if (s.cleanupSource) A.rmrf(srcDir);
    progress(1);
    log('Создана «' + ir.comp + '» ' + ir.width + '×' + ir.height + ', ' + ir.frames + ' кадров');
    stage('Готово за ' + A.fmtTime((Date.now() - job.t0) / 1000), 'ok');
    $('eta').textContent = 'Кадры: ' + outDir;
  }

  /* ---------- привязки ---------- */
  function bind() {
    $('tool').addEventListener('change', function () { s.tool = this.value; save(); renderFields(); });
    $('strength').addEventListener('input', function () {
      s.strengthByTool[tool().id] = Number(this.value);
      this.nextElementSibling.textContent = Number(this.value).toFixed(2); save();
    });
    $('outMode').addEventListener('change', function () { s.outModeByTool[tool().id] = this.value; save(); });
    Array.prototype.forEach.call(document.querySelectorAll('input[name=range]'), function (r) {
      r.checked = r.value === s.range;
      r.addEventListener('change', function () { s.range = this.value; save(); updateInfo(); });
    });
    ['customStart', 'customEnd'].forEach(function (k) {
      $(k).value = s[k];
      $(k).addEventListener('input', function () { s[k] = Number(this.value); save(); updateInfo(); });
    });
    $('stage2').checked = !!s.stage2; $('anchorRun').checked = !!s.anchor; $('anchorRun').disabled = !s.stage2;
    $('stage2').addEventListener('change', function () { s.stage2 = this.checked; $('anchorRun').disabled = !s.stage2; save(); updateInfo(); });
    $('anchorRun').addEventListener('change', function () { s.anchor = this.checked; save(); updateInfo(); });
    function resToUI() {
      $('resRun').value = (s.resMode === 'auto' || s.resMode === 'custom') ? s.resMode : String(s.outSide || 720);
      if ($('resRun').selectedIndex < 0) $('resRun').value = '720';
      $('customSideRun').value = String(s.customSide || 720);
      $('customSideRow').classList.toggle('hidden', s.resMode !== 'custom');
    }
    window.__resToUI = resToUI;
    resToUI();
    $('resRun').addEventListener('change', function () {
      var v = this.value;
      if (v === 'auto' || v === 'custom') s.resMode = v; else { s.resMode = 'preset'; s.outSide = Number(v); }
      save(); resToUI(); updateInfo();
    });
    $('customSideRun').addEventListener('change', function () {
      var v = Math.round((Number(this.value) || 720) / 32) * 32;
      s.customSide = Math.max(256, Math.min(1088, v)); this.value = s.customSide; save(); updateInfo();
    });
    $('detailRun').value = String(s.detail || 1);
    $('detailRun').addEventListener('change', function () { s.detail = Number(this.value) || 1; save(); updateInfo(); });
    $('addToSource').checked = !!s.addToSource;
    $('addToSource').addEventListener('change', function () { s.addToSource = this.checked; save(); });
    function workToUI() {
      var fb = null; try { fb = A.freeBytes(s.workDir); } catch (e) {}
      $('workDirRun').textContent = s.workDir + (fb !== null ? '  ·  свободно ' + (fb / 1073741824).toFixed(0) + ' ГБ' : '');
    }
    window.__workToUI = workToUI;
    workToUI();
    $('btnWorkRun').onclick = function () {
      try { var p = A.pickFolder('Папка для результатов и секвенций', s.workDir); if (p) { s.workDir = p; save(); workToUI(); log('Папка результатов: ' + p); } }
      catch (e) { stage(e.message, 'bad'); }
    };
    $('btnWorkOpenRun').onclick = function () { A.openFolder(s.workDir); };
    $('btnRefresh').onclick = refreshComp;
    $('lnkSettings').onclick = function () { A.openExtension(window.LTX_IDS.SETTINGS); };
    $('btnRun').onclick = run;
    $('btnStop').onclick = stop;
    window.addEventListener('focus', function () { if (!job) refreshComp(); });
    store.watch(function (ns) {
      ['tool', 'fieldsByTool', 'strengthByTool', 'outModeByTool', 'range', 'customStart', 'customEnd', 'addToSource'].forEach(function (k) { ns[k] = s[k]; });
      s = ns; if (tool().kind === 'dlss' && !job) renderFields(); $('stage2').checked = !!s.stage2; $('anchorRun').checked = !!s.anchor; $('anchorRun').disabled = !s.stage2; $('detailRun').value = String(s.detail || 1); if (window.__resToUI) window.__resToUI(); if (window.__workToUI) window.__workToUI(); updateInfo();
    });
  }

  // При открытии: тихо узнаём, какие модели уже скачаны (если движок запущен)
  function probeInstalled() {
    var c = new A.Comfy(A.engineUrl());
    c.ping().then(function (ok) {
      if (!ok) return;
      return c.objectInfo().then(function (info) { installed = inspectEngine(info); renderToolSelect(); });
    }).catch(function () {});
  }

  renderToolSelect();
  bind();
  renderFields();
  refreshComp();
  probeInstalled();
})();
