/* Zouwu Forge — очистка старых генераций в рабочей папке.
   Генерация = подпапка рабочей папки вида <композиция>_<инструмент>_ГГГГММДД_ччммсс (с src/out внутри).
   Последние N не трогаем; по желанию не трогаем папки, файлы из которых лежат в открытом проекте AE. */
(function (g) {
  'use strict';
  var fs = require('fs'), path = require('path');
  var STAMP = /_(\d{8})_(\d{6})$/;

  function dirSize(d) {
    var total = 0, files = 0;
    (function walk(p) {
      var list; try { list = fs.readdirSync(p); } catch (e) { return; }
      list.forEach(function (n) {
        var f = path.join(p, n), st; try { st = fs.lstatSync(f); } catch (e) { return; }
        if (st.isDirectory()) walk(f); else { total += st.size; files++; }
      });
    })(d);
    return { bytes: total, files: files };
  }
  function norm(p) { return String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase(); }

  function isJob(dir, name) {
    if (STAMP.test(name)) return true;
    return fs.existsSync(path.join(dir, 'out')) || fs.existsSync(path.join(dir, 'src'));
  }
  function sortKey(name, dir) {
    var m = STAMP.exec(name);
    if (m) return m[1] + m[2];
    try { var d = fs.statSync(dir).mtime; return d.toISOString().replace(/\D/g, '').slice(0, 14); } catch (e) { return '0'; }
  }

  /* scan(workDir, keep, usedPaths[]) → { jobs:[{name,dir,key,bytes,files,used,keep}], del:[...], delBytes } */
  function scan(workDir, keep, usedPaths) {
    var jobs = [];
    if (!workDir || !fs.existsSync(workDir)) return { jobs: [], del: [], delBytes: 0 };
    var used = (usedPaths || []).map(norm);
    fs.readdirSync(workDir).forEach(function (n) {
      var d = path.join(workDir, n), st;
      try { st = fs.statSync(d); } catch (e) { return; }
      if (!st.isDirectory() || !isJob(d, n)) return;
      var nd = norm(d) + '\\';
      var sz = dirSize(d);
      jobs.push({ name: n, dir: d, key: sortKey(n, d), bytes: sz.bytes, files: sz.files,
        used: used.some(function (u) { return u.indexOf(nd) === 0; }) });
    });
    jobs.sort(function (a, b) { return a.key < b.key ? 1 : a.key > b.key ? -1 : 0; });   // новые сверху
    keep = Math.max(0, keep | 0);
    var del = [], delBytes = 0;
    jobs.forEach(function (j, i) {
      j.keep = i < keep;
      if (!j.keep && !j.used) { del.push(j); delBytes += j.bytes; }
    });
    return { jobs: jobs, del: del, delBytes: delBytes };
  }

  /* По композиции: plan — ответ LTXP.cleanupPlan (что удалить из AE, какие пути используются).
     Папка генерации удаляется, если её файлы не нужны выбранной композиции и
     (её футаж убирается из проекта  или  includeOrphans и она вообще не в проекте). */
  function planByComp(workDir, plan, includeOrphans) {
    var jobs = scan(workDir, 0, []).jobs;
    function under(paths, j) { var nd = norm(j.dir) + '\\'; return paths.some(function (p) { return norm(p).indexOf(nd) === 0; }); }
    var keep = plan.keepPaths || [], all = plan.allPaths || [];
    var removedPaths = (plan.remove || []).map(function (r) { return r.path; }).filter(Boolean);
    var del = [], delBytes = 0;
    jobs.forEach(function (j) {
      j.used = under(keep, j);
      j.inProject = under(all, j);
      j.keep = j.used || !(under(removedPaths, j) || (includeOrphans && !j.inProject));
      if (!j.keep) { del.push(j); delBytes += j.bytes; }
    });
    return { jobs: jobs, del: del, delBytes: delBytes };
  }

  /* Промежуточные файлы у оставшихся генераций: кадры, отрендеренные из AE (PNG/TIFF/видео),
     маски, нарезка на части, шар Relight. Результат лежит в out/ — его не трогаем.
     Подпапку пропускаем, если на неё ссылается проект AE. */
  var TEMP_DIRS = ['src', 'mask', 'chunks', 'ball', 'composed'];
  function planTemp(jobs, projectPaths) {
    var paths = (projectPaths || []).map(norm), out = [], bytes = 0;
    jobs.forEach(function (j) {
      var od = path.join(j.dir, 'out'), hasOut = false;
      try { hasOut = fs.readdirSync(od).some(function (n) { return /\.(png|exr|tif|tiff)$/i.test(n); }); } catch (e) {}
      if (!hasOut) return;                       // результата нет — не трогаем, вдруг прогон ещё идёт
      var dirs = [], b = 0;
      TEMP_DIRS.forEach(function (n) {
        var d = path.join(j.dir, n);
        if (!fs.existsSync(d)) return;
        var nd = norm(d) + '\\';
        if (paths.some(function (p) { return p.indexOf(nd) === 0; })) return;
        var sz = dirSize(d).bytes; dirs.push(d); b += sz;
      });
      if (dirs.length) { out.push({ name: j.name, dirs: dirs, bytes: b }); bytes += b; }
    });
    return { list: out, bytes: bytes };
  }
  function removeTemp(list) {
    var ok = 0, failed = [];
    list.forEach(function (t) {
      t.dirs.forEach(function (d) { try { g.LTXCore.rmrf(d); } catch (e) {} if (fs.existsSync(d)) failed.push(t.name + '/' + path.basename(d)); });
      ok++;
    });
    return { trimmed: ok, failed: failed };
  }

  function remove(list) {
    var ok = 0, failed = [];
    list.forEach(function (j) {
      try { g.LTXCore.rmrf(j.dir); } catch (e) {}
      if (fs.existsSync(j.dir)) failed.push(j.name + ' (файлы заняты — закройте их в AE/плеере)'); else ok++;
    });
    return { removed: ok, failed: failed };
  }

  g.LTXCleanup = { scan: scan, planByComp: planByComp, planTemp: planTemp, remove: remove, removeTemp: removeTemp };
})(window);
