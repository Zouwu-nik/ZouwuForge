/* Zouwu Forge — DLSS 5 (NVIDIA Neural Rendering) напрямую через сборку DLSS 5 Visual Enhancer, без ComfyUI */
(function (g) {
  'use strict';
  var fs = require('fs'), path = require('path'), os = require('os'), https = require('https'), cp = require('child_process');
  var APPDIR = path.join(process.env.APPDATA || os.homedir(), 'ZouwuForge');

  var RELEASES = [
    'https://github.com/Merserk/dlss5-visual-enhancer/releases/download/v1.0/DLSS.5.Visual.Enhancer.v1.0.zip'
  ];
  var LATEST_API = 'https://api.github.com/repos/Merserk/dlss5-visual-enhancer/releases/latest';

  var UPSCALE = [['1', '1× (DLAA, без апскейла)'], ['1.5', '1.5× (Quality)'], ['1.724', '1.724× (Balanced)'], ['2', '2× (Performance)'], ['3', '3× (Ultra Performance)']];

  var DLSS_KEYS = ['factor', 'nr_style', 'nr_preset', 'nr_intensity', 'local_tone_strength', 'local_structure_strength', 'skin_structure_strength', 'warmup'];
  function P(o) { var r = { factor: '1', nr_style: 'Default', nr_intensity: 1.0, local_tone_strength: 1.0, local_structure_strength: 1.5, skin_structure_strength: -1 }; for (var k in o) r[k] = o[k]; return r; }
  var PRESETS = {
    'default': { label: 'Очистка без апскейла', v: P({}) },
    'up2x':    { label: 'Очистка + апскейл 2×', v: P({ factor: '2' }) },
    'up15':    { label: 'Очистка + апскейл 1.5×', v: P({ factor: '1.5' }) },
    'faces':   { label: 'Максимально реалистичные лица', v: P({ local_structure_strength: 2.0, skin_structure_strength: 2.0 }) },
    'cine':    { label: 'Кино: больше контраста', v: P({ nr_style: 'Cinematic' }) },
    'soft':    { label: 'Мягко, ближе к исходнику', v: P({ nr_intensity: 0.65, local_structure_strength: 1.0, nr_style: 'Natural' }) },
    'custom':  { label: 'Свой', v: null }
  };

  /* ---------------- где живёт DLSS 5 ---------------- */
  // Папка со сборкой DLSS 5: путь от установщика → уже скачанная ранее → D:\DLSS5 / C:\DLSS5
  function installDir() {
    var saved = [path.join(APPDIR, 'dlss_path.txt'), path.join(process.env.APPDATA || os.homedir(), 'DLSS5Bridge', 'dlss_path.txt')];
    for (var i = 0; i < saved.length; i++) {
      try {
        var p = fs.readFileSync(saved[i], 'utf8').trim();
        var ir0 = g.LTXCore && g.LTXCore.installRoot && g.LTXCore.installRoot();
        if (ir0 && p && path.resolve(p).toLowerCase().indexOf(path.resolve(ir0).toLowerCase()) !== 0) continue;
        if (p && fs.existsSync(path.join(p, 'app.py'))) return p;
      } catch (e) {}
    }
    var cands = ['D:\\DLSS5', 'C:\\DLSS5', 'D:\\AIPost\\dlss5', 'D:\\LTXPost\\dlss5', 'D:\\ZouwuForge\\dlss5', localDir()];
    var ir = g.LTXCore && g.LTXCore.installRoot && g.LTXCore.installRoot();
    if (ir) cands = [path.join(ir, 'dlss5')];
    var e = g.LTXCore && g.LTXCore.readEngine();
    if (!ir && e && e.root) cands.unshift(path.join(e.root, 'dlss5'));
    for (var j = 0; j < cands.length; j++) if (fs.existsSync(path.join(cands[j], 'app.py'))) return cands[j];
    if (ir) return path.join(ir, 'dlss5');
    try { if (fs.existsSync('D:\\')) return 'D:\\DLSS5'; } catch (e2) {}
    return localDir();
  }
  function localDir() { return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'DLSS5'); }
  // Создаёт папку; корень диска не трогает (на Windows mkdir 'C:\\' даёт EPERM)
  function mkdirp(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
  // Выбирает папку, куда реально можно писать; запоминает выбор
  function writableInstallDir() {
    var cands = [installDir(), localDir()];
    for (var i = 0; i < cands.length; i++) {
      try {
        mkdirp(cands[i]);
        var probe = path.join(cands[i], '.write_test');
        fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe);
        try { mkdirp(APPDIR); fs.writeFileSync(path.join(APPDIR, 'dlss_path.txt'), cands[i]); } catch (e1) {}
        return cands[i];
      } catch (e) { /* нет прав — пробуем следующую */ }
    }
    throw new Error('Не удалось создать папку для DLSS 5 ни в ' + cands.join(', ') + '. Проверьте права или свободное место.');
  }
  function findPython(dir) {
    var bin = path.join(dir, 'bin');
    if (!fs.existsSync(bin)) return null;
    var py = fs.readdirSync(bin).filter(function (n) { return /^python/i.test(n); })
      .map(function (n) { return path.join(bin, n, 'python.exe'); }).filter(function (p) { return fs.existsSync(p); });
    return py[0] || null;
  }
  function appStatus() {
    var dir = installDir();
    var st = { dir: dir, python: findPython(dir), worker: path.join(dir, 'bin', 'runtime', 'nvngx.dll'), app: path.join(dir, 'app.py') };
    st.ok = !!(st.python && fs.existsSync(st.worker) && fs.existsSync(st.app) && fs.existsSync(path.join(dir, 'bin', 'runtime', 'nvngx_dlssnr.dll')));
    st.workerMissing = !!(st.python && fs.existsSync(st.app) && !fs.existsSync(st.worker));
    return st;
  }

  /* ---------------- загрузка ---------------- */
  function getJSON(url) {
    return new Promise(function (resolve, reject) {
      https.get(url, { headers: { 'User-Agent': 'ZouwuForge', 'Accept': 'application/vnd.github+json' } }, function (res) {
        var d = ''; res.on('data', function (c) { d += c; });
        res.on('end', function () { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
  }
  function download(url, dest, log, hops) {
    hops = hops || 0;
    return new Promise(function (resolve, reject) {
      if (hops > 8) { reject(new Error('Слишком много перенаправлений')); return; }
      https.get(url, { headers: { 'User-Agent': 'ZouwuForge' } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); resolve(download(new URL(res.headers.location, url).toString(), dest, log, hops + 1)); return;
        }
        if (res.statusCode !== 200) { res.resume(); var er = new Error('HTTP ' + res.statusCode + ' — ' + url); er.status = res.statusCode; reject(er); return; }
        var total = parseInt(res.headers['content-length'] || '0', 10), got = 0, lastPct = -5;
        var f = fs.createWriteStream(dest + '.part');
        res.on('data', function (c) {
          got += c.length;
          var pct = total ? Math.floor(got / total * 100) : 0;
          if (total && pct >= lastPct + 5) { lastPct = pct; log('Загрузка DLSS 5: ' + pct + '% (' + Math.round(got / 1048576) + ' / ' + Math.round(total / 1048576) + ' МБ)', pct / 100); }
        });
        res.pipe(f);
        f.on('finish', function () { f.close(function () { fs.renameSync(dest + '.part', dest); resolve(); }); });
        res.on('error', reject); f.on('error', reject);
      }).on('error', reject);
    });
  }
  function extract(zip, dir) {
    mkdirp(dir);
    var tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    return new Promise(function (resolve, reject) {
      var p = fs.existsSync(tar)
        ? cp.spawn(tar, ['-xf', zip, '-C', dir], { windowsHide: true })
        : cp.spawn('powershell', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath "' + zip + '" -DestinationPath "' + dir + '" -Force'], { windowsHide: true });
      var err = '';
      p.stderr.on('data', function (d) { err += d; });
      p.on('error', reject);
      p.on('close', function (c) { c === 0 ? resolve() : reject(new Error('Распаковка не удалась (' + c + '): ' + err.slice(-400))); });
    });
  }

  // Ставит DLSS 5, если его ещё нет. log(msg, frac?)
  async function ensureDlss(log) {
    var st = appStatus();
    if (st.ok) return st;
    if (st.workerMissing) throw defenderError(st.dir);
    var dir = writableInstallDir(), zip = path.join(dir, '_download.zip');
    log('DLSS 5 ещё не установлен — скачиваю (~450 МБ, один раз) в ' + dir);
    var ok = false, lastErr = null;
    for (var i = 0; i < RELEASES.length && !ok; i++) {
      try { await download(RELEASES[i], zip, log); ok = true; } catch (e) { lastErr = e; }
    }
    if (!ok) {
      log('Закреплённая версия недоступна, ищу последнюю на GitHub…');
      var rel = await getJSON(LATEST_API);
      var asset = (rel.assets || []).filter(function (a) { return /\.zip$/i.test(a.name); })[0];
      if (!asset) throw new Error('Не нашёл сборку DLSS 5 на GitHub (' + (lastErr ? lastErr.message : '') + ')');
      await download(asset.browser_download_url, zip, log);
    }
    log('Распаковываю…');
    await extract(zip, dir);
    try { fs.unlinkSync(zip); } catch (e) {}
    st = appStatus();
    if (!st.ok) {
      if (st.workerMissing) throw defenderError(dir);
      throw new Error('Сборка распакована, но не найдены нужные файлы в ' + dir);
    }
    log('DLSS 5 установлен');
    return st;
  }
  function defenderError(dir) {
    return new Error('Файл nvngx.dll удалён — скорее всего Защитником Windows (это рабочий процесс DLSS, он запускается как .exe с именем .dll).\n' +
      'Откройте «Безопасность Windows» → «Защита от вирусов» → «Исключения» и добавьте папку:\n' + dir +
      '\nЗатем удалите эту папку и нажмите «Запустить» ещё раз — панель скачает заново.');
  }

  /* ---------------- прогон ---------------- */
  function pluginDir() {
    var p = decodeURIComponent(g.location.pathname).replace(/^\/([A-Za-z]:)/, '$1');
    return path.dirname(p);
  }
  // Возвращает {promise, kill}
  function runDlss(st, s, srcDir, outDir, onLine) {
    var driver = path.join(pluginDir(), 'py', 'dlss_frames.py');
    var args = ['-s', driver, '--app', st.dir, '--src', srcDir, '--out', outDir,
      '--factor', String(s.factor), '--style', s.nr_style, '--preset', s.nr_preset,
      '--intensity', String(s.nr_intensity), '--tone', String(s.local_tone_strength),
      '--structure', String(s.local_structure_strength), '--skin', String(s.skin_structure_strength),
      '--warmup', String(s.warmup | 0)];
    var env = Object.assign({}, process.env, { PYTHONNOUSERSITE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' });
    var child = cp.spawn(st.python, args, { cwd: st.dir, env: env, windowsHide: true });
    var tail = [], result = null, error = null;
    var promise = new Promise(function (resolve, reject) {
      function pipe(stream) {
        var buf = '';
        stream.on('data', function (d) {
          buf += d.toString('utf8');
          var lines = buf.split(/\r?\n/); buf = lines.pop();
          lines.forEach(function (l) {
            if (!l.trim()) return;
            tail.push(l); if (tail.length > 40) tail.shift();
            if (l.indexOf('RESULT ') === 0) { try { result = JSON.parse(l.slice(7)); } catch (e) {} return; }
            if (l.indexOf('ERROR ') === 0) { error = l.slice(6).replace(/ \| /g, '\n'); return; }
            onLine(l);
          });
        });
      }
      pipe(child.stdout); pipe(child.stderr);
      child.on('error', reject);
      child.on('close', function (code) {
        if (code === 0 && result) resolve(result);
        else reject(new Error(error || ('DLSS 5 завершился с кодом ' + code + ':\n' + tail.slice(-10).join('\n'))));
      });
    });
    return {
      promise: promise,
      kill: function () { try { cp.execSync('taskkill /PID ' + child.pid + ' /T /F', { windowsHide: true, stdio: 'ignore' }); } catch (e) { try { child.kill(); } catch (e2) {} } }
    };
  }

  // Раскладывает видео на PNG-кадры встроенным в сборку DLSS 5 ffmpeg
  function videoToFrames(st, video, outDir) {
    var ff = path.join(st.dir, 'bin', 'ffmpeg', 'bin', 'ffmpeg.exe');
    if (!fs.existsSync(ff)) return Promise.reject(new Error('Не найден ffmpeg в ' + ff));
    return new Promise(function (resolve, reject) {
      var p = cp.spawn(ff, ['-v', 'error', '-y', '-i', video, '-vsync', '0', '-start_number', '0', path.join(outDir, 'src_%05d.png')], { windowsHide: true });
      var err = ''; p.stderr.on('data', function (d) { err += d; });
      p.on('error', reject);
      p.on('close', function (c) { c === 0 ? resolve() : reject(new Error('ffmpeg: ' + err.slice(-500))); });
    });
  }


  g.LTXDlss = {
    UPSCALE: UPSCALE, PRESETS: PRESETS, DLSS_KEYS: DLSS_KEYS,
    appStatus: appStatus, ensureDlss: ensureDlss, runDlss: runDlss, videoToFrames: videoToFrames, installDir: installDir
  };
})(window);
