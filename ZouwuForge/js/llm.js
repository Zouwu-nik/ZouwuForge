/* Zouwu Forge — помощник: локальная ЛЛМ со зрением (Qwen3-VL через llama.cpp).
   Смотрит на кадр композиции и пишет описания для полей инструментов («Описать»),
   переписывает текст пользователя в промт для модели («Улучшить»).
   Ставится по желанию в папку движка: <ComfyUI_windows_portable>\llm. Сервер запускается по первому запросу
   и останавливается перед генерацией, чтобы не занимать видеопамять. */
(function (g) {
  'use strict';
  var A = g.LTXCore;
  var fs = require('fs'), path = require('path'), https = require('https'), http = require('http'), cp = require('child_process');

  var LLAMA_TAG = 'b11560';
  var GH = 'https://github.com/ggml-org/llama.cpp/releases/download/' + LLAMA_TAG + '/';
  var BUILDS = {
    'cuda12': ['llama-' + LLAMA_TAG + '-bin-win-cuda-12.4-x64.zip', 'cudart-llama-bin-win-cuda-12.4-x64.zip'],
    'cuda13': ['llama-' + LLAMA_TAG + '-bin-win-cuda-13.4-x64.zip', 'cudart-llama-bin-win-cuda-13.4-x64.zip'],
    'vulkan': ['llama-' + LLAMA_TAG + '-bin-win-vulkan-x64.zip']
  };
  var MODELS = {
    '4b': { label: 'Qwen3-VL 4B — 3 ГБ, для 8–12 ГБ видеопамяти', repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF',
      model: 'Qwen3VL-4B-Instruct-Q4_K_M.gguf', mmproj: 'mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf', size: 2.95 },
    '8b': { label: 'Qwen3-VL 8B — 6 ГБ, точнее (рекомендуется для 16 ГБ+)', repo: 'Qwen/Qwen3-VL-8B-Instruct-GGUF',
      model: 'Qwen3VL-8B-Instruct-Q4_K_M.gguf', mmproj: 'mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf', size: 5.8 }
  };
  var PORT = 8190;
  var proc = null;

  function dir() { var e = A.readEngine(); return e ? path.join(path.dirname(path.dirname(e.main)), 'llm') : null; }
  function binDir() { var d = dir(); return d && path.join(d, 'bin'); }
  function serverExe() {
    var b = binDir(); if (!b || !fs.existsSync(b)) return null;
    var direct = path.join(b, 'llama-server.exe');
    if (fs.existsSync(direct)) return direct;
    try {   // в некоторых сборках файлы лежат во вложенной папке
      var sub = fs.readdirSync(b).map(function (n) { return path.join(b, n, 'llama-server.exe'); }).filter(fs.existsSync);
      return sub[0] || null;
    } catch (e) { return null; }
  }
  function modelPaths(id) {
    var m = MODELS[id], d = dir(); if (!m || !d) return null;
    return { model: path.join(d, 'models', m.model), mmproj: path.join(d, 'models', m.mmproj) };
  }
  function status(id) {
    var mp = modelPaths(id);
    var x = serverExe();
    return { engine: !!A.readEngine(), bin: !!x && fs.existsSync(path.join(path.dirname(x), 'ggml-cuda.dll')), model: !!(mp && fs.existsSync(mp.model) && fs.existsSync(mp.mmproj)) };
  }
  function ready(id) { var s = status(id); return s.bin && s.model; }

  /* ---------- загрузка с докачкой ---------- */
  function download(url, dest, onProgress, headers, hops) {
    hops = hops || 0;
    var part = dest + '.part', have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    return new Promise(function (resolve, reject) {
      if (hops > 8) { reject(new Error('Слишком много перенаправлений')); return; }
      var h = Object.assign({ 'User-Agent': 'ZouwuForge' }, headers || {});
      if (have) h.Range = 'bytes=' + have + '-';
      var u = new URL(url);
      if (u.hostname !== 'huggingface.co') delete h.Authorization;   // токен — только для HF
      https.get(url, { headers: h }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); resolve(download(new URL(res.headers.location, url).toString(), dest, onProgress, headers, hops + 1)); return;
        }
        if (res.statusCode === 416) { res.resume(); fs.renameSync(part, dest); resolve(); return; }
        if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); reject(new Error('HTTP ' + res.statusCode + ' — ' + url)); return; }
        if (res.statusCode === 200) have = 0;
        var total = have + parseInt(res.headers['content-length'] || '0', 10), got = have;
        var f = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
        res.on('data', function (c) { got += c.length; if (onProgress) onProgress(got, total); });
        res.pipe(f);
        f.on('finish', function () { f.close(function () {
          if (total && got < total) { resolve(download(url, dest, onProgress, headers, hops)); return; }
          fs.renameSync(part, dest); resolve();
        }); });
        res.on('error', reject); f.on('error', reject);
      }).on('error', function () { setTimeout(function () { resolve(download(url, dest, onProgress, headers, hops)); }, 5000); });
    });
  }
  // Распаковка: сначала tar, при ошибке — PowerShell Expand-Archive
  function extract(zip, to) {
    return extractWith(zip, to, true).catch(function (e1) {
      return extractWith(zip, to, false).catch(function (e2) { throw new Error(e1.message + ' / PowerShell: ' + e2.message); });
    });
  }
  function extractWith(zip, to, useTar) {
    var tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    fs.mkdirSync(to, { recursive: true });
    return new Promise(function (resolve, reject) {
      var p = useTar && fs.existsSync(tar) ? cp.spawn(tar, ['-xf', zip, '-C', to], { windowsHide: true })
        : cp.spawn('powershell', ['-NoProfile', '-Command', 'Expand-Archive -Force -LiteralPath "' + zip + '" -DestinationPath "' + to + '"'], { windowsHide: true });
      var err = ''; p.stderr.on('data', function (d) { err += d; });
      p.on('error', reject);
      p.on('close', function (c) { c === 0 ? resolve() : reject(new Error('Распаковка: код ' + c + ' ' + err.slice(-200))); });
    });
  }
  function buildFor(gpu) { return gpu && /RTX\s*50/i.test(gpu.name || '') ? 'cuda13' : 'cuda12'; }

  /* Установка: сборка llama.cpp + модель. log(msg, frac) */
  async function install(id, gpu, token, log) {
    var d = dir(); if (!d) throw new Error('Сначала установите движок (кнопка «Установить / докачать»).');
    var m = MODELS[id]; if (!m) throw new Error('Неизвестная модель помощника');
    var dl = path.join(d, 'downloads'), md = path.join(d, 'models');
    [d, dl, md].forEach(function (x) { fs.mkdirSync(x, { recursive: true }); });
    function cudaOk() { var x = serverExe(); return !!x && fs.existsSync(path.join(path.dirname(x), 'ggml-cuda.dll')); }
    if (!cudaOk()) {   // нет llama.cpp или после прошлой попытки пропала ggml-cuda.dll — распаковываем заново
      var files = BUILDS[buildFor(gpu)];
      for (var i = 0; i < files.length; i++) {
        var z = path.join(dl, files[i]), last = 0;
        if (!fs.existsSync(z)) {
          log('Скачиваю llama.cpp: ' + files[i]);
          await download(GH + files[i], z, function (got, total) {
            var now = Date.now(); if (now - last < 1500) return; last = now;
            log('llama.cpp: ' + Math.round(got / 1048576) + (total ? ' / ' + Math.round(total / 1048576) : '') + ' МБ', total ? got / total : undefined);
          });
        }
        stop();   // запущенный помощник держит свои dll — распаковка поверх них падает
        try { await extract(z, binDir()); }
        catch (ex) {
          // tar на Windows возвращает ошибку и из-за мелочей («Can't restore time»), хотя файлы на месте
          if (!serverExe()) throw ex;
          log('Распаковка с предупреждением: ' + String(ex.message).slice(0, 160));
        }
      }
      var cudaDll = serverExe() && path.join(path.dirname(serverExe()), 'ggml-cuda.dll');
      if (cudaDll && !fs.existsSync(cudaDll)) {
        throw new Error('После распаковки пропал файл ggml-cuda.dll (≈0.5 ГБ) — почти всегда его удаляет антивирус. ' +
          'Добавьте папку ' + d + ' в исключения антивируса (Защитник Windows → Защита от вирусов → Исключения), ' +
          'удалите папку ' + binDir() + ' и нажмите «Установить» снова — архивы уже скачаны, качать заново не придётся.');
      }
      if (!serverExe()) throw new Error('В архиве llama.cpp не нашёлся llama-server.exe');
      log('llama.cpp установлен');
    }
    var hdr = token ? { Authorization: 'Bearer ' + token } : {};
    var list = [m.model, m.mmproj];
    for (var k = 0; k < list.length; k++) {
      var dest = path.join(md, list[k]), lastP = 0;
      if (fs.existsSync(dest)) continue;
      log('Скачиваю ' + list[k]);
      await download('https://huggingface.co/' + m.repo + '/resolve/main/' + list[k], dest, function (got, total) {
        var now = Date.now(); if (now - lastP < 1500) return; lastP = now;
        log(list[k] + ': ' + (got / 1073741824).toFixed(2) + (total ? ' / ' + (total / 1073741824).toFixed(2) : '') + ' ГБ', total ? got / total : undefined);
      }, hdr);
    }
    log('Помощник готов: ' + m.label.split(' —')[0], 1);
  }

  /* ---------- сервер ---------- */
  function req(method, p, body, timeout) {
    return new Promise(function (resolve, reject) {
      var data = body ? Buffer.from(JSON.stringify(body)) : null;
      var r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, timeout: timeout || 5000,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, function (res) {
        var chunks = []; res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () { resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }); });
      });
      r.on('timeout', function () { r.destroy(new Error('timeout')); });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  }
  async function alive() { try { var r = await req('GET', '/health', null, 1500); return r.status === 200; } catch (e) { return false; } }
  function freeComfy() {   // выгружаем модели LTX из видеопамяти, если движок запущен
    return new Promise(function (resolve) {
      try {
        var data = Buffer.from(JSON.stringify({ unload_models: true, free_memory: true }));
        var r = http.request({ host: '127.0.0.1', port: 8188, path: '/free', method: 'POST', timeout: 3000,
          headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, function (res) { res.resume(); res.on('end', resolve); });
        r.on('error', function () { resolve(); }); r.on('timeout', function () { r.destroy(); resolve(); });
        r.write(data); r.end();
      } catch (e) { resolve(); }
    });
  }
  async function start(id, log) {
    if (await alive()) return;
    var exe = serverExe(), mp = modelPaths(id);
    if (!exe || !mp || !fs.existsSync(mp.model)) throw new Error('Помощник не установлен: «Zouwu Forge — Настройки» → «Модели» → «Помощник».');
    await freeComfy();
    if (log) log('Запускаю помощника…');
    var tail = [];
    proc = cp.spawn(exe, ['-m', mp.model, '--mmproj', mp.mmproj, '-ngl', '99', '-c', '8192', '--host', '127.0.0.1', '--port', String(PORT), '--jinja'],
      { cwd: path.dirname(exe), windowsHide: true });
    proc.stderr.on('data', function (d) { tail.push(String(d)); if (tail.length > 20) tail.shift(); });
    var PIDF = path.join(A.APPDIR, 'llm.pid');
    try { fs.writeFileSync(PIDF, String(proc.pid)); } catch (ep) {}
    proc.on('exit', function () { proc = null; try { fs.unlinkSync(PIDF); } catch (e) {} });
    var t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      await A.sleep(700);
      if (!proc) throw new Error('Помощник не запустился: ' + tail.join('').slice(-400) + '\nОбновите драйвер NVIDIA.');
      if (await alive()) { if (log) log('Помощник готов за ' + Math.round((Date.now() - t0) / 1000) + ' с'); return; }
    }
    stop();
    throw new Error('Помощник не ответил за 2 минуты');
  }
  function stop() {
    if (proc) { try { cp.execSync('taskkill /PID ' + proc.pid + ' /T /F', { windowsHide: true, stdio: 'ignore' }); } catch (e) { try { proc.kill(); } catch (e2) {} } proc = null; }
  }
  /* Вопрос с картинками. images — пути к PNG/JPG. */
  async function ask(id, system, user, images, log) {
    await start(id, log);
    var content = [{ type: 'text', text: user }];
    (images || []).forEach(function (p) {
      content.push({ type: 'image_url', image_url: { url: 'data:image/' + (/\.jpe?g$/i.test(p) ? 'jpeg' : 'png') + ';base64,' + fs.readFileSync(p).toString('base64') } });
    });
    var r = await req('POST', '/v1/chat/completions', {
      messages: [{ role: 'system', content: system }, { role: 'user', content: content }],
      temperature: 0.3, max_tokens: 400
    }, 180000);
    if (r.status !== 200) throw new Error('Помощник: HTTP ' + r.status + ' ' + r.text.slice(0, 200));
    var j = JSON.parse(r.text);
    return String(((j.choices || [])[0] || {}).message ? j.choices[0].message.content : '').trim();
  }

  g.LTXLlm = { MODELS: MODELS, status: status, ready: ready, install: install, start: start, stop: stop, ask: ask, dir: dir, buildFor: buildFor };
})(window);
