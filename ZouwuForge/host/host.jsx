/*  Zouwu Forge — ExtendScript-часть (ES3). Все функции: JSON-строка на входе и выходе. */

var LTXP = LTXP || {};

(function () {

    function toJSON(v) {
        var t = typeof v, i, out, k;
        if (v === null || v === undefined) return 'null';
        if (t === 'number') return isFinite(v) ? String(v) : 'null';
        if (t === 'boolean') return v ? 'true' : 'false';
        if (t === 'string') return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
        if (v instanceof Array) { out = []; for (i = 0; i < v.length; i++) out.push(toJSON(v[i])); return '[' + out.join(',') + ']'; }
        out = [];
        for (k in v) if (v.hasOwnProperty(k)) out.push(toJSON(String(k)) + ':' + toJSON(v[k]));
        return '{' + out.join(',') + '}';
    }
    function wrap(fn) {
        return function (argStr) {
            try { return toJSON(fn(argStr ? eval('(' + argStr + ')') : {})); }
            catch (e) { return toJSON({ error: String(e && e.message ? e.message : e) + (e && e.line ? ' (строка ' + e.line + ')' : '') }); }
        };
    }
    function activeComp() {
        var c = app.project.activeItem;
        if (!(c && c instanceof CompItem)) throw new Error('Откройте композицию и кликните по её таймлайну или окну просмотра.');
        return c;
    }
    function findItemById(id) {
        if (app.project.itemByID) { try { return app.project.itemByID(id); } catch (e) {} }
        for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).id === id) return app.project.item(i);
        return null;
    }
    function getBin(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof FolderItem && it.name === name) return it;
        }
        return app.project.items.addFolder(name);
    }
    function imageFiles(folder, re) {
        var list = folder.getFiles(function (f) { return (f instanceof File) && (re || /\.(png|tif|tiff|jpg|jpeg|exr)$/i).test(f.name); });
        list.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
        return list;
    }
    function selectedSpan(comp) {
        var ls = comp.selectedLayers, i, mn = 1e9, mx = -1e9;
        if (!ls || !ls.length) return null;
        for (i = 0; i < ls.length; i++) { if (ls[i].inPoint < mn) mn = ls[i].inPoint; if (ls[i].outPoint > mx) mx = ls[i].outPoint; }
        return { start: Math.max(0, mn), end: Math.min(comp.duration, mx) };
    }
    function scaleLayer(L, s) { L.property('ADBE Transform Group').property('ADBE Scale').setValue([s, s]); }


    /* Ставит модуль вывода в секвенцию кадров и ПРОВЕРЯЕТ, что формат применился.
       Возвращает 'png' | 'tif' | null (не удалось — AE отрендерит видео). */
    function currentFormat(om) {
        try { return String(om.getSettings(GetSettingsFormat.STRING)['Format'] || ''); } catch (e) { return ''; }
    }
    function setSequenceFormat(om, tpl) {
        var tries = [], i, names = [];
        if (tpl) tries.push(function () { om.applyTemplate(tpl); });
        tries.push(function () { om.setSettings({ 'Format': 'PNG Sequence' }); });
        tries.push(function () { om.setSettings({ 'Format': 'PNG' }); });
        try { names = om.templates || []; } catch (e0) {}
        for (i = 0; i < names.length; i++) {
            if (/png/i.test(names[i])) (function (n) { tries.push(function () { om.applyTemplate(n); }); })(names[i]);
        }
        tries.push(function () { om.setSettings({ 'Format': 'TIFF Sequence' }); });
        tries.push(function () { om.setSettings({ 'Format': 'TIFF' }); });
        for (i = 0; i < names.length; i++) {
            if (/tif/i.test(names[i])) (function (n) { tries.push(function () { om.applyTemplate(n); }); })(names[i]);
        }
        FMT_LOG = ['исходно: ' + currentFormat(om)];
        for (i = 0; i < tries.length; i++) {
            try { tries[i](); } catch (e1) { FMT_LOG.push('попытка ' + (i + 1) + ': ' + e1.message); continue; }
            var f = currentFormat(om);
            FMT_LOG.push('попытка ' + (i + 1) + ' → ' + f);
            if (/png/i.test(f)) return 'png';
            if (/tif/i.test(f)) return 'tif';
        }
        // секвенцию поставить не вышло — хотя бы видео без потерь, панель разложит его на кадры
        var lossless = ['Lossless', 'High Quality', 'Lossless with Alpha', 'Без потерь', 'Высокое качество'];
        for (i = 0; i < lossless.length; i++) {
            try { om.applyTemplate(lossless[i]); FMT_LOG.push('шаблон ' + lossless[i] + ' → ' + currentFormat(om)); break; } catch (e2) {}
        }
        return null;
    }
    var FMT_LOG = [];
    function videoFiles(folder) {
        return folder.getFiles(function (f) { return (f instanceof File) && /\.(mp4|mov|avi|mxf|mkv)$/i.test(f.name); });
    }

    /* Диапазон кадров [sF, eF) во внутреннем времени композиции */
    function frameRange(comp, a) {
        var fd = comp.frameDuration, dsf = Math.round(comp.displayStartTime / fd), total = Math.round(comp.duration / fd), sF, eF, span;
        if (a.range === 'comp') { sF = 0; eF = total; }
        else if (a.range === 'selected') {
            span = selectedSpan(comp);
            if (!span) throw new Error('Нет выделенных слоёв в композиции.');
            sF = Math.floor(span.start / fd + 1e-6); eF = Math.ceil(span.end / fd - 1e-6);
        } else if (a.range === 'custom') { sF = Math.round(a.customStart) - dsf; eF = Math.round(a.customEnd) - dsf + 1; }
        else { sF = Math.round(comp.workAreaStart / fd); eF = Math.round((comp.workAreaStart + comp.workAreaDuration) / fd); }
        if (sF < 0) sF = 0;
        if (eF > total) eF = total;
        if (eF <= sF) throw new Error('Пустой диапазон кадров.');
        return { sF: sF, eF: eF };
    }

    /* Рендер композиции comp в PNG-секвенцию [sF, eF) */
    function renderComp(comp, sF, eF, outDir, omTemplate, prefix) {
        var fd = comp.frameDuration;
        var folder = new Folder(outDir);
        if (!folder.exists && !folder.create()) throw new Error('Не удалось создать папку: ' + outDir);
        var rq = app.project.renderQueue, paused = [], i, it;
        for (i = 1; i <= rq.numItems; i++) { it = rq.item(i); if (it.status === RQItemStatus.QUEUED) { it.render = false; paused.push(it); } }
        var item = rq.items.add(comp);
        try {
            try { item.setSettings({ 'Quality': 'Best', 'Resolution': 'Full' }); } catch (e1) { try { item.applyTemplate('Best Settings'); } catch (e2) {} }
            // В новых AE время диапазона рендера считается с учётом начала композиции (displayStartTime),
            // в старых — от нуля. Определяем по значению, которое AE поставил сам.
            var dst = comp.displayStartTime, base = 0;
            if (Math.abs(dst) > fd / 2) {
                var d0 = item.timeSpanStart;
                if (Math.abs(d0 - dst) < fd / 2 || Math.abs(d0 - (dst + comp.workAreaStart)) < fd / 2) base = dst;
            }
            item.timeSpanStart = base + sF * fd;
            item.timeSpanDuration = (eF - sF) * fd;
            var om = item.outputModule(1);
            var seqExt = setSequenceFormat(om, omTemplate);
            try { om.setSettings({ 'Output Audio': 'Off' }); } catch (e5) {}
            om.file = new File(folder.fsName + '/' + (prefix || 'src') + '_[#####].' + (seqExt || 'png'));
            rq.render();
        } finally {
            try { item.remove(); } catch (e6) {}
            for (i = 0; i < paused.length; i++) { try { paused[i].render = true; } catch (e7) {} }
        }
        var files = imageFiles(folder);
        if (files.length) return { count: files.length, ext: files[0].name.replace(/^.*\./, '').toLowerCase() };
        var vids = videoFiles(folder);
        if (vids.length) return { count: 0, video: vids[0].fsName, fmtLog: FMT_LOG.join(' | ') };
        throw new Error('After Effects не записал ни одного кадра. Формат вывода: ' + FMT_LOG.join(' | '));
    }

    function tempComp(name, w, h, src) {
        var c = app.project.items.addComp(name, w, h, src.pixelAspect, src.duration, src.frameRate);
        c.displayStartTime = src.displayStartTime;
        c.parentFolder = getBin('Zouwu Forge (служебное)');
        return c;
    }

    /* ---------- Информация о композиции ---------- */
    LTXP.getCompInfo = wrap(function () {
        var c = activeComp(), fd = c.frameDuration, dsf = Math.round(c.displayStartTime / fd), span = selectedSpan(c), layers = [], i, L;
        for (i = 1; i <= c.numLayers; i++) {
            L = c.layer(i);
            if (L instanceof AVLayer || L instanceof ShapeLayer || L instanceof TextLayer) layers.push({ index: i, name: L.name, hasMask: (L.mask && L.mask.numProperties > 0) || false });
        }
        return {
            id: c.id, name: c.name, width: c.width, height: c.height, pixelAspect: c.pixelAspect, fps: c.frameRate,
            frames: Math.round(c.duration / fd), displayStartFrame: dsf,
            workStart: Math.round(c.workAreaStart / fd) + dsf,
            workEnd: Math.round((c.workAreaStart + c.workAreaDuration) / fd) + dsf - 1,
            curFrame: Math.round(c.time / fd) + dsf,
            selCount: c.selectedLayers ? c.selectedLayers.length : 0,
            selStart: span ? Math.floor(span.start / fd + 1e-6) + dsf : null,
            selEnd: span ? Math.ceil(span.end / fd - 1e-6) + dsf - 1 : null,
            bpc: app.project.bitsPerChannel, layers: layers
        };
    });

    /* Пути всех файлов, которые использует открытый проект (для безопасной очистки) */
    LTXP.usedFootagePaths = wrap(function () {
        var out = [], i, it;
        for (i = 1; i <= app.project.numItems; i++) {
            it = app.project.item(i);
            try { if (it instanceof FootageItem && it.file) out.push(it.file.fsName); } catch (e) {}
        }
        return { paths: out };
    });

    /* ---------- Очистка проекта по композиции ----------
       Всё, что не участвует в выбранной композиции (рекурсивно, с вложенными), и при этом
       является генерацией Zouwu Forge (футаж из рабочей папки или композиция из папок плагина) — кандидаты на удаление. */
    var PLUGIN_BINS = { 'Zouwu Forge Results': 1, 'Zouwu Forge (служебное)': 1, 'LTX Post Results': 1, 'LTX Post (служебное)': 1 };
    function normPath(p) { return String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase(); }
    function inPluginBin(it) {
        var f = it.parentFolder, guard = 0;
        while (f && f !== app.project.rootFolder && guard++ < 50) { if (PLUGIN_BINS[f.name]) return true; f = f.parentFolder; }
        return false;
    }
    LTXP.listComps = wrap(function () {
        var out = [], i, it, act = app.project.activeItem;
        for (i = 1; i <= app.project.numItems; i++) {
            it = app.project.item(i);
            if (it instanceof CompItem && !inPluginBin(it)) out.push({ id: it.id, name: it.name });
        }
        return { comps: out, activeId: (act && act instanceof CompItem) ? act.id : null };
    });
    LTXP.cleanupPlan = wrap(function (a) {
        var root = a.rootId ? findItemById(a.rootId) : activeComp();
        if (!(root && root instanceof CompItem)) throw new Error('Выбранная композиция не найдена');
        var wd = normPath(a.workDir) + '\\';
        var reach = {}, stack = [root], c, i, L, src;
        reach[root.id] = true;
        while (stack.length) {
            c = stack.pop();
            for (i = 1; i <= c.numLayers; i++) {
                L = c.layer(i);
                try { src = L.source; } catch (e) { src = null; }
                if (!src || reach[src.id]) continue;
                reach[src.id] = true;
                if (src instanceof CompItem) stack.push(src);
            }
        }
        var remove = [], keepPaths = [], allPaths = [], it, fp;
        for (i = 1; i <= app.project.numItems; i++) {
            it = app.project.item(i);
            fp = '';
            if (it instanceof FootageItem) { try { if (it.file) fp = it.file.fsName; } catch (e1) {} }
            if (fp) allPaths.push(fp);
            var isGen = (fp && normPath(fp).indexOf(wd) === 0) || (it instanceof CompItem && inPluginBin(it));
            if (!isGen) continue;
            if (reach[it.id]) { if (fp) keepPaths.push(fp); continue; }
            remove.push({ id: it.id, name: it.name, type: it instanceof CompItem ? 'comp' : 'footage', path: fp });
        }
        return { root: root.name, rootId: root.id, remove: remove, keepPaths: keepPaths, allPaths: allPaths };
    });
    LTXP.removeItems = wrap(function (a) {
        var n = 0, i, it, ids = a.ids || [];
        app.beginUndoGroup('Zouwu Forge: очистка генераций');
        try {
            for (i = 0; i < ids.length; i++) { it = findItemById(ids[i]); if (it) { it.remove(); n++; } }
            // пустые папки плагина тоже убираем
            for (i = app.project.numItems; i >= 1; i--) {
                it = app.project.item(i);
                if (it instanceof FolderItem && PLUGIN_BINS[it.name] && it.numItems === 0) it.remove();
            }
        } finally { app.endUndoGroup(); }
        return { removed: n };
    });

    /* Текущий кадр активной композиции в PNG (для помощника) */
    LTXP.grabFrame = wrap(function (a) {
        var c = activeComp(), f = new File(a.path);
        if (f.exists) f.remove();
        c.saveFrameToPng(c.time, f);
        return { path: f.fsName, width: c.width, height: c.height, time: c.time };
    });

    LTXP.listOMTemplates = wrap(function () {
        var comp = null, i;
        if (app.project.activeItem instanceof CompItem) comp = app.project.activeItem;
        for (i = 1; !comp && i <= app.project.numItems; i++) if (app.project.item(i) instanceof CompItem) comp = app.project.item(i);
        if (!comp) return { templates: [] };
        var it = app.project.renderQueue.items.add(comp), t = [], out = [];
        try { t = it.outputModule(1).templates; } finally { it.remove(); }
        for (i = 0; i < t.length; i++) if (t[i] && t[i].indexOf('_HIDDEN') !== 0) out.push(t[i]);
        return { templates: out };
    });

    /* ---------- Подготовка входов и рендер ----------
       a: {range, customStart, customEnd, srcDir, maskDir, omTemplate, mode: 'plain'|'mask'|'outpaint', maskLayer, pads:{l,r,t,b}} */
    LTXP.renderInputs = wrap(function (a) {
        var comp = activeComp(), r = frameRange(comp, a), res = { compId: comp.id, startFrame: r.sF, frames: r.eF - r.sF, startTime: r.sF * comp.frameDuration, fps: comp.frameRate, width: comp.width, height: comp.height };
        var temps = [], hidden = [];
        try {
            // слои, которые не должны попасть в рендер исходника (маска и образец для «Заменить по образцу»)
            for (var hi = 0; a.hideLayers && hi < a.hideLayers.length; hi++) {
                var HL = null; try { HL = comp.layer(a.hideLayers[hi]); } catch (eH) {}
                if (HL && HL.enabled) { HL.enabled = false; hidden.push(HL); }
            }
            if (a.mode === 'outpaint') {
                var p = a.pads, l = Math.round(comp.width * p.l / 100), rr = Math.round(comp.width * p.r / 100),
                    t = Math.round(comp.height * p.t / 100), b = Math.round(comp.height * p.b / 100);
                if (l + rr + t + b === 0) throw new Error('Для outpaint задайте расширение хотя бы с одной стороны.');
                var W = comp.width + l + rr, H = comp.height + t + b;
                if (W > 30000 || H > 30000) throw new Error('Слишком большой холст.');
                // кадр: исходник по центру нового холста; новая область закрыта маской
                var big = tempComp('LTX outpaint кадр', W, H, comp); temps.push(big);
                var SL = big.layers.add(comp);
                SL.property('ADBE Transform Group').property('ADBE Position').setValue([l + comp.width / 2, t + comp.height / 2]);
                var mk = tempComp('LTX outpaint маска', W, H, comp); temps.push(mk);
                mk.layers.addSolid([1, 1, 1], 'новая область', W, H, comp.pixelAspect);
                var hole = mk.layers.addSolid([0, 0, 0], 'исходник', comp.width, comp.height, comp.pixelAspect);
                hole.property('ADBE Transform Group').property('ADBE Position').setValue([l + comp.width / 2, t + comp.height / 2]);
                res.src = renderComp(big, r.sF, r.eF, a.srcDir, a.omTemplate, 'src');
                res.mask = renderComp(mk, r.sF, r.eF, a.maskDir, a.omTemplate, 'mask');
                res.width = W; res.height = H; res.offset = [l, t];
            } else {
                res.src = renderComp(comp, r.sF, r.eF, a.srcDir, a.omTemplate, 'src');
                if (a.mode === 'mask') {
                    var ML = comp.layer(a.maskLayer);
                    if (!ML) throw new Error('Слой-маска не найден. Обновите список слоёв.');
                    var mc = tempComp('LTX маска', comp.width, comp.height, comp); temps.push(mc);
                    mc.layers.addSolid([0, 0, 0], 'фон', comp.width, comp.height, comp.pixelAspect);
                    // слой с трек-маттом (AE 2023+): копируем и матт, иначе прозрачность потеряется
                    var TM = null, tmType = null;
                    try { if (ML.trackMatteLayer) { TM = ML.trackMatteLayer; tmType = ML.trackMatteType; } } catch (eT) {}
                    if (TM) { TM.copyToComp(mc); }
                    ML.copyToComp(mc);
                    var copied = mc.layer(1);
                    copied.enabled = true;
                    if (TM) { try { copied.setTrackMatte(mc.layer(2), tmType); mc.layer(2).enabled = false; } catch (eS) {} }
                    if (copied.isTrackMatte) { try { copied.isTrackMatte = false; } catch (e0) {} }
                    var fill = copied.property('ADBE Effect Parade').addProperty('ADBE Fill');
                    fill.property('ADBE Fill-0002').setValue([1, 1, 1, 1]);
                    try { copied.blendingMode = BlendingMode.NORMAL; copied.property('ADBE Transform Group').property('ADBE Opacity').setValue(100); } catch (e1) {}
                    res.mask = renderComp(mc, r.sF, r.eF, a.maskDir, a.omTemplate, 'mask');
                }
            }
        } finally {
            for (var i = 0; i < temps.length; i++) { try { temps[i].remove(); } catch (e2) {} }
            for (var j = 0; j < hidden.length; j++) { try { hidden[j].enabled = true; } catch (e3) {} }
        }
        return res;
    });

    /* Слой (видео-образец) отдельно, с его первого кадра: PNG-секвенция до maxFrames кадров */
    LTXP.renderLayerSeq = wrap(function (a) {
        var comp = activeComp(), L = comp.layer(a.layer);
        if (!L) throw new Error('Слой-образец не найден. Обновите список слоёв.');
        var tc = tempComp('Zouwu Forge образец движения (временная)', comp.width, comp.height, comp);
        try {
            tc.displayStartTime = 0;
            L.copyToComp(tc);
            var c = tc.layer(1);
            c.enabled = true;
            try { if (c.isTrackMatte) c.isTrackMatte = false; } catch (e0) {}
            c.startTime = c.startTime - c.inPoint;            // слой начинается с нуля временной композиции
            var fd = tc.frameDuration, avail = Math.floor((c.outPoint - c.inPoint) / fd + 1e-6);
            var n = Math.max(1, Math.min(avail, a.maxFrames || avail));
            tc.duration = Math.max(n * fd, fd);
            var r = renderComp(tc, 0, n, a.dir, a.omTemplate, 'ref');
            return { src: r, frames: n, available: avail, fps: tc.frameRate };
        } finally {
            try { tc.remove(); } catch (e1) {}
        }
    });

    /* Слой целиком (с прозрачностью) в PNG — образец для «Заменить по образцу».
       saveFrameToPng пишет файл асинхронно, поэтому временную композицию удаляем при следующем вызове / импорте. */
    var REF_COMP = 'Zouwu Forge образец (временная)';
    function removeRefComps() {
        for (var i = app.project.numItems; i >= 1; i--) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === REF_COMP) { try { it.remove(); } catch (e) {} }
        }
    }
    LTXP.exportLayerPng = wrap(function (a) {
        removeRefComps();
        var comp = activeComp(), L = comp.layer(a.layer);
        if (!L) throw new Error('Слой-образец не найден. Обновите список слоёв.');
        var tc = tempComp(REF_COMP, comp.width, comp.height, comp);
        L.copyToComp(tc);
        var c = tc.layer(1);
        c.enabled = true;
        try { if (c.isTrackMatte) c.isTrackMatte = false; } catch (e0) {}
        var t = comp.time;
        if (t < c.inPoint || t >= c.outPoint) t = c.inPoint;   // под плейхедом слоя нет — берём его первый кадр
        var f = new File(a.path);
        if (f.exists) f.remove();
        tc.saveFrameToPng(t, f);
        return { path: f.fsName, time: t };
    });

    /* ---------- Импорт результата и сборка новой композиции ----------
       a: {dir, compId, compName, fps, startTime, mode:'plain'|'matte'|'hdr'|'outpaint', to32, addToSource, fitW, fitH, offset} */
    LTXP.importResult = wrap(function (a) {
        try { removeRefComps(); } catch (eR) {}
        var folder = new Folder(a.dir);
        var files = imageFiles(folder, a.mode === 'hdr' ? /\.exr$/i : /\.png$/i);
        if (!files.length) throw new Error('В папке результата нет кадров: ' + a.dir);
        var src = findItemById(a.compId);

        app.beginUndoGroup('Zouwu Forge: импорт результата');
        try {
            if (a.mode === 'hdr' && a.to32) app.project.bitsPerChannel = 32;
            var io = new ImportOptions(files[0]);
            io.sequence = true; io.forceAlphabetical = true;
            var foot = app.project.importFile(io);
            foot.mainSource.conformFrameRate = a.fps;
            foot.name = a.compName + ' — кадры';
            var bin = getBin('Zouwu Forge Results');
            foot.parentFolder = bin;

            var W = a.fitW || foot.width, H = a.fitH || foot.height, dur = files.length / a.fps;
            var comp = app.project.items.addComp(a.compName, W, H, src ? src.pixelAspect : 1, dur, a.fps);
            comp.parentFolder = bin;
            if (src) { try { comp.displayStartTime = src.displayStartTime + a.startTime; } catch (e0) {} }

            var L = comp.layers.add(foot);
            L.name = a.mode === 'matte' ? 'Альфа (LTX)' : 'LTX';
            // результат приходит в рабочем разрешении — растягиваем точно под кадр
            var sx = W / foot.width * 100, sy = H / foot.height * 100;
            L.property('ADBE Transform Group').property('ADBE Scale').setValue([sx, sy]);

            if (a.mode === 'matte' && src) {
                var S = comp.layers.add(src);       // над маской
                S.name = 'Исходник';
                S.startTime = -a.startTime;
                scaleLayer(S, W / src.width * 100);
                L.moveBefore(S);                    // маска над исходником
                if (typeof S.setTrackMatte === 'function') S.setTrackMatte(L, TrackMatteType.LUMA);
                else { L.moveBefore(S); S.trackMatteType = TrackMatteType.LUMA; }
            }

            var added = false;
            if (a.addToSource && src && a.mode !== 'outpaint') {
                var R = src.layers.add(foot);
                R.name = 'LTX — ' + a.compName;
                R.startTime = a.startTime;
                R.property('ADBE Transform Group').property('ADBE Scale').setValue([src.width / foot.width * 100, src.height / foot.height * 100]);
                if (a.mode === 'matte') R.enabled = false;
                added = true;
            }
            try { comp.openInViewer(); } catch (e1) {}
            return { comp: comp.name, width: W, height: H, frames: files.length, addedToSource: added };
        } finally {
            app.endUndoGroup();
        }
    });

})();
