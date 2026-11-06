"""Zouwu Forge — служебные ноды ComfyUI (ставятся плагином автоматически).

ZFMemoryFactor — запас видеопамяти под длинные куски. ComfyUI оценивает, сколько видеопамяти займут
промежуточные данные генерации (memory_usage_factor модели × размер латента), и на остаток грузит
веса модели. Для LTX оценка занижена, и на длинных кусках (150+ кадров) генерация падает по памяти.
Множитель увеличивает оценку: больше весов уходит в ОЗУ, генерация медленнее, но длинный кусок
проходит целиком — без стыков. Множитель 1 — без изменений.
"""
import logging

import comfy.patcher_extension


class _FactorWrapper:
    def __init__(self, mult):
        self.mult = mult

    def __call__(self, executor, model, noise_shape, *args, **kwargs):
        m = model.clone()
        orig = m.model.memory_usage_factor
        m.model.memory_usage_factor = orig * self.mult
        logging.info("Zouwu Forge: memory_usage_factor %.4f -> %.4f (x%.2f)", orig, orig * self.mult, self.mult)
        try:
            return executor(m, noise_shape, *args, **kwargs)
        finally:
            m.model.memory_usage_factor = orig


class ZFMemoryFactor:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "multiplier": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 20.0, "step": 0.05}),
        }}

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = "Zouwu Forge"

    def patch(self, model, multiplier):
        if abs(multiplier - 1.0) < 1e-6:
            return (model,)
        m = model.clone()
        m.add_wrapper_with_key(comfy.patcher_extension.WrappersMP.PREPARE_SAMPLING, "zf_memory_factor", _FactorWrapper(multiplier))
        return (m,)


NODE_CLASS_MAPPINGS = {"ZFMemoryFactor": ZFMemoryFactor}
NODE_DISPLAY_NAME_MAPPINGS = {"ZFMemoryFactor": "Zouwu Forge: запас видеопамяти"}
