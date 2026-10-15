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
    toolsToInstall: ['prompt', 'camera', 'deblur', 'decompression', 'restore', 'refine', 'upscale', 'colorize', 'alpha', 'cleanplate', 'inpaint', 'relight', 'daynight', 'hdr', 'water'],
    // качество
    stage2: true,             // второй проход: латентный апскейлер ×2 + доработка
    anchor: true,             // опора на исходник во втором проходе
    detail: 1,                // проработка: 1 — 8+3 шага (как в оригинале), 2 — 12+6, 3 — 16+9
    resMode: 'preset',        // разрешение: 'preset' — outSide; 'auto' — как в композиции; 'custom' — customSide
    customSide: 720,          // своя короткая сторона (256…1088)
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
    addToSource: false
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
  g.LTXEngineArgs = function (s) { return s.lowvram ? ['--lowvram'] : []; };
})(window);
