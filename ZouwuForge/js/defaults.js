/* Zouwu Forge — настройки по умолчанию (пресет подбирается по видеокарте при первом запуске) */
(function (g) {
  var A = g.LTXCore;
  g.LTXDefaults = {
    // модели
    tier: '',                 // пусто → подобрать по видеокарте
    transformer: 'int8',
    encoder: 'int8',
    encoderCpu: false,
    vae: 'std',
    lowvram: false,
    llm: '',                  // помощник: '' — выкл, '4b' / '8b' — Qwen3-VL
    toolsToInstall: ['prompt', 'camera', 'deblur', 'decompression', 'restore', 'refine', 'upscale', 'colorize', 'alpha', 'cleanplate', 'inpaint', 'relight', 'daynight', 'hdr', 'water', 'zupscale', 'detext'],
    // качество
    stage2: true,             // апскейл: латентный апскейлер ×2 + доработка
    anchor: true,             // опора на исходник при апскейле
    overlap: 17,              // склейка частей внахлёст: 0 — выкл, 9 / 17 / 25 кадров
    contStrength: 0.85,       // сила продолжения конца предыдущей части
    memMode: 'auto',          // память движка: auto | nodyn (--disable-dynamic-vram) | nodyn-pin (+ --disable-pinned-memory)
    chunkFF: true,
    sage: false,
    memFactor: 'auto',        // запас видеопамяти под длинные куски (нода ZFMemoryFactor): auto | 1 | 1.5 | 2 | 3
    preview: false,           // живое превью генерации (TAE taeltx2_3 + KJNodes)
    stage2ByTool: {},         // апскейл по инструментам (по умолчанию — t.stage2Default)              // Sage Attention (--use-sage-attention), ставится кнопкой в настройках            // LTXVChunkFeedForward: меньше пик видеопамяти → меньше выгрузки в ОЗУ на 16 ГБ
    detail: 1,                // проработка: 1 — 8+3 шага (как в оригинале), 2 — 12+6, 3 — 16+9
    resMode: 'preset',        // разрешение всегда из трёх (outSide 544/720/1088), ориентация — из композиции
    outSide: 720,             // короткая сторона результата
    chunkLen: 73,
    tileSize: 512,
    seed: 42,
    randomSeed: false,
    // DLSS 5
    dlss: { preset: 'default', factor: '1', nr_style: 'Default', nr_preset: 'Default', nr_intensity: 1.0, local_tone_strength: 1.0, local_structure_strength: 1.5, skin_structure_strength: -1, warmup: 32 },
    // файлы
    // результаты и секвенции: рядом с программой (папка install.bat), иначе Документы\Zouwu_Forge
    workDir: (A.installRoot && A.installRoot()) ? A.path.join(A.installRoot(), 'Results') : A.path.join(require('os').homedir(), 'Documents', 'Zouwu_Forge'),
    omTemplate: '',
    cleanupSource: true,
    cleanMode: 'comp',        // очистка: 'comp' — всё, что не в композиции; 'count' — старые прогоны
    cleanOrphans: false,
    cleanTemp: true,          // очистка: убирать src/chunks/mask у оставшихся генераций
    cleanupKeep: 5,           // очистка генераций: сколько последних оставить
    cleanupProtect: true,     // не трогать то, что лежит в открытом проекте AE
    // окно инструментов
    tool: 'prompt',
    fieldsByTool: {},
    strengthByTool: {},
    outModeByTool: {},
    range: 'workarea',
    customStart: 0,
    customEnd: 0,
    addToSource: false,
    newComp: true,            // результат — новая композиция (выкл. — только слой в исходной)
    queue: []                 // очередь заданий окна инструментов
  };
  g.LTXStore = A.settingsStore('settings', g.LTXDefaults);
  g.LTX_IDS = { RUN: 'com.zouwu.forge.run', SETTINGS: 'com.zouwu.forge.settings' };

  // Текущие файлы моделей по настройкам
  g.LTXCurrentModels = function (s) {
    var Mo = g.LTXModels;
    var tr = Mo.byId(Mo.TRANSFORMERS, s.transformer);
    return {
      unet: Mo.fileName(tr), loader: tr.loader,
      clip: Mo.fileName(Mo.byId(Mo.ENCODERS, s.encoder)), clipDevice: s.encoderCpu ? 'cpu' : 'default',
      vae: Mo.fileName(Mo.byId(Mo.VAES, s.vae)), audioVae: Mo.fileName(Mo.AUDIO_VAE),
      upscaler: Mo.fileName(Mo.UPSCALER)
    };
  };
  // Флаги запуска движка: режим памяти + «малая видеопамять». Неподдерживаемые версией ComfyUI отбрасываются при старте.
  // Sage Attention: установлена и прошла тест на видеокарте (py/sage_setup.py пишет sage.json)
  g.LTXSageOk = function () {
    try { return !!JSON.parse(require('fs').readFileSync(A.path.join(A.APPDIR, 'sage.json'), 'utf8')).ok; } catch (e) { return false; }
  };
  g.LTXEngineArgs = function (s) {
    var a = [];
    if (s.lowvram) a.push('--lowvram');
    if (s.memMode === 'nodyn') a.push('--disable-dynamic-vram');
    if (s.memMode === 'nodyn-pin') { a.push('--disable-dynamic-vram'); a.push('--disable-pinned-memory'); }
    if (s.sage && g.LTXSageOk()) a.push('--use-sage-attention');
    return a;
  };
})(window);
