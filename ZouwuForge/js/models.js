/* Zouwu Forge — каталог моделей и пресеты под видеокарты.
   Все файлы — официальные Lightricks/LTX-2.5 (кроме GGUF-квантов трансформера). */
(function (g) {
  'use strict';
  var GB = 1073741824;

  // loader: 'unet' (UNETLoader) | 'gguf' (UnetLoaderGGUF, нужен ComfyUI-GGUF)
  var TRANSFORMERS = [
    { id: 'bf16', label: 'bf16 — эталон, 42 ГБ (32 ГБ+ VRAM)', repo: 'Lightricks/LTX-2.5', path: 'diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors', dir: 'diffusion_models', size: 42.0, loader: 'unet' },
    { id: 'int8', label: 'int8 — почти без потерь, 21.5 ГБ (16–24 ГБ)', repo: 'Lightricks/LTX-2.5', path: 'diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors', dir: 'diffusion_models', size: 21.5, loader: 'unet' },
    { id: 'nvfp4', label: 'NVFP4 — только RTX 50, 18.7 ГБ, быстро', repo: 'Lightricks/LTX-2.5', path: 'diffusion_models/ltx-2.5-22b-distilled-transformer-nvfp4.safetensors', dir: 'diffusion_models', size: 18.7, loader: 'unet', blackwell: true },
    { id: 'q8', label: 'GGUF Q8_0 — ≈bf16, 23.6 ГБ', repo: 'Abiray/LTX-2.5-Distilled-GGUF', path: 'LTX-2.5-Distilled-Q8_0.gguf', dir: 'diffusion_models', size: 23.6, loader: 'gguf' },
    { id: 'q6', label: 'GGUF Q6_K — 18.6 ГБ', repo: 'Abiray/LTX-2.5-Distilled-GGUF', path: 'LTX-2.5-Distilled-Q6_K.gguf', dir: 'diffusion_models', size: 18.6, loader: 'gguf' },
    { id: 'q5', label: 'GGUF Q5_K_M — 18.1 ГБ', repo: 'Abiray/LTX-2.5-Distilled-GGUF', path: 'LTX-2.5-Distilled-Q5_K_M.gguf', dir: 'diffusion_models', size: 18.1, loader: 'gguf' },
    { id: 'q4', label: 'GGUF Q4_K_M — 15.7 ГБ (12–16 ГБ)', repo: 'Abiray/LTX-2.5-Distilled-GGUF', path: 'LTX-2.5-Distilled-Q4_K_M.gguf', dir: 'diffusion_models', size: 15.7, loader: 'gguf' },
    { id: 'q3', label: 'GGUF Q3_K_S — 12.6 ГБ (8–12 ГБ, заметные потери)', repo: 'Abiray/LTX-2.5-Distilled-GGUF', path: 'LTX-2.5-Distilled-Q3_K_S.gguf', dir: 'diffusion_models', size: 12.6, loader: 'gguf' }
  ];
  var ENCODERS = [
    { id: 'bf16', label: 'Gemma 4 12B bf16 — 26.3 ГБ', repo: 'Lightricks/LTX-2.5', path: 'text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors', dir: 'text_encoders', size: 26.3 },
    { id: 'int8', label: 'Gemma 4 12B int8 — 15.4 ГБ', repo: 'Lightricks/LTX-2.5', path: 'text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors', dir: 'text_encoders', size: 15.4 }
  ];
  var VAES = [
    { id: 'std', label: 'Стандартный bf16 — лучшее качество', repo: 'Lightricks/LTX-2.5', path: 'vae/ltx-2.5-video-vae-bf16.safetensors', dir: 'vae', size: 1.5 },
    { id: 'conv', label: 'Облегчённый conv bf16 — меньше памяти', repo: 'Lightricks/LTX-2.5', path: 'vae/ltx-2.5-video-vae-conv-bf16.safetensors', dir: 'vae', size: 1.5 }
  ];
  var AUDIO_VAE = { id: 'audio', label: 'Аудио-VAE', repo: 'Lightricks/LTX-2.5', path: 'vae/ltx-2.5-audio-vae-bf16.safetensors', dir: 'vae', size: 0.4 };
  var UPSCALER = { id: 'up', label: 'Латентный апскейлер ×2 (второй проход)', repo: 'Lightricks/LTX-2.5', path: 'latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors', dir: 'latent_upscale_models', size: 1.0 };

  // IC-LoRA инструментов (id совпадают с LTXTools)
  var LORAS = {
    camera: { repo: 'Muapi/camera-controls-ltx-2.3', path: 'camera-controls-ltx-2.3.safetensors',
      extra: { repo: 'Lightricks/LTX-2.5-22b-LoRA-Cinemagraph', path: 'ltx-2.5-22b-lora-cinemagraph-0.9.safetensors', dir: 'loras' } },
    prompt: { repo: 'Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control', path: 'ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors',
      // режимы «Правка по описанию» и «Заменить по образцу» (Alissonerdx/LTX-LoRAs, Apache-2.0)
      extras: [
        { label: 'LoRA Edit Anything (правка по описанию)', repo: 'Alissonerdx/LTX-LoRAs', path: 'ltx23_edit_anything_global_rank128_v1_9000steps_adamw.safetensors', dir: 'loras', size: 1.31 },
        { label: 'LoRA замены по образцу (R2V)', repo: 'Alissonerdx/LTX-LoRAs', path: 'ltx23_inpaint_masked_r2v_rank32_v1_3000steps.safetensors', dir: 'loras', size: 0.33 }
      ] },
    camxfer: { repo: 'Cseti/LTX2.3-22B_IC-LoRA-Cameraman_v2', path: 'LTX2.3-22B_IC-LoRA-Cameraman_v2_14000.safetensors' },
    deblur: { repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Deblur', path: 'ltx-2.5-22b-ic-lora-deblur-0.9.safetensors' },
    decompression: { repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Decompression', path: 'ltx-2.5-22b-ic-lora-decompression-0.9.safetensors' },
    restore: { repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Restore', path: 'ltx-2.5-22b-ic-lora-restore-1.0.safetensors' },
    refine: { repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Refine-Details', path: 'ltx-2.5-22b-ic-lora-refine-details-1.0.safetensors' },
    upscale: { repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler', path: 'ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors' },
    colorize: { repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Colorization', path: 'ltx-2.5-22b-ic-lora-colorization-0.9.safetensors' },
    alpha: { repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Alpha-Gen', path: 'ltx-2.5-22b-ic-lora-alpha-gen-0.9.safetensors' },
    cleanplate: { repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Clean-Plate', path: 'ltx-2.5-22b-ic-lora-clean-plate-1.0.safetensors' },
    inpaint: { repo: 'Lightricks/LTX-2.3-22b-IC-LoRA-In-Outpainting', path: 'ltx-2.3-22b-ic-lora-in-outpainting-0.9.safetensors' },
    relight: { repo: 'Lightricks/LTX-2.3-22b-IC-LoRA-Relight', path: 'ltx-2.3-22b-ic-lora-relight-1.0.safetensors' },
    daynight: { repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Day-To-Night', path: 'ltx-2.5-22b-ic-lora-day-to-night-0.9.safetensors' },
    hdr: { repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-SDR-To-HDR', path: 'ltx-2.5-22b-ic-lora-sdr-to-hdr-1.0.safetensors',
      extra: { repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-SDR-To-HDR', path: 'ltx-2.5-22b-ic-lora-sdr-to-hdr-scene-emb.safetensors', dir: 'embeddings' } },
    water: { repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Water-Simulation', path: 'ltx-2.5-22b-ic-lora-water-simulation-0.9.safetensors' }
  };

  /* Пресеты: transformer, encoder, encoderCpu, vae, outSide (короткая сторона результата),
     chunkLen, tileSize, lowvram */
  var TIERS = [
    { id: 'ultra', label: 'Максимум — 32 ГБ+ (RTX 5090, RTX 6000)', hint: 'Полная точность. Нужно 64+ ГБ ОЗУ.',
      v: { transformer: 'bf16', encoder: 'bf16', encoderCpu: false, vae: 'std', outSide: 1088, chunkLen: 121, tileSize: 768, lowvram: false } },
    { id: 'rtx50', label: 'RTX 50 — 16 ГБ+ (5080, 5070 Ti, 5090)', hint: 'NVFP4 работает только на Blackwell (RTX 50). Быстро и экономно.',
      v: { transformer: 'nvfp4', encoder: 'int8', encoderCpu: false, vae: 'std', outSide: 720, chunkLen: 97, tileSize: 512, lowvram: false } },
    { id: 'gb24', label: '24 ГБ (RTX 3090 / 4090)', hint: 'int8 помещается целиком.',
      v: { transformer: 'int8', encoder: 'int8', encoderCpu: false, vae: 'std', outSide: 1088, chunkLen: 97, tileSize: 512, lowvram: false } },
    { id: 'gb16', label: '16 ГБ (RTX 4080 / 4070 Ti Super) + 64 ГБ ОЗУ', hint: 'int8, часть весов в ОЗУ. Второй проход в 720p.',
      v: { transformer: 'int8', encoder: 'int8', encoderCpu: false, vae: 'std', outSide: 720, chunkLen: 73, tileSize: 512, lowvram: false } },
    { id: 'gb12', label: '12 ГБ и меньше (RTX 3060 / 4070) + 32 ГБ ОЗУ', hint: 'GGUF Q4, энкодер на процессоре, облегчённый VAE. Медленно, но работает.',
      v: { transformer: 'q4', encoder: 'int8', encoderCpu: true, vae: 'conv', outSide: 544, chunkLen: 49, tileSize: 256, lowvram: true } },
    { id: 'custom', label: 'Свой набор', hint: 'Выберите компоненты вручную ниже.', v: null }
  ];

  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return list[0]; }
  function fileName(m) { return m.path.split('/').pop(); }

  // Список файлов к скачиванию под текущий выбор
  function selectedFiles(s) {
    var out = [];
    function push(m, dir) { out.push({ label: m.label || fileName(m), repo: m.repo, path: m.path, dir: dir || m.dir, file: fileName(m), size: m.size || 0.5 }); }
    push(byId(TRANSFORMERS, s.transformer));
    push(byId(ENCODERS, s.encoder));
    push(byId(VAES, s.vae));
    push(AUDIO_VAE);
    push(UPSCALER);
    (s.toolsToInstall || Object.keys(LORAS)).forEach(function (id) {
      var l = LORAS[id]; if (!l) return;
      push({ label: (id === 'camera' ? 'LoRA камеры (пан/тилт/зум)' : id === 'camxfer' ? 'IC-LoRA переноса камеры (Cameraman, некоммерческая)' : 'IC-LoRA ' + id), repo: l.repo, path: l.path, size: id === 'camera' ? 0.35 : 0.7 }, 'loras');
      (l.extras || []).forEach(function (x) { push(x, x.dir); });
      if (l.extra) push({ label: id === 'hdr' ? 'эмбеддинги HDR' : 'LoRA ' + l.extra.path.split('/').pop().replace('.safetensors', ''), repo: l.extra.repo, path: l.extra.path, size: id === 'hdr' ? 0.1 : 0.7 }, l.extra.dir);
    });
    return out;
  }

  // Суммарный размер выбора, ГБ
  function totalSize(s) { return selectedFiles(s).reduce(function (a, f) { return a + f.size; }, 0); }

  /* ---------- Простой выбор: поколение видеокарты + объём видеопамяти ----------
     Без названий конкретных моделей: пользователь выбирает «RTX 50 / 40 / 30» и «8…32+ ГБ»,
     набор моделей подбирается сам. Ручной выбор компонентов — в «Настроить вручную». */
  var GENS = [
    ['50', 'RTX 50'],
    ['40', 'RTX 40'],
    ['30', 'RTX 30 и старше']
  ];
  var VRAMS = [
    [8, '8 ГБ'], [12, '12 ГБ'], [16, '16 ГБ'], [24, '24 ГБ'], [32, '32 ГБ и больше']
  ];
  function detectGen(gpu) {
    var n = (gpu && gpu.name) || '';
    if (/Blackwell/i.test(n)) return '50';
    if (/Ada/i.test(n)) return '40';
    var m = /RTX\s*([2-5])0\d0/i.exec(n);
    if (m) return m[1] === '5' ? '50' : (m[1] === '4' ? '40' : '30');
    return '30';
  }
  function detectVram(gpu) {
    var v = (gpu && gpu.vram) || 16, best = 8;
    VRAMS.forEach(function (x) { if (v >= x[0] - 1) best = x[0]; });
    return best;
  }
  // Набор под поколение и память. NVFP4 — только RTX 50 (Blackwell), он же самый быстрый там.
  function presetFor(gen, vram) {
    var b = gen === '50';
    var p;
    if (vram >= 32) p = { transformer: 'bf16', encoder: 'bf16', encoderCpu: false, vae: 'std', outSide: 1088, chunkLen: 121, tileSize: 768, lowvram: false,
      hint: 'Полная точность модели и энкодера. Нужно 64 ГБ+ оперативной памяти.' };
    else if (vram >= 24) p = { transformer: b ? 'nvfp4' : 'int8', encoder: 'int8', encoderCpu: false, vae: 'std', outSide: 1088, chunkLen: 97, tileSize: 512, lowvram: false,
      hint: b ? 'NVFP4 (формат RTX 50) — быстро и экономно, итог 1088p.' : 'int8 — почти без потерь, итог 1088p.' };
    else if (vram >= 16) p = { transformer: b ? 'nvfp4' : 'int8', encoder: 'int8', encoderCpu: false, vae: 'std', outSide: 720, chunkLen: b ? 97 : 73, tileSize: 512, lowvram: false,
      hint: (b ? 'NVFP4 (формат RTX 50) — быстро.' : 'int8 — часть весов уходит в оперативную память (нужно 64 ГБ ОЗУ).') + ' Итог 720p.' };
    else if (vram >= 12) p = { transformer: 'q4', encoder: 'int8', encoderCpu: true, vae: 'conv', outSide: 544, chunkLen: 49, tileSize: 256, lowvram: true,
      hint: 'Сжатая модель GGUF Q4, энкодер на процессоре, облегчённый VAE. Итог 544p, нужно 32 ГБ+ ОЗУ. Медленно, но работает.' };
    else p = { transformer: 'q3', encoder: 'int8', encoderCpu: true, vae: 'conv', outSide: 544, chunkLen: 25, tileSize: 256, lowvram: true,
      hint: 'Минимум: GGUF Q3 (заметные потери качества), короткие куски по 25 кадров. Нужно 32 ГБ+ ОЗУ.' };
    return p;
  }

  // Подбор пресета по видеокарте (nvidia-smi)
  function suggestTier(gpu) {
    if (!gpu) return 'gb16';
    var n = gpu.name || '', v = gpu.vram || 0;
    if (v >= 30) return 'ultra';
    if (/RTX\s*50/i.test(n) && v >= 15) return 'rtx50';
    if (v >= 22) return 'gb24';
    if (v >= 15) return 'gb16';
    return 'gb12';
  }

  g.LTXModels = { GENS: GENS, VRAMS: VRAMS, detectGen: detectGen, detectVram: detectVram, presetFor: presetFor,
    TRANSFORMERS: TRANSFORMERS, ENCODERS: ENCODERS, VAES: VAES, AUDIO_VAE: AUDIO_VAE, UPSCALER: UPSCALER, LORAS: LORAS, TIERS: TIERS,
    byId: byId, fileName: fileName, selectedFiles: selectedFiles, totalSize: totalSize, suggestTier: suggestTier, GB: GB
  };
})(typeof window !== 'undefined' ? window : global);
