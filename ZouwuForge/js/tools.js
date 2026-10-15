/* Zouwu Forge — реестр инструментов LTX 2.5 и сборка графов ComfyUI.
   Графы повторяют официальные воркфлоу ComfyUI-LTXVideo (2.5, distilled),
   развёрнутые из подграфов в плоский API-формат.                               */
(function (g) {
  'use strict';

  // Модели под RTX 4080 16 ГБ + 64 ГБ ОЗУ (официальные int8-convrot, часть весов уходит в ОЗУ)
  var SIGMAS_8 = '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0';
  // Частичное зашумление для «перерисовки»: хвост расписания distilled-модели начиная с силы изменения
  var DENOISE_GRID = [1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.8, 0.725, 0.6, 0.5, 0.421875, 0.3, 0.15, 0.0];
  var RESTYLE_DIRECT_MAX = 0.75;   // до этой силы перерисовка идёт одним проходом в полном разрешении
  function denoiseSigmas(d) {
    d = Math.max(0.15, Math.min(1, d));
    var out = [d];
    DENOISE_GRID.forEach(function (v) { if (v < d - 1e-6) out.push(v); });
    return out.map(function (v) { return String(+v.toFixed(6)); }).join(', ');
  }
  // LoRA сообщества (Alissonerdx/LTX-LoRAs, Apache-2.0, обучены на LTX 2.3) для режимов V2V
  var EDIT_LORAS = {
    edit: 'ltx23_edit_anything_global_rank128_v1_9000steps_adamw.safetensors',     // правка по описанию
    replace: 'ltx23_inpaint_masked_r2v_rank32_v1_3000steps.safetensors'             // замена по маске + образцу
  };
  var EDIT_COLORS = { mask: [255, 0, 255], ref: [0, 255, 0] };   // как требует автор: пурпурная маска, зелёный фон образца
  // Второй проход официальных двухстадийных графов LTX 2.5 (после латентного апскейла ×2)
  var SIGMAS_STAGE2 = '0.909375, 0.725, 0.421875, 0.0';

  /* «Проработка»: больше шагов семплера. Distilled-модель обучена на 8 шагов, поэтому расписание
     не заменяется, а уплотняется: крупные интервалы шума (где формируются детали) делятся на части,
     мелкие стартовые (1.0…0.975) не трогаются. detail: 1 — как в оригинале, 2 — ~×1.5 шагов, 3 — ~×2. */
  function refineSigmas(str, detail) {
    detail = Math.max(1, Math.min(3, detail | 0 || 1));
    if (detail === 1) return str;
    var v = String(str).split(',').map(function (x) { return parseFloat(x); }).filter(function (x) { return !isNaN(x); });
    var out = [v[0]];
    for (var i = 1; i < v.length; i++) {
      var a = v[i - 1], b = v[i], gap = a - b;
      var parts = gap > 0.05 ? detail : 1;
      for (var k = 1; k < parts; k++) out.push(a - gap * k / parts);
      out.push(b);
    }
    return out.map(function (x) { return String(+x.toFixed(6)); }).join(', ');
  }
  function stepCount(str) { return String(str).split(',').length - 1; }

  /* Поле формы: {key, label, type: text|area|number|range|select|check, ...} */
  var SCENE = { key: 'scene', label: 'Что в кадре', type: 'area', placeholder: 'например: мужчина в капюшоне идёт по ночной улице с сумкой', required: true, ai: 'scene' };

  /* Задания помощнику (ЛЛМ со зрением) для кнопки «Описать» у текстовых полей.
     Ответ — на английском: так его лучше понимает модель LTX. */
  var AI_TASKS = {
    scene: 'Describe what is in this video frame in one concise English sentence: the main subjects, what they are doing and the setting. Plain visual description, no style or quality words.',
    v2v: 'Write an English prompt for a video model describing this shot as a whole: subjects and their actions, setting, lighting, framing and mood. Two or three concrete visual sentences.',
    camera: 'Write an English prompt for a short video that starts from this frame: the subject, the setting and what naturally moves next (gestures, hair, wind, light, background life). One or two sentences in present tense. Do not mention camera movement.',
    look: 'Describe the visual look of this frame in a few English words: color grade, contrast, film or digital character. Example: warm cinematic grade, soft contrast, 35mm film.',
    colors: 'This frame is black-and-white. List plausible natural colors for its main objects in English, comma-separated. Example: dark green jacket, red hair, beige walls, warm sunset sky.',
    empty: 'Describe this scene in one English sentence as if all people and moving objects were removed: only the empty environment.',
    remove: 'List in English, comma-separated and short, the people and moving objects in this frame that should be removed to get an empty background plate.',
    night: 'In a few English words, suggest how this exact place would be lit at night: light sources and their colors.',
    water: 'In one English sentence, suggest how realistic water or flooding could look in this scene.',
    fill: 'In a short English phrase, suggest what would naturally fit in this scene in place of the object or empty area the user wants to replace.',
    edit: 'Look at this video frame and suggest ONE useful edit as a single English sentence in the style of a video-editing caption. Start with exactly one verb: Add, Remove, Replace or Convert. Patterns: "Add a/an [object] with [visual attributes], [pose], [precise location]." / "Remove the [object] [precise location]." / "Replace the [original object] [location] with a/an [new object] with [clear visual attributes]." / "Convert the video into a [style] style." Name objects exactly as they look in the frame.',
    replace: 'Describe this shot in one or two English sentences as it should look after the edit: the main subjects, their actions, the setting and lighting. Mention the new object (from the user text, if any) by name and appearance in its place in the scene.'
  };
  var AI_IMPROVE_EDIT = 'Rewrite the user\'s request (it may be in Russian) into ONE English video-editing caption. Start with exactly one verb: Add, Remove, Replace or Convert. Use the frame to name the existing objects precisely (color, position) and describe the new object with clear visual attributes. Patterns: "Replace the [original object] [location] with a/an [new object] with [attributes]." "Add a/an [object] with [attributes], [location]." "Remove the [object] [location]." "Convert the video into a [style] style." Output only the sentence.';
  var AI_IMPROVE = 'Rewrite the user\'s text (it may be in Russian) into a clear English prompt for a video model, keeping its meaning. Use the frame only to add concrete visual details that match it. Output only the rewritten text, no quotes or comments.';

  /* ---------- Движения камеры ----------
     lora: 'cam' — Muapi/camera-controls-ltx-2.3 (пан/тилт/зум, обучена под LTX 2.3 22B);
           'cine' — Lightricks LTX-2.5 Cinemagraph; null — только описание в промте. */
  var CAMERA_MOVES = [
    ['none', 'Без указаний (решает модель)', null, ''],
    ['static', 'Статичная камера', null, 'static shot, locked-off camera on a tripod, fixed framing; the camera stays still while the people and objects in the scene keep moving naturally'],
    ['cinemagraph', 'Синемаграф: статика, движется один элемент', 'cine', 'CINEMAGRAPH_MOTION, locked-off static camera, seamless natural loop'],
    ['dolly_in', 'Наезд вперёд (dolly in)', 'cam', 'the camera {s}zooms in on the subject, moving forward'],
    ['dolly_out', 'Отъезд назад (dolly out)', 'cam', 'the camera {s}zooms out, pulling back'],
    ['pan_left', 'Панорама влево', 'cam', 'the camera {s}pans to the left'],
    ['pan_right', 'Панорама вправо', 'cam', 'the camera {s}pans to the right'],
    ['tilt_up', 'Наклон вверх (tilt up)', 'cam', 'the camera {s}tilts up'],
    ['tilt_down', 'Наклон вниз (tilt down)', 'cam', 'the camera {s}tilts down'],
    ['truck_left', 'Смещение влево (trucking)', null, 'the camera {s}trucks to the left, moving sideways with parallax'],
    ['truck_right', 'Смещение вправо (trucking)', null, 'the camera {s}trucks to the right, moving sideways with parallax'],
    ['crane_up', 'Кран вверх (jib up)', null, 'the camera {s}cranes up, rising vertically'],
    ['crane_down', 'Кран вниз (jib down)', null, 'the camera {s}cranes down, descending vertically'],
    ['orbit', 'Облёт вокруг объекта (orbit)', null, 'the camera {s}orbits around the subject'],
    ['handheld', 'Ручная камера', null, 'handheld camera with subtle natural shake']
  ];
  var CAMERA_LORAS = { cam: 'camera-controls-ltx-2.3.safetensors', cine: 'ltx-2.5-22b-lora-cinemagraph-0.9.safetensors' };
  function cameraMove(id) { for (var i = 0; i < CAMERA_MOVES.length; i++) if (CAMERA_MOVES[i][0] === id) return CAMERA_MOVES[i]; return CAMERA_MOVES[0]; }
  function cameraPhrase(f) {
    var m = cameraMove(f.move), sp = { slow: 'slowly ', medium: '', fast: 'quickly ' }[f.speed || 'slow'] || '';
    return m[3].replace('{s}', sp);
  }

  /* ---------- Relight (IC-LoRA LTX-2.3) ----------
     Пресет = один из 12 обученных «характеров» света вместе с подходящей высотой солнца,
     чтобы нельзя было выставить противоречие (например, «золотой час» с полуденным солнцем).
     [id, подпись, фраза для промта (или функция от направления), высота°, фиксированное направление | null] */
  var RELIGHT_PRESETS = [
    ['sun', 'Солнце — жёсткий направленный свет', 'hard directional sunlight', 45, null],
    ['noon', 'Высокое полуденное солнце', 'hard high-angle sunlight', 70, null],
    ['low', 'Низкое солнце, длинные тени', 'hard low-angle sunlight', 20, null],
    ['golden', 'Золотой час', function (az) { return (az === 0 || az === 45 || az === 315) ? 'warm golden low front sun' : 'warm golden low side sun'; }, 15, null],
    ['warm', 'Мягкий тёплый (вторая половина дня)', 'soft warm afternoon light', 40, null],
    ['soft', 'Мягкий рассеянный дневной', 'soft diffused daylight', 55, null],
    ['cool', 'Холодный мягкий дневной', 'cool soft daylight', 55, null],
    ['overcast', 'Пасмурно (без выраженного направления)', 'dim overcast light', 75, 0],
    ['backlight', 'Контровой с обводкой (солнце за объектом)', 'strong backlight with rim light', 25, 180],
    ['hazy', 'Мягкий дымчатый контровой', 'soft hazy backlight', 20, 180],
    ['frontal', 'Фронтальное солнце (в лицо)', 'frontal sunlight', 40, 0]
  ];
  // [азимут°, подпись, слово для промта]: 0 — со стороны камеры, 90 — справа, 180 — сзади
  var RELIGHT_DIRS = [
    ['0', 'Спереди (из-за камеры)', 'the front'], ['45', 'Спереди-справа', 'the front-right'], ['90', 'Справа', 'the right'],
    ['135', 'Сзади-справа', 'the back-right'], ['180', 'Сзади (контровой)', 'behind'], ['225', 'Сзади-слева', 'the back-left'],
    ['270', 'Слева', 'the left'], ['315', 'Спереди-слева', 'the front-left']
  ];
  function relightDir(id) { for (var i = 0; i < RELIGHT_DIRS.length; i++) if (RELIGHT_DIRS[i][0] === String(id)) return RELIGHT_DIRS[i]; return RELIGHT_DIRS[2]; }
  function relightParams(f) {
    var p = RELIGHT_PRESETS[0];
    for (var i = 0; i < RELIGHT_PRESETS.length; i++) if (RELIGHT_PRESETS[i][0] === f.look) p = RELIGHT_PRESETS[i];
    var d = relightDir(p[4] !== null ? p[4] : (f.dir || '90')), az = Number(d[0]);
    var look = typeof p[2] === 'function' ? p[2](az) : p[2];
    var el = p[3], alt = el < 33 ? 'low' : el < 58 ? 'mid' : 'high';
    return { preset: p, dir: d, az: az, el: el, look: look,
      prompt: 'relight the video to match the light-direction ball. ' + look + ' from ' + d[2] + ', ' + alt + ' sun' };
  }
  // Геометрия шара из официального пайплайна: 143 px с отступом 22 px при 1280×704
  function relightBall(w, h) {
    var k = Math.min(w / 1280, h / 704);
    var size = Math.max(32, Math.round(143 * k)), m = Math.round(22 * k);
    return { size: size, x: w - size - m, y: m };
  }

  var TOOLS = [
    /* ---------- NVIDIA ---------- */
    {
      id: 'dlss5', group: 'NVIDIA DLSS 5', label: 'DLSS 5 — нейрорендер (материалы, кожа, свет)',
      kind: 'dlss', fields: [], strength: 1,
      hint: 'NVIDIA DLSS 5 Neural Rendering: восстанавливает материалы, кожу, волосы и свет, может апскейлить до 3×. Работает без ComfyUI и моделей LTX. Параметры — «Zouwu Forge — Настройки» → вкладка «DLSS 5». Нужна видеокарта RTX 30/40/50.'
    },

    /* ---------- Генерация ---------- */
    {
      id: 'prompt', group: 'Генерация', label: 'Видео по промту (V2V)',
      lora: 'ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors', repo: 'Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control',
      kind: 'prompt', refDown: 2, strength: 1.0, sampler: 'euler_ancestral',
      hint: 'Переделывает выбранные кадры по вашему описанию. «Перерисовка» — меняет стиль/детали, сохраняя движение; чем выше сила изменения, тем дальше от исходника (0.4–0.6 — стилизация, 0.8+ — почти новая картинка). До 0.75 перерисовка идёт одним проходом сразу в итоговом разрешении (детали исходника сохраняются), выше — через апскейлер. Чёткость результата задаёт «Итоговое разрешение» в настройках: для больших композиций ставьте 1088p. «По контурам» — генерирует новый ролик, повторяя форму и движение исходника (Union Control). Описывайте финальную сцену целиком: кто, где, свет, стиль. «Правка по описанию» — одна команда на английском (Add / Remove / Replace / Convert), кнопка «Улучшить» перепишет русский текст в нужный формат. «Заменить по образцу» — укажите слой-маску (что заменить) и слой с вырезанным объектом (на что); в описании кадра обязательно назовите новый объект. Оба режима — LoRA сообщества под LTX 2.3, идут одним проходом.',
      fields: [
        { key: 'mode', label: 'Режим', type: 'select', options: [['restyle', 'Перерисовка исходника'], ['structure', 'Новый ролик по контурам исходника'], ['edit', 'Правка по описанию: добавить / убрать / заменить'], ['replace', 'Заменить объект по образцу (маска + картинка)']], value: 'restyle' },
        { key: 'instruction', label: 'Что изменить (одна команда)', type: 'area', required: true, ai: 'edit', aiImprove: 'edit', showIf: { mode: 'edit' }, placeholder: 'Replace the red car on the road with a white vintage bus with chrome details' },
        { key: 'maskLayer', label: 'Где заменить — слой-маска (белое = заменить)', type: 'layer', showIf: { mode: 'replace' } },
        { key: 'refLayer', label: 'На что заменить — слой-образец (вырезанный объект с прозрачностью)', type: 'layer', showIf: { mode: 'replace' } },
        { key: 'scene', label: 'Как выглядит кадр после замены (с новым объектом)', type: 'area', required: true, ai: 'replace', showIf: { mode: 'replace' }, placeholder: 'a man sits at a wooden table and holds a red vintage telephone, warm evening light' },
        { key: 'cfg', label: 'Сила правки (CFG): 1 — как у автора; если результат повторяет исходник — 2…3 (время ×2)', type: 'range', min: 1, max: 5, step: 0.25, value: 2.5, showIf: { mode: ['edit', 'replace'] } },
        { key: 'hold', label: 'Привязка к исходнику: 1 — точно держит кадр; 0.8–0.9 — больше свободы для правки', type: 'range', min: 0.5, max: 1, step: 0.05, value: 1, showIf: { mode: ['edit', 'replace'] } },
        { key: 'grow', label: 'Расширить маску, px', type: 'range', min: 0, max: 60, step: 2, value: 10, showIf: { mode: 'replace' } },
        { key: 'block', label: 'Огрубить маску блоками (чем крупнее — тем свободнее форма нового объекта)', type: 'select', options: [['8', '8 px — близко к форме'], ['16', '16 px'], ['32', '32 px — как у автора'], ['64', '64 px — почти прямоугольник']], value: '32', showIf: { mode: 'replace' } },
        { key: 'prompt', label: 'Что должно получиться', type: 'area', required: true, ai: 'v2v', showIf: { mode: ['restyle', 'structure'] }, placeholder: 'аниме-стиль, ночной город под дождём, неоновые вывески, мужчина в капюшоне с чёрной сумкой идёт к камере' },
        { key: 'denoise', label: 'Сила изменения', type: 'range', min: 0.2, max: 1, step: 0.05, value: 0.6, showIf: { mode: 'restyle' } },
        { key: 'edges', label: 'Чувствительность контуров (меньше — больше линий)', type: 'range', min: 0.1, max: 0.9, step: 0.05, value: 0.4, showIf: { mode: 'structure' } },
        { key: 'negative', label: 'Чего избегать', type: 'text', value: 'blurry, low quality, distorted, flicker, watermark, text' }
      ],
      prompt: function (f) { return f.mode === 'edit' ? f.instruction : f.mode === 'replace' ? f.scene : f.prompt; },
      negative: function (f) { return f.negative || ''; }
    },

    {
      id: 'camera', group: 'Генерация', label: 'Оживить кадр + движение камеры (I2V)',
      kind: 'i2v', lora: null, strength: 1.0, sampler: 'euler_ancestral',
      hint: 'Генерирует новый клип из одного кадра композиции (под плейхедом или первого кадра диапазона) с заданным движением камеры. Опишите, что происходит в кадре; движение камеры добавится к промту само. Пан/тилт/наезд/отъезд усиливаются LoRA камеры, синемаграф — официальной LoRA LTX 2.5, остальное — описанием в промте. Результат кладётся новой композицией с того же момента времени.',
      fields: [
        { key: 'prompt', label: 'Что происходит в кадре', type: 'area', required: true, ai: 'camera', placeholder: 'мужчина в капюшоне медленно поворачивает голову, дождь, неоновый свет отражается в лужах' },
        { key: 'move', label: 'Движение камеры', type: 'select', options: CAMERA_MOVES.map(function (m) { return [m[0], m[1]]; }), value: 'static' },
        { key: 'speed', label: 'Скорость камеры', type: 'select', options: [['slow', 'Медленно'], ['medium', 'Средне'], ['fast', 'Быстро']], value: 'slow' },
        { key: 'camStrength', label: 'Сила LoRA камеры', type: 'range', min: 0, max: 1.5, step: 0.05, value: 1.0 },
        { key: 'lockZone', label: 'Как держать камеру', type: 'select', options: [['edges', 'По краям кадра — центр двигается свободно'], ['end', 'Только конец клипа совпадает со стартом'], ['full', 'Весь кадр — жёстко, движения почти нет']], value: 'edges', showIf: { move: ['static', 'cinemagraph'] } },
        { key: 'lock', label: 'Сила фиксации', type: 'range', min: 0, max: 1, step: 0.05, value: 0.7, showIf: { move: ['static', 'cinemagraph'] } },
        { key: 'lockBorder', label: 'Ширина «рамки» фиксации, %', type: 'range', min: 5, max: 40, step: 5, value: 20, showIf: { move: ['static', 'cinemagraph'], lockZone: 'edges' } },
        { key: 'seconds', label: 'Длительность, сек', type: 'number', min: 1, max: 10, step: 1, value: 5 },
        { key: 'frameSrc', label: 'Стартовый кадр', type: 'select', options: [['cti', 'Кадр под плейхедом'], ['first', 'Первый кадр выбранного диапазона']], value: 'cti' },
        { key: 'negative', label: 'Чего избегать', type: 'text', value: 'blurry, low quality, distorted, morphing, flicker, watermark, text' }
      ],
      prompt: function (f) { var c = cameraPhrase(f); return (f.prompt || '') + (c ? '. ' + c + '.' : ''); },
      negative: function (f) { var n = f.negative || ''; if (f.move === 'static' || f.move === 'cinemagraph') n += (n ? ', ' : '') + 'camera movement, pan, zoom, parallax'; return n; }
    },

    {
      id: 'camxfer', group: 'Генерация', label: 'Перенос движения камеры (картинка + видео-образец)',
      lora: 'LTX2.3-22B_IC-LoRA-Cameraman_v2_14000.safetensors', repo: 'Cseti/LTX2.3-22B_IC-LoRA-Cameraman_v2',
      kind: 'camxfer', strength: 1.0, sampler: 'euler_ancestral_cfg_pp',
      hint: 'Делает клип из картинки (кадр под плейхедом) и повторяет движение камеры из другого видео — слоя-образца в этой же композиции: пан, тилт, наезд, облёт, крен и их сочетания. Длина клипа — по образцу (до 121 кадра). Промт сильно влияет на камеру: описывайте сцену и действие, а не движение камеры; если камера не повторяется — попробуйте пустой промт или другой seed. Чем выше разрешение, тем точнее повтор (не ниже 960×544 в первом проходе — итог 1088p). LoRA Cseti Cameraman v2 (LTX 2.3) — только для некоммерческого использования.',
      fields: [
        { key: 'refLayer', label: 'Видео-образец движения камеры (слой)', type: 'layer' },
        { key: 'prompt', label: 'Что в кадре и что происходит (без описания камеры, можно пусто)', type: 'area', ai: 'camera', placeholder: 'семья за большим столом на воскресном ужине, тёплый свет из окна' },
        { key: 'imgStrength', label: 'Привязка к картинке (меньше — больше движения: 0.5–0.7)', type: 'range', min: 0.2, max: 1, step: 0.05, value: 0.5 },
        { key: 'refStrength', label: 'Следовать образцу', type: 'range', min: 0.3, max: 1, step: 0.05, value: 1 },
        { key: 'maxSec', label: 'Не длиннее, сек', type: 'number', min: 1, max: 5, step: 1, value: 5 },
        { key: 'frameSrc', label: 'Картинка', type: 'select', options: [['cti', 'Кадр под плейхедом'], ['first', 'Первый кадр выбранного диапазона']], value: 'cti' },
        { key: 'negative', label: 'Чего избегать', type: 'text', value: 'text, subtitles, logo, watermark, signature' }
      ],
      prompt: function (f) { return f.prompt || ''; },
      negative: function (f) { return f.negative || ''; }
    },

    /* ---------- Восстановление ---------- */
    {
      id: 'deblur', group: 'Восстановление', label: 'Deblur — убрать расфокус',
      lora: 'ltx-2.5-22b-ic-lora-deblur-0.9.safetensors', repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Deblur',
      kind: 'v2v', strength: 1.0, sampler: 'euler_ancestral', singleStage: true,
      hint: 'Возвращает резкость размытым кадрам. Работает на весь кадр. Если пересвечивает резкость — снизьте силу до 0.8.',
      fields: [SCENE],
      prompt: function (f) {
        return 'Reference shows ' + f.scene + ', heavily out of focus with soft defocused blur and no fine detail. ' +
          'Edited shows the same scene in sharp focus with crisp detail and clean edges. DEBLUR ' + f.scene + '. ' +
          'Subject identity, framing, and background geometry are identical to the reference; only focus and sharpness differ between reference and edited.';
      },
      negative: 'blurry, out of focus, soft, low quality'
    },
    {
      id: 'decompression', group: 'Восстановление', label: 'Decompression — убрать артефакты сжатия',
      lora: 'ltx-2.5-22b-ic-lora-decompression-0.9.safetensors', repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Decompression',
      kind: 'v2v', strength: 1.0, sampler: 'euler_ancestral', singleStage: true,
      hint: 'Убирает квадраты, цветовые подтёки и звон от сильного сжатия (скачанное видео, низкий битрейт).',
      fields: [SCENE],
      prompt: function (f) {
        return 'Reference shows ' + f.scene + ', heavily compressed with visible macroblocking, chroma bleed, and ringing artifacts. ' +
          'Edited shows the same scene clean and artifact-free. ENHANCE QUALITY ' + f.scene + '. ' +
          'Composition, motion and colors are identical to the reference; only compression artifacts are removed.';
      },
      negative: 'macroblocking, compression artifacts, banding, ringing, low quality'
    },
    {
      id: 'restore', group: 'Восстановление', label: 'Restore — реставрация старых съёмок',
      lora: 'ltx-2.5-22b-ic-lora-restore-1.0.safetensors', repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Restore',
      kind: 'v2v', strength: 1.0, sampler: 'euler', singleStage: true,
      hint: 'Реставрация архивных и старых кадров. Не шумодавьте и не повышайте резкость исходник заранее. Сила работает как переключатель — оставьте 1.0. Для мелкой фактуры потом прогоните Refine Details.',
      fields: [SCENE, { key: 'avoid', label: 'Чего не добавлять', type: 'text', placeholder: 'modern cars, modern signage', value: 'modern vehicles, modern signage' }],
      prompt: function (f) { return f.scene; },
      negative: function (f) { return f.avoid || ''; }
    },
    {
      id: 'refine', group: 'Восстановление', label: 'Refine Details — фактура и детали',
      lora: 'ltx-2.5-22b-ic-lora-refine-details-1.0.safetensors', repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Refine-Details',
      kind: 'v2v', strength: 1.0, sampler: 'euler', singleStage: true,
      hint: 'Добавляет фотографическую фактуру (кожа, ткань, поверхности). Хорошо работает финальным проходом после других инструментов. Промт описывает только «картинку», без объектов.',
      fields: [{ key: 'look', label: 'Доп. описание вида (необязательно)', type: 'text', ai: 'look', placeholder: 'warm cinematic grade, 35mm film' }],
      prompt: function (f) {
        return 'sharp photographic detail, crisp natural texture, fine surface detail, ' + (f.look ? f.look + ', ' : '') + 'natural film grain, high resolution footage';
      },
      negative: 'blurry, soft, plastic, smeared detail, oversharpened halos, warped faces'
    },
    {
      id: 'upscale', group: 'Восстановление', label: 'Pixel Upscaler ×2 — генеративный апскейл',
      lora: 'ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors', repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler',
      kind: 'upscale', strength: 1.0, sampler: 'euler_ancestral', singleStage: true,
      hint: 'Перерисовывает кадр крупнее с новыми деталями (не попиксельно). Источник — чистый кадр без сильного сжатия. Вместе со вторым проходом даёт ×4 от исходника, без него — ×2.',
      fields: [{ key: 'scene', label: 'Что в кадре (необязательно)', type: 'area', ai: 'scene', placeholder: 'кратко опишите сцену' }],
      prompt: function (f) { return (f.scene ? f.scene + '. ' : '') + 'High resolution, sharp, detailed footage.'; },
      negative: 'blurry, low resolution, artifacts'
    },
    {
      id: 'colorize', group: 'Восстановление', label: 'Colorization — раскраска ч/б',
      lora: 'ltx-2.5-22b-ic-lora-colorization-0.9.safetensors', repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Colorization',
      kind: 'v2v', strength: 1.0, sampler: 'euler_ancestral', singleStage: true,
      hint: 'Раскрашивает чёрно-белое или обесцвеченное видео. Если цвета «текут» — снизьте силу до 0.85.',
      fields: [SCENE, { key: 'colors', label: 'Какие цвета', type: 'area', ai: 'colors', placeholder: 'тёмно-зелёная куртка, рыжие волосы, тёплый закат', required: true }],
      prompt: function (f) {
        return 'Reference shows ' + f.scene + ' in black and white. Edited shows the same scene with natural colors restored. COLORIZE ' + f.colors + '. Only color differs from the reference; composition and motion are identical.';
      },
      negative: 'black and white, monochrome, desaturated, color bleeding, oversaturated'
    },

    /* ---------- Композитинг ---------- */
    {
      id: 'alpha', group: 'Композитинг', label: 'Alpha Gen — альфа-маска главного объекта',
      lora: 'ltx-2.5-22b-ic-lora-alpha-gen-0.9.safetensors', repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Alpha-Gen',
      kind: 'v2v', strength: 1.0, sampler: 'euler_ancestral', maxFrames: 145, emptyPrompt: true, singleStage: true,
      hint: 'Делает ч/б маску главного объекта (белое — объект). Объект выбирается автоматически. Официально рекомендован один проход — если маска «плывёт», выключите апскейлер. До 145 кадров за часть.',
      fields: [],
      outputModes: [['matte', 'Маска + исходник с вырезанным объектом'], ['plain', 'Только маска']],
      prompt: function () { return ''; },
      negative: ''
    },
    {
      id: 'cleanplate', group: 'Композитинг', label: 'Clean Plate — чистый фон',
      lora: 'ltx-2.5-22b-ic-lora-clean-plate-1.0.safetensors', repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Clean-Plate',
      kind: 'v2v', strength: 1.0, sampler: 'euler_ancestral', singleStage: true,
      hint: 'Убирает движущихся людей и объекты и восстанавливает фон под ними. Опишите, как выглядит пустая сцена, и что нужно убрать.',
      fields: [
        { key: 'empty', label: 'Пустая сцена', type: 'area', ai: 'empty', placeholder: 'пустая ночная улица, мокрый асфальт, фонари', required: true },
        { key: 'remove', label: 'Что убрать', type: 'text', ai: 'remove', placeholder: 'man in a hoodie, people', required: true }
      ],
      prompt: function (f) { return f.empty + '. The scene is empty, with no ' + f.remove + '.'; },
      negative: function (f) { return f.remove + ', person, people'; }
    },
    {
      id: 'inpaint', group: 'Композитинг', label: 'In/Outpaint — замена по маске и расширение кадра',
      lora: 'ltx-2.3-22b-ic-lora-in-outpainting-0.9.safetensors', repo: 'Lightricks/LTX-2.3-22b-IC-LoRA-In-Outpainting',
      kind: 'inpaint', strength: 1.0, sampler: 'euler_ancestral',
      hint: 'Inpaint: выберите слой-маску (его альфа = что заменить; например фигура с маской или ротоскоп). Outpaint: кадр расширяется по краям. Промт описывает только то, что должно появиться в маске (можно оставить пустым).',
      fields: [
        { key: 'mode', label: 'Режим', type: 'select', options: [['inpaint', 'Заменить по маске (inpaint)'], ['outpaint', 'Расширить кадр (outpaint)']], value: 'inpaint' },
        { key: 'maskLayer', label: 'Слой-маска', type: 'layer', showIf: { mode: 'inpaint' } },
        { key: 'dilate', label: 'Расширить маску, пикс.', type: 'number', min: 0, max: 128, step: 1, value: 15, showIf: { mode: 'inpaint' } },
        { key: 'padL', label: 'Слева, %', type: 'number', min: 0, max: 100, step: 5, value: 0, showIf: { mode: 'outpaint' } },
        { key: 'padR', label: 'Справа, %', type: 'number', min: 0, max: 100, step: 5, value: 0, showIf: { mode: 'outpaint' } },
        { key: 'padT', label: 'Сверху, %', type: 'number', min: 0, max: 100, step: 5, value: 0, showIf: { mode: 'outpaint' } },
        { key: 'padB', label: 'Снизу, %', type: 'number', min: 0, max: 100, step: 5, value: 0, showIf: { mode: 'outpaint' } },
        { key: 'fill', label: 'Что должно появиться', type: 'area', ai: 'fill', placeholder: 'кожаная спортивная сумка чёрного цвета' }
      ],
      prompt: function (f) { return f.fill || ''; },
      negative: 'pc game, console game, video game, cartoon, childish, ugly'
    },

    /* ---------- Свет и цвет ---------- */
    {
      id: 'relight', group: 'Свет и цвет', label: 'Relight — пересветить сцену',
      lora: 'ltx-2.3-22b-ic-lora-relight-1.0.safetensors', repo: 'Lightricks/LTX-2.3-22b-IC-LoRA-Relight',
      kind: 'relight', refDown: 1, strength: 1.0, sampler: 'euler_ancestral', singleStage: true,
      hint: 'Меняет направление и характер освещения, сохраняя сцену и движение. Направление модель берёт из «шара света» в углу опорного видео (плагин рисует его сам, как официальный узел). Это грубое управление: 8 направлений и один из 11 обученных вариантов света, высота солнца подбирается по варианту. Обучена на реальной уличной съёмке — на интерьерах и стилизованной 3D/анимации слушается хуже. Если в исходнике уже сильный свет сзади, модель часто его сохраняет: выбирайте направление, заметно отличающееся от исходного. Идёт одним проходом (второй проход этой LoRA вредит), лучше всего около 1280×704 и до 121 кадра.',
      fields: [
        { key: 'look', label: 'Свет', type: 'select', value: 'sun', options: RELIGHT_PRESETS.map(function (p) { return [p[0], p[1]]; }) },
        { key: 'dir', label: 'Откуда светит', type: 'select', value: '90', options: RELIGHT_DIRS.map(function (d) { return [d[0], d[1]]; }),
          showIf: { look: RELIGHT_PRESETS.filter(function (p) { return p[4] === null; }).map(function (p) { return p[0]; }) } }
      ],
      prompt: function (f) { return relightParams(f).prompt; },
      negative: 'worst quality, inconsistent motion, blurry, jittery, distorted, flicker'
    },
    {
      id: 'daynight', group: 'Свет и цвет', label: 'Day to Night — день в ночь',
      lora: 'ltx-2.5-22b-ic-lora-day-to-night-0.9.safetensors', repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Day-To-Night',
      kind: 'v2v', strength: 1.0, sampler: 'euler_ancestral', singleStage: true,
      hint: 'Переводит дневную съёмку в ночную, сохраняя движение камеры и композицию.',
      fields: [SCENE, { key: 'night', label: 'Какая ночь', type: 'text', ai: 'night', placeholder: 'тёплые фонари, луна, мокрый асфальт', value: 'warm street lights, moonlit sky' }],
      prompt: function (f) {
        return f.scene + ' at night, ' + (f.night || 'lit by artificial lights') + '. Only the lighting changes from day to night; identical composition, framing, camera movement and motion.';
      },
      negative: 'daytime, bright sunlight, blue sky, overexposed, worst quality, inconsistent motion, blurry, jittery, distorted'
    },
    {
      id: 'hdr', group: 'Свет и цвет', label: 'SDR → HDR (EXR)',
      lora: 'ltx-2.5-22b-ic-lora-sdr-to-hdr-1.0.safetensors', repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-SDR-To-HDR',
      embeddings: 'ltx-2.5-22b-ic-lora-sdr-to-hdr-scene-emb.safetensors',
      kind: 'hdr', strength: 1.0, sampler: 'euler', singleStage: true,
      hint: 'Поднимает обычное видео в HDR и отдаёт 16-битные EXR. Промт не нужен. Результат импортируется в 32-битный проект.',
      fields: [
        { key: 'exrSpace', label: 'Цветовое пространство EXR', type: 'select', options: [['linear', 'Линейный (Linear sRGB/709)'], ['acescg', 'ACEScg (линейный ACES)'], ['acescct', 'ACEScct (лог)']], value: 'linear' },
        { key: 'exposure', label: 'Экспозиция', type: 'range', min: -3, max: 3, step: 0.1, value: 0 },
        { key: 'to32', label: 'Перевести проект в 32 бит', type: 'check', value: true }
      ],
      prompt: function () { return ''; },
      negative: ''
    },

    /* ---------- Эффекты ---------- */
    {
      id: 'water', group: 'Эффекты', label: 'Water Simulation — добавить воду',
      lora: 'ltx-2.5-22b-ic-lora-water-simulation-0.9.safetensors', repo: 'Lightricks/LTX-2.5-22b-IC-LoRA-Water-Simulation',
      kind: 'v2v', strength: 1.0, sampler: 'euler_ancestral', singleStage: true,
      hint: 'Добавляет воду в готовое видео: реку или ручей вокруг ног, прибой, затопленную улицу, дождь, брызги, мокрый блеск поверхностей — человек, одежда, поза, камера и фон остаются прежними. Маски нет: вода может появиться в любом месте кадра, управляется описанием. Описывайте воду конкретно: какая, где, как движется и как касается людей. Сила LoRA 1.0–1.05 — естественно, 1.1–1.5 — замена поверхностей (земля → море), выше — искажает лица. Идёт одним проходом (второй проход у этой LoRA сбивает внешность).',
      fields: [SCENE, { key: 'water', label: 'Какая вода', type: 'area', ai: 'water', placeholder: 'улица затоплена по щиколотку, рябь и отражения фонарей', required: true }],
      prompt: function (f) {
        return 'Reference shows ' + f.scene + '. Edited shows the same scene with water added. ADD WATER ' + f.water + '. Composition and camera motion are identical to the reference.';
      },
      negative: 'dry, distorted faces, warped geometry, blurry'
    }
  ];

  function toolById(id) { for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].id === id) return TOOLS[i]; return null; }
  function val(fnOrStr, f) { return typeof fnOrStr === 'function' ? fnOrStr(f) : (fnOrStr || ''); }

  /* ---------- Сборка графа ----------
     opt: { tool, fields, dir, maskDir, len, W, H (латент 1-го прохода), fps, seed, strength,
            stage2 (bool), anchor (bool), anchorStrength, models:{unet, loader, clip, clipDevice, vae, audioVae, upscaler},
            exrDir, tileSize } */
  /* ---------- Перенос движения камеры: IC-LoRA Cameraman v2 (Cseti), как в воркфлоу автора ----------
     Проход 1 (половина итогового размера): картинка — LTXVImgToVideoConditionOnly (сила 0.5),
     видео-образец — LTXAddVideoICLoRAGuide (сила 1), CFG 1, euler_ancestral_cfg_pp, 8 шагов distilled.
     Проход 2: латентный апскейлер ×2, картинка ещё раз (0.7), euler_cfg_pp, сигмы 0.85 → 0, без опоры образца.
     opt: { tool, fields, dirImg, dirRef, len, W, H (проход 1), fps, seed, strength, stage2, models, detail, tileSize, i2vCls } */
  function buildCamXfer(opt) {
    var t = opt.tool, f = opt.fields || {}, M = opt.models, G = {}, n = 0;
    function add(cls, inputs) { var id = String(++n); G[id] = { class_type: cls, inputs: inputs }; return id; }
    var fps = Math.min(opt.fps, 60), W = opt.W, H = opt.H, i2vCls = opt.i2vCls || 'LTXVImgToVideoInplace';
    var unet = M.loader === 'gguf' ? add('UnetLoaderGGUF', { unet_name: M.unet }) : add('UNETLoader', { unet_name: M.unet, weight_dtype: 'default' });
    var lora = add('LTXICLoRALoaderModelOnly', { model: [unet, 0], lora_name: t.lora, strength_model: opt.strength || 1.0 });
    var vae = add('VAELoader', { vae_name: M.vae });
    var avae = add('VAELoader', { vae_name: M.audioVae });
    var clip = add('CLIPLoader', { clip_name: M.clip, type: 'ltxv', device: M.clipDevice || 'default' });
    var pos = add('CLIPTextEncode', { clip: [clip, 0], text: String(val(t.prompt, f) || '') });
    var neg = add('CLIPTextEncode', { clip: [clip, 0], text: String(val(t.negative, f) || '') });
    var cond = add('LTXVConditioning', { positive: [pos, 0], negative: [neg, 0], frame_rate: fps });
    var imgL = add('VHS_LoadImagesPath', { directory: opt.dirImg, image_load_cap: 1, skip_first_images: 0, select_every_nth: 1 });
    function imgAt(w, h) {
      var sc = add('ImageScale', { image: [imgL, 0], upscale_method: 'lanczos', width: w, height: h, crop: 'center' });
      return [add('LTXVPreprocess', { image: [sc, 0], img_compression: 18 }), 0];
    }
    var refL = add('VHS_LoadImagesPath', { directory: opt.dirRef, image_load_cap: opt.len, skip_first_images: 0, select_every_nth: 1 });
    var ref = [add('ImageScale', { image: [refL, 0], upscale_method: 'lanczos', width: W, height: H, crop: 'center' }), 0];
    function sample(p, ng, latent, sigmas, sampler) {
      var noise = add('RandomNoise', { noise_seed: opt.seed });
      var guider = add('CFGGuider', { model: [lora, 0], positive: p, negative: ng, cfg: 1.0 });
      var smp = add('KSamplerSelect', { sampler_name: sampler });
      var sig = add('ManualSigmas', { sigmas: refineSigmas(sigmas, opt.detail) });
      var sc = add('SamplerCustomAdvanced', { noise: [noise, 0], guider: [guider, 0], sampler: [smp, 0], sigmas: [sig, 0], latent_image: latent });
      return add('LTXVSeparateAVLatent', { av_latent: [sc, 0] });
    }
    var imgStr = Math.max(0.1, Math.min(1, Number(f.imgStrength === undefined ? 0.5 : f.imgStrength)));
    var lat = add('EmptyLTXVLatentVideo', { width: W, height: H, length: opt.len, batch_size: 1 });
    var i2v = add(i2vCls, { vae: [vae, 0], image: imgAt(W, H), latent: [lat, 0], strength: imgStr, bypass: false });
    var gd = add('LTXAddVideoICLoRAGuide', {
      positive: [cond, 0], negative: [cond, 1], vae: [vae, 0], latent: [i2v, 0], image: ref,
      frame_idx: 0, strength: Math.max(0.1, Math.min(1, Number(f.refStrength === undefined ? 1 : f.refStrength))),
      latent_downscale_factor: [lora, 1], crop: 'disabled', use_tiled_encode: false, tile_size: 256, tile_overlap: 64
    });
    var alat = add('LTXVEmptyLatentAudio', { frames_number: opt.len, frame_rate: fps, batch_size: 1, audio_vae: [avae, 0] });
    var av = add('LTXVConcatAVLatent', { video_latent: [gd, 2], audio_latent: [alat, 0] });
    var sep = sample([gd, 0], [gd, 1], [av, 0], SIGMAS_8, 'euler_ancestral_cfg_pp');
    var crop = add('LTXVCropGuides', { positive: [gd, 0], negative: [gd, 1], latent: [sep, 0] });
    var vlat = [crop, 2], outW = W, outH = H;
    if (opt.stage2) {
      var upm = add('LatentUpscaleModelLoader', { model_name: M.upscaler });
      var up = add('LTXVLatentUpsampler', { samples: vlat, upscale_model: [upm, 0], vae: [vae, 0] });
      outW = W * 2; outH = H * 2;
      var i2v2 = add(i2vCls, { vae: [vae, 0], image: imgAt(outW, outH), latent: [up, 0], strength: 0.7, bypass: false });
      var av2 = add('LTXVConcatAVLatent', { video_latent: [i2v2, 0], audio_latent: [sep, 1] });
      var sep2 = sample([crop, 0], [crop, 1], [av2, 0], '0.85, 0.725, 0.421875, 0.0', 'euler_cfg_pp');
      vlat = [sep2, 0];
    }
    var dec = add('VAEDecodeTiled', { samples: vlat, vae: [vae, 0], tile_size: opt.tileSize || 512, overlap: 64, temporal_size: 128, temporal_overlap: 32 });
    var save = add('PreviewImage', { images: [dec, 0] });
    return { graph: G, saveNode: save, outW: outW, outH: outH };
  }

  /* ---------- V2V: правка по описанию / замена по образцу (LoRA Alissonerdx, LTX 2.3) ----------
     Повторяет воркфлоу автора: исходное видео целиком подаётся опорой LTXVAddGuide (кадр 0, сила 1),
     один проход 8 шагов distilled, CFG 1, euler_ancestral_cfg_pp, затем LTXVCropGuides.
     replace: opt.dir — уже собранные кадры (слева полоса opt.strip px с образцом на зелёном,
     область замены залита пурпурным); латент — из этих же кадров; после декода полоса отрезается. */
  function isEditMode(t, f) { return t.kind === 'prompt' && (f.mode === 'edit' || f.mode === 'replace'); }
  function buildEdit(opt) {
    var t = opt.tool, f = opt.fields || {}, M = opt.models, G = {}, n = 0;
    function add(cls, inputs) { var id = String(++n); G[id] = { class_type: cls, inputs: inputs }; return id; }
    var fps = Math.min(opt.fps, 60), rep = f.mode === 'replace';
    var W = opt.stage2 ? opt.W * 2 : opt.W, H = opt.stage2 ? opt.H * 2 : opt.H;   // всегда один проход в итоговом размере
    var S = rep ? (opt.strip | 0) : 0, LW = W + S;
    var unet = M.loader === 'gguf' ? add('UnetLoaderGGUF', { unet_name: M.unet }) : add('UNETLoader', { unet_name: M.unet, weight_dtype: 'default' });
    var lora = add('LoraLoaderModelOnly', { model: [unet, 0], lora_name: EDIT_LORAS[f.mode], strength_model: opt.strength || 1.0 });
    var vae = add('VAELoader', { vae_name: M.vae });
    var avae = add('VAELoader', { vae_name: M.audioVae });
    var clip = add('CLIPLoader', { clip_name: M.clip, type: 'ltxv', device: M.clipDevice || 'default' });
    var pos = add('CLIPTextEncode', { clip: [clip, 0], text: String(val(t.prompt, f) || '') });
    var neg = add('CLIPTextEncode', { clip: [clip, 0], text: String(val(t.negative, f) || '') });
    var cond = add('LTXVConditioning', { positive: [pos, 0], negative: [neg, 0], frame_rate: fps });
    var load = add('VHS_LoadImagesPath', { directory: opt.dir, image_load_cap: 0, skip_first_images: 0, select_every_nth: 1 });
    var img = [add('ImageScale', { image: [load, 0], upscale_method: 'lanczos', width: LW, height: H, crop: 'disabled' }), 0];
    var lat = rep
      ? [add('VAEEncodeTiled', { pixels: img, vae: [vae, 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 }), 0]
      : [add('EmptyLTXVLatentVideo', { width: LW, height: H, length: opt.len, batch_size: 1 }), 0];
    var hold = Math.max(0.3, Math.min(1, Number(f.hold === undefined ? 1 : f.hold)));
    var gd = add('LTXVAddGuide', { positive: [cond, 0], negative: [cond, 1], vae: [vae, 0], latent: lat, image: img, frame_idx: 0, strength: hold });
    var alat = add('LTXVEmptyLatentAudio', { frames_number: opt.len, frame_rate: fps, batch_size: 1, audio_vae: [avae, 0] });
    var av = add('LTXVConcatAVLatent', { video_latent: [gd, 2], audio_latent: [alat, 0] });
    var noise = add('RandomNoise', { noise_seed: opt.seed });
    // CFG > 1: автор советует поднимать, если правка слабая (особенно на distilled-модели; у нас LTX 2.5, а LoRA — под 2.3)
    var cfg = Math.max(1, Math.min(8, Number(f.cfg === undefined ? 1 : f.cfg)));
    var guider = add('CFGGuider', { model: [lora, 0], positive: [gd, 0], negative: [gd, 1], cfg: cfg });
    // семплеры *_cfg_pp рассчитаны на CFG около 1; при большем CFG берём обычный euler_ancestral
    var smp = add('KSamplerSelect', { sampler_name: cfg > 1.01 ? 'euler_ancestral' : 'euler_ancestral_cfg_pp' });
    var sig = add('ManualSigmas', { sigmas: refineSigmas(SIGMAS_8, opt.detail) });
    var sc = add('SamplerCustomAdvanced', { noise: [noise, 0], guider: [guider, 0], sampler: [smp, 0], sigmas: [sig, 0], latent_image: [av, 0] });
    var sep = add('LTXVSeparateAVLatent', { av_latent: [sc, 0] });
    var crop = add('LTXVCropGuides', { positive: [gd, 0], negative: [gd, 1], latent: [sep, 0] });
    var dec = add('VAEDecodeTiled', { samples: [crop, 2], vae: [vae, 0], tile_size: opt.tileSize || 512, overlap: 64, temporal_size: 128, temporal_overlap: 32 });
    var out = [dec, 0];
    if (S) out = [add('ImageCrop', { image: out, width: W, height: H, x: S, y: 0 }), 0];
    var save = add('PreviewImage', { images: out });
    return { graph: G, saveNode: save, outW: W, outH: H };
  }
  // Ширина полосы с образцом слева от кадра (у автора 256 px при 960 по длинной стороне), кратно 32
  function editStrip(W, H) { return Math.max(128, Math.round(Math.max(W, H) * 0.27 / 32) * 32); }

  function buildGraph(opt) {
    if (isEditMode(opt.tool, opt.fields || {})) return buildEdit(opt);
    var t = opt.tool, f = opt.fields || {}, M = opt.models, G = {}, n = 0;
    function add(cls, inputs) { var id = String(++n); G[id] = { class_type: cls, inputs: inputs }; return id; }
    var fps = Math.min(opt.fps, t.kind === 'hdr' ? 30 : 60);
    var ldf = t.refDown || (t.kind === 'upscale' ? 2 : 1);   // IC-LoRA с ref0.5 ждут опору в половину латента
    var restyle = t.kind === 'prompt' && f.mode !== 'structure';  // перерисовка без IC-LoRA (частичное зашумление)
    var guideCls = t.kind === 'inpaint' ? 'LTXAddVideoICLoRAGuideAdvanced' : 'LTXAddVideoICLoRAGuide';
    var ts = opt.tileSize || 512;

    /* модели */
    var unet = M.loader === 'gguf' ? add('UnetLoaderGGUF', { unet_name: M.unet }) : add('UNETLoader', { unet_name: M.unet, weight_dtype: 'default' });
    var lora = restyle ? null : add('LTXICLoRALoaderModelOnly', { model: [unet, 0], lora_name: t.lora, strength_model: opt.strength });
    var model = restyle ? [unet, 0] : [lora, 0];
    var vaeL = add('VAELoader', { vae_name: M.vae });
    var vae = t.kind === 'hdr' ? add('LTXVVAEForceFloat32', { vae: [vaeL, 0] }) : vaeL;
    var avae = add('VAELoader', { vae_name: M.audioVae });

    /* условие: текст через Gemma или фиксированные эмбеддинги (HDR) */
    var pos, neg;
    if (t.kind === 'hdr') {
      var emb = add('LTXVLoadConditioning', { file_name: t.embeddings, device: 'cpu' });
      pos = [emb, 0]; neg = [emb, 0];
    } else {
      var clip = add('CLIPLoader', { clip_name: M.clip, type: 'ltxv', device: M.clipDevice || 'default' });
      pos = [add('CLIPTextEncode', { clip: [clip, 0], text: t.emptyPrompt ? '' : String(val(t.prompt, f) || '') }), 0];
      neg = [add('CLIPTextEncode', { clip: [clip, 0], text: String(val(t.negative, f) || '') }), 0];
    }
    var cond = add('LTXVConditioning', { positive: pos, negative: neg, frame_rate: fps });

    /* исходные кадры и маска */
    var load = add('VHS_LoadImagesPath', { directory: opt.dir, image_load_cap: 0, skip_first_images: 0, select_every_nth: 1 });
    var src = [load, 0];
    if (t.kind === 'hdr') src = [add('LTXVSDRToHDRWorkingSpace', { image: src, color_space: 'srgb_gamma' }), 0];
    var maskLoad = null;
    if (t.kind === 'inpaint') maskLoad = add('VHS_LoadImagesPath', { directory: opt.maskDir, image_load_cap: 0, skip_first_images: 0, select_every_nth: 1 });
    function scaled(w, h, method) { return [add('ImageScale', { image: src, upscale_method: method || 'lanczos', width: w, height: h, crop: 'disabled' }), 0]; }
    function maskAt(w, h, dil) {
      var ms = add('ImageScale', { image: [maskLoad, 0], upscale_method: 'bilinear', width: w, height: h, crop: 'disabled' });
      var m = add('ImageToMask', { image: [ms, 0], channel: 'red' });
      return [add('LTXVDilateVideoMask', { mask: [m, 0], spatial_radius: dil, temporal_radius: 0 }), 0];
    }
    var dil1 = f.mode === 'outpaint' ? 8 : (f.dilate | 0);
    // опора (guide) для IC-LoRA в заданном размере латента
    function guideFor(w, h) {
      var img = scaled(w / ldf, h / ldf);
      if (t.kind === 'prompt') {   // контуры исходника для Union Control
        var hi = Math.min(0.95, Math.max(0.1, Number(f.edges) || 0.4));
        img = [add('Canny', { image: img, low_threshold: Math.max(0.01, hi * 0.5), high_threshold: hi }), 0];
      }
      if (t.kind === 'relight' && opt.ballDir) {   // шар света кладём последним, уже после масштабирования
        var bg = relightBall(w / ldf, h / ldf);
        var bl = add('VHS_LoadImagesPath', { directory: opt.ballDir, image_load_cap: 1, skip_first_images: 0, select_every_nth: 1 });
        var bs = add('ImageScale', { image: [bl, 0], upscale_method: 'lanczos', width: bg.size, height: bg.size, crop: 'disabled' });
        img = [add('ImageCompositeMasked', { destination: img, source: [bs, 0], x: bg.x, y: bg.y, resize_source: false }), 0];
      }
      if (t.kind !== 'inpaint') return { image: img, mask: null };
      var mk = maskAt(w, h, Math.round(dil1 * w / opt.W));
      return { image: [add('LTXVInpaintPreprocess', { images: img, mask: mk }), 0], mask: mk, orig: img };
    }
    function addGuide(p, ng, latent, g, tiled) {
      var gi = {
        positive: p, negative: ng, vae: [vae, 0], latent: latent, image: g.image,
        frame_idx: 0, strength: 1.0, latent_downscale_factor: [lora, 1], crop: 'disabled',
        use_tiled_encode: !!tiled, tile_size: tiled ? 512 : 256, tile_overlap: 64
      };
      if (guideCls === 'LTXAddVideoICLoRAGuideAdvanced') gi.attention_strength = 1.0;
      return add(guideCls, gi);
    }
    function sample(model, p, ng, latent, sigmas, sampler) {
      var noise = add('RandomNoise', { noise_seed: opt.seed });
      var guider = add('CFGGuider', { model: model, positive: p, negative: ng, cfg: 1.0 });
      var smp = add('KSamplerSelect', { sampler_name: sampler });
      var sig = add('ManualSigmas', { sigmas: refineSigmas(sigmas, opt.detail) });
      var sc = add('SamplerCustomAdvanced', { noise: [noise, 0], guider: [guider, 0], sampler: [smp, 0], sigmas: [sig, 0], latent_image: latent });
      return add('LTXVSeparateAVLatent', { av_latent: [sc, 0] });
    }

    /* ---- проход 1 ---- */
    var W = opt.W, H = opt.H, stage2 = opt.stage2, sampler1 = t.sampler || 'euler_ancestral';
    if (t.singleStage && stage2) { W = opt.W * 2; H = opt.H * 2; stage2 = false; }   // LoRA, которым второй проход вредит
    var p1, n1, lat1, sigmas1 = SIGMAS_8;
    var dn = Number(f.denoise) || 0.6;
    if (restyle) {
      // Перерисовка до ~0.75 идёт сразу в итоговом разрешении одним проходом: половинное разрешение
      // + апскейлер теряли лицо и мелкие детали исходника («нейроночность»). Выше 0.75 картинка
      // всё равно рисуется заново — там оставляем двухстадийную схему с апскейлером.
      if (stage2 && dn <= RESTYLE_DIRECT_MAX) { W = opt.W * 2; H = opt.H * 2; stage2 = false; }
      var enc = add('VAEEncodeTiled', { pixels: scaled(W, H), vae: [vae, 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 });
      p1 = [cond, 0]; n1 = [cond, 1]; lat1 = [enc, 0];
      sigmas1 = denoiseSigmas(dn);
      sampler1 = 'euler';   // детерминированный: не подмешивает новый шум на каждом шаге — ближе к исходнику
    } else {
      var g1 = guideFor(W, H);
      var latent = add('EmptyLTXVLatentVideo', { width: W, height: H, length: opt.len, batch_size: 1 });
      var icg = addGuide([cond, 0], [cond, 1], [latent, 0], g1, false);
      p1 = [icg, 0]; n1 = [icg, 1]; lat1 = [icg, 2];
    }
    var alat = add('LTXVEmptyLatentAudio', { frames_number: opt.len, frame_rate: fps, batch_size: 1, audio_vae: [avae, 0] });
    var av = add('LTXVConcatAVLatent', { video_latent: lat1, audio_latent: [alat, 0] });
    var sep = sample(model, p1, n1, [av, 0], sigmas1, sampler1);
    var crop = add('LTXVCropGuides', { positive: p1, negative: n1, latent: [sep, 0] });
    var vlat = [crop, 2], outW = W, outH = H;

    /* ---- проход 2: латентный апскейл ×2 + доработка ---- */
    if (stage2) {
      var upm = add('LatentUpscaleModelLoader', { model_name: M.upscaler });
      var up = add('LTXVLatentUpsampler', { samples: vlat, upscale_model: [upm, 0], vae: [vae, 0] });
      outW = W * 2; outH = H * 2;
      var p2 = [crop, 0], n2 = [crop, 1], lat2 = [up, 0], icg2 = null;
      if (opt.anchor && !restyle) {
        icg2 = addGuide(p2, n2, lat2, guideFor(outW, outH), true);
        p2 = [icg2, 0]; n2 = [icg2, 1]; lat2 = [icg2, 2];
      }
      var av2 = add('LTXVConcatAVLatent', { video_latent: lat2, audio_latent: [sep, 1] });
      // Перерисовка: второй проход не должен зашумлять сильнее, чем просил пользователь —
      // иначе стандартные 0.909 «съедают» ползунок «Сила изменения» и результат всегда одинаковый.
      var sig2 = restyle ? denoiseSigmas(Math.min(0.725, Math.max(0.3, Number(f.denoise) || 0.6))) : SIGMAS_STAGE2;
      var sep2 = sample(model, p2, n2, [av2, 0], sig2, 'euler');
      vlat = icg2 ? [add('LTXVCropGuides', { positive: p2, negative: n2, latent: [sep2, 0] }), 2] : [sep2, 0];
    }

    /* ---- декод и постобработка ---- */
    var dec = add('VAEDecodeTiled', { samples: vlat, vae: [vae, 0], tile_size: ts, overlap: 64, temporal_size: 128, temporal_overlap: 32 });
    var out = [dec, 0];
    if (t.kind === 'inpaint') {
      var origOut = scaled(outW, outH);
      var maskOut = maskAt(outW, outH, Math.round(dil1 * outW / W));
      out = [add('LTXVLaplacianPyramidBlend', { image_a: out, image_b: origOut, mask: maskOut, trim_to_shortest: true, mask_low_res_dilation: 5 }), 0];
    }
    if (t.kind === 'hdr') {
      out = [add('LTXVHDRDecodePostprocess', {
        image: out, transfer: 'acescct', exposure: Number(f.exposure) || 0, save_exr: true,
        exr_color_space: f.exrSpace === 'acescg' ? 'acescg' : (f.exrSpace === 'acescct' ? 'acescct' : 'srgb_linear'),
        output_dir: opt.exrDir, filename_prefix: 'frame', half_precision: true
      }), 0];
    }
    var save = add('PreviewImage', { images: out });
    return { graph: G, saveNode: save, outW: outW, outH: outH };
  }

  /* ---------- Граф «кадр → видео» (I2V) с LoRA камеры ----------
     opt: { tool, fields, dir (папка с 1 кадром), len, W, H, fps, seed, stage2, models, tileSize } */
  function buildI2V(opt) {
    var t = opt.tool, f = opt.fields || {}, M = opt.models, G = {}, n = 0;
    function add(cls, inputs) { var id = String(++n); G[id] = { class_type: cls, inputs: inputs }; return id; }
    var fps = Math.min(opt.fps, 30), W = opt.W, H = opt.H;
    var unet = M.loader === 'gguf' ? add('UnetLoaderGGUF', { unet_name: M.unet }) : add('UNETLoader', { unet_name: M.unet, weight_dtype: 'default' });
    var model = [unet, 0];
    var mv = cameraMove(f.move);
    var camStr = f.camStrength === undefined ? 1.0 : Number(f.camStrength);
    if (mv[2] && camStr > 0) model = [add('LoraLoaderModelOnly', { model: model, lora_name: CAMERA_LORAS[mv[2]], strength_model: camStr }), 0];
    var vae = add('VAELoader', { vae_name: M.vae });
    var avae = add('VAELoader', { vae_name: M.audioVae });
    var clip = add('CLIPLoader', { clip_name: M.clip, type: 'ltxv', device: M.clipDevice || 'default' });
    var pos = add('CLIPTextEncode', { clip: [clip, 0], text: String(val(t.prompt, f) || '') });
    var neg = add('CLIPTextEncode', { clip: [clip, 0], text: String(val(t.negative, f) || '') });
    var cond = add('LTXVConditioning', { positive: [pos, 0], negative: [neg, 0], frame_rate: fps });
    var load = add('VHS_LoadImagesPath', { directory: opt.dir, image_load_cap: 1, skip_first_images: 0, select_every_nth: 1 });
    function frameAt(w, h) {
      var sc = add('ImageScale', { image: [load, 0], upscale_method: 'lanczos', width: w, height: h, crop: 'center' });
      return [add('LTXVPreprocess', { image: [sc, 0], img_compression: 18 }), 0];
    }
    function sample(p, ng, latent, sigmas, sampler) {
      var noise = add('RandomNoise', { noise_seed: opt.seed });
      var guider = add('CFGGuider', { model: model, positive: p, negative: ng, cfg: 1.0 });
      var smp = add('KSamplerSelect', { sampler_name: sampler });
      var sig = add('ManualSigmas', { sigmas: refineSigmas(sigmas, opt.detail) });
      var sc = add('SamplerCustomAdvanced', { noise: [noise, 0], guider: [guider, 0], sampler: [smp, 0], sigmas: [sig, 0], latent_image: latent });
      return add('LTXVSeparateAVLatent', { av_latent: [sc, 0] });
    }
    // Статика: тот же стартовый кадр ставится опорой (guide) в конец клипа и через каждые 24 кадра —
    // модель не может «уехать» камерой, потому что обязана вернуться к той же композиции.
    var guides = lockGuides(f, opt.len);
    function addGuides(p, ng, latent, w, h) {
      if (!guides.length) return null;
      var img = frameAt(w, h), cur = { p: p, n: ng, l: latent }, mask = null;
      if ((f.lockZone || 'edges') === 'edges') {
        // маска-рамка: 1 по краям (там камера «выдаёт» себя), 0 в центре (там действие)
        var b = Math.max(0.05, Math.min(0.4, (Number(f.lockBorder) || 20) / 100));
        var bx = Math.round(w * b), by = Math.round(h * b);
        var outer = add('SolidMask', { value: 1.0, width: w, height: h });
        var inner = add('SolidMask', { value: 0.0, width: Math.max(1, w - 2 * bx), height: Math.max(1, h - 2 * by) });
        mask = [add('MaskComposite', { destination: [outer, 0], source: [inner, 0], x: bx, y: by, operation: 'multiply' }), 0];
      }
      guides.forEach(function (gd) {
        var gi = { positive: cur.p, negative: cur.n, vae: [vae, 0], latent: cur.l, image: img, frame_idx: gd[0], strength: gd[1] };
        if (mask) gi.attention_mask = mask;
        var gid = add('LTXVAddGuide', gi);
        cur = { p: [gid, 0], n: [gid, 1], l: [gid, 2] };
      });
      return cur;
    }
    // проход 1: первый кадр вписывается в латент, остальное генерируется
    var lat = add('EmptyLTXVLatentVideo', { width: W, height: H, length: opt.len, batch_size: 1 });
    var i2v = add('LTXVImgToVideoInplace', { vae: [vae, 0], image: frameAt(W, H), latent: [lat, 0], strength: 1.0, bypass: false });
    var p1 = [cond, 0], n1 = [cond, 1], v1 = [i2v, 0];
    var g1 = addGuides(p1, n1, v1, W, H);
    if (g1) { p1 = g1.p; n1 = g1.n; v1 = g1.l; }
    var alat = add('LTXVEmptyLatentAudio', { frames_number: opt.len, frame_rate: fps, batch_size: 1, audio_vae: [avae, 0] });
    var av = add('LTXVConcatAVLatent', { video_latent: v1, audio_latent: [alat, 0] });
    var sep = sample(p1, n1, [av, 0], SIGMAS_8, t.sampler || 'euler_ancestral');
    var crop = add('LTXVCropGuides', { positive: p1, negative: n1, latent: [sep, 0] });
    var vlat = [crop, 2], outW = W, outH = H;
    // проход 2: латентный апскейл ×2 + доработка, первый кадр снова в полном размере
    if (opt.stage2) {
      var upm = add('LatentUpscaleModelLoader', { model_name: M.upscaler });
      var up = add('LTXVLatentUpsampler', { samples: vlat, upscale_model: [upm, 0], vae: [vae, 0] });
      outW = W * 2; outH = H * 2;
      var i2v2 = add('LTXVImgToVideoInplace', { vae: [vae, 0], image: frameAt(outW, outH), latent: [up, 0], strength: 1.0, bypass: false });
      var p2 = [crop, 0], n2 = [crop, 1], v2 = [i2v2, 0];
      var g2 = addGuides(p2, n2, v2, outW, outH);
      if (g2) { p2 = g2.p; n2 = g2.n; v2 = g2.l; }
      var av2 = add('LTXVConcatAVLatent', { video_latent: v2, audio_latent: [sep, 1] });
      var sep2 = sample(p2, n2, [av2, 0], SIGMAS_STAGE2, 'euler');
      vlat = g2 ? [add('LTXVCropGuides', { positive: p2, negative: n2, latent: [sep2, 0] }), 2] : [sep2, 0];
    }
    var dec = add('VAEDecodeTiled', { samples: vlat, vae: [vae, 0], tile_size: opt.tileSize || 512, overlap: 64, temporal_size: 128, temporal_overlap: 32 });
    var save = add('PreviewImage', { images: [dec, 0] });
    return { graph: G, saveNode: save, outW: outW, outH: outH };
  }
  /* Опорные кадры для статики: [кадр, сила]. Последний кадр — полная сила фиксации,
     промежуточные (каждые 24 кадра) — чуть мягче, чтобы объект в кадре мог двигаться. */
  function lockGuides(f, len) {
    var mv = f.move || 'static';
    if (mv !== 'static' && mv !== 'cinemagraph') return [];
    var lk = f.lock === undefined ? 0.8 : Number(f.lock);
    if (!(lk > 0)) return [];
    lk = Math.min(1, lk);
    var zone = f.lockZone || 'edges', out = [], last = len - 1;
    if (last < 8) return [];
    if (zone === 'end') return [[last, Math.round(lk * 0.6 * 100) / 100]];
    // edges: рамка держится на всех опорах с полной силой — центр всё равно свободен;
    // full: промежуточные опоры мягче, иначе картинка замирает
    var mid = zone === 'edges' || lk >= 0.95 ? lk : Math.round(lk * 0.6 * 100) / 100;
    for (var i = 24; i <= last - 16; i += 24) out.push([i, mid]);
    out.push([last, lk]);
    return out;
  }
  function restyleDirect(t, f) { return t.kind === 'prompt' && (f.mode || 'restyle') !== 'structure' && (Number(f.denoise) || 0.6) <= RESTYLE_DIRECT_MAX; }
  function cameraLoraFor(f) { var m = cameraMove(f.move); return m[2] && Number(f.camStrength === undefined ? 1 : f.camStrength) > 0 ? CAMERA_LORAS[m[2]] : null; }

  /* Размеры 1-го прохода: кратно 32 (64 для апскейлера, чтобы опора в ½ тоже была кратна 32).
     outSide — короткая сторона результата; при втором проходе 1-й идёт в половину. */
  function stageSizes(compW, compH, outSide, stage2, kind, refDown) {
    // опора IC-LoRA в половину размера (upscale, Union Control ref0.5) тоже должна делиться на 32 → сам кадр кратен 64
    var q = (kind === 'upscale' || (refDown || 1) >= 2) ? 64 : 32;
    var side = stage2 ? outSide / 2 : outSide;
    if (kind === 'upscale') side = side;                // латент = side; опора = side/2
    var ar = compW / compH, W, H;
    if (ar >= 1) { H = Math.max(q, Math.round(side / q) * q); W = Math.max(q, Math.round(H * ar / q) * q); }
    else { W = Math.max(q, Math.round(side / q) * q); H = Math.max(q, Math.round(W / ar / q) * q); }
    var maxLong = stage2 ? 960 : 1920;                   // ограничение длинной стороны латента 1-го прохода
    if (Math.max(W, H) > maxLong) { var k = maxLong / Math.max(W, H); W = Math.round(W * k / q) * q; H = Math.round(H * k / q) * q; }
    return { W: W, H: H, outW: stage2 ? W * 2 : W, outH: stage2 ? H * 2 : H };
  }

  /* Короткая сторона результата по режиму разрешения.
     preset — 544/720/1088 из настроек; auto — как у композиции (не больше 1088 — предел модели);
     custom — своё число 256…1088. Ориентация (вертикаль/квадрат/горизонталь) берётся из композиции сама:
     короткой стороной считается ширина у вертикали и высота у горизонтали. Кратность доводит stageSizes. */
  var SHORT_MIN = 256, SHORT_MAX = 1088;
  function resolveShort(compW, compH, mode, outSide, custom) {
    var cs = Math.min(compW, compH) || 720;
    var v = mode === 'auto' ? cs : mode === 'custom' ? (Number(custom) || 720) : (Number(outSide) || 720);
    return Math.max(SHORT_MIN, Math.min(SHORT_MAX, v));
  }
  function aspectLabel(w, h) {
    if (!w || !h) return '';
    var r = w / h, known = [[16 / 9, '16:9'], [9 / 16, '9:16'], [1, '1:1'], [4 / 5, '4:5'], [5 / 4, '5:4'], [4 / 3, '4:3'], [3 / 4, '3:4'], [21 / 9, '21:9'], [2.39, '2.39:1'], [1.85, '1.85:1'], [2, '2:1'], [1 / 2, '1:2']];
    var best = null;
    known.forEach(function (k) { var d = Math.abs(Math.log(r / k[0])); if (d < 0.02 && (!best || d < best[0])) best = [d, k[1]]; });
    var kind = Math.abs(r - 1) < 0.02 ? 'квадрат' : r > 1 ? 'горизонталь' : 'вертикаль';
    return kind + (best && best[1] !== '1:1' ? ' ' + best[1] : '');
  }

  /* Размеры под модель: кратно 32, по короткой стороне */
  function workSize(compW, compH, shortSide, maxLong) {
    var ar = compW / compH, W, H;
    if (ar >= 1) { H = shortSide; W = Math.round(H * ar / 32) * 32; } else { W = shortSide; H = Math.round(W / ar / 32) * 32; }
    if (maxLong) {
      var L = Math.max(W, H);
      if (L > maxLong) { var k = maxLong / L; W = Math.round(W * k / 32) * 32; H = Math.round(H * k / 32) * 32; }
    }
    return { W: Math.max(64, W), H: Math.max(64, H) };
  }

  /* Разбивка на проходы по 8n+1 кадров; последний добивается повтором последнего кадра */
  function planChunks(N, chunkLen) {
    chunkLen = Math.max(9, chunkLen - ((chunkLen - 1) % 8));
    var out = [], start = 0;
    while (start < N) {
      var take = Math.min(chunkLen, N - start);
      var len = take; if ((len - 1) % 8) len = len + (8 - (len - 1) % 8);
      out.push({ start: start, take: take, len: len });
      start += take;
    }
    return out;
  }

  g.LTXTools = { buildCamXfer: buildCamXfer, isEditMode: isEditMode, editStrip: editStrip, EDIT_LORAS: EDIT_LORAS, EDIT_COLORS: EDIT_COLORS, AI_IMPROVE_EDIT: AI_IMPROVE_EDIT, resolveShort: resolveShort, aspectLabel: aspectLabel, refineSigmas: refineSigmas, stepCount: stepCount, SIGMAS_8: SIGMAS_8, SIGMAS_STAGE2: SIGMAS_STAGE2, AI_TASKS: AI_TASKS, AI_IMPROVE: AI_IMPROVE, TOOLS: TOOLS, buildI2V: buildI2V, denoiseSigmas: denoiseSigmas, restyleDirect: restyleDirect, relightDir: relightDir, relightParams: relightParams, lockGuides: lockGuides, cameraLoraFor: cameraLoraFor, CAMERA_MOVES: CAMERA_MOVES, CAMERA_LORAS: CAMERA_LORAS, toolById: toolById, buildGraph: buildGraph, stageSizes: stageSizes, workSize: workSize, planChunks: planChunks, val: val };
})(typeof window !== 'undefined' ? window : global);
