"""DLSS5 Bridge — прогон PNG-секвенции через DLSS 5 Neural Rendering.

Запускается встроенным Python сборки «DLSS 5 Visual Enhancer» (Merserk, v1.0):
использует её модули src.runtime / src.video и её рантайм bin/runtime.
Печатает в stdout строки:  PROGRESS <done> <total>  и в конце  RESULT <json>.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", required=True, help="папка DLSS 5 Visual Enhancer")
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--factor", type=float, default=1.0)
    ap.add_argument("--style", default="Default")
    ap.add_argument("--preset", default="Default")
    ap.add_argument("--intensity", type=float, default=1.0)
    ap.add_argument("--tone", type=float, default=1.0)
    ap.add_argument("--structure", type=float, default=1.0)
    ap.add_argument("--skin", type=float, default=-1.0)
    ap.add_argument("--warmup", type=int, default=0)
    ap.add_argument("--scene", type=float, default=0.24)
    ap.add_argument("--fake", action="store_true", help="тест без GPU: копирует кадры")
    a = ap.parse_args()

    sys.path.insert(0, str(Path(a.app).resolve()))
    import numpy as np
    from PIL import Image
    from src import runtime as rt
    from src import video as vd

    src = Path(a.src)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in src.iterdir() if p.suffix.lower() in (".png", ".tif", ".tiff"))
    if not files:
        raise SystemExit("Нет кадров (PNG/TIFF) в " + str(src))
    n = len(files)

    with Image.open(files[0]) as im0:
        in_w, in_h = im0.size
    factor, mode = vd.resolve_upscaling_mode(a.factor)
    out_w, out_h = vd.resolve_output_size(in_w, in_h, factor)
    opts = vd.ConversionOptions(
        nr_style=a.style, nr_preset=a.preset, nr_intensity=a.intensity,
        local_tone_strength=a.tone, local_structure_strength=a.structure,
        skin_structure_strength=a.skin, upscaling_factor=factor, warmup_frames=a.warmup,
    )
    native = vd.resolve_native_settings(opts)
    print(f"INFO вход {in_w}x{in_h} → выход {out_w}x{out_h}, режим {mode['name']}", flush=True)

    t0 = time.perf_counter()
    if a.fake:
        session = None
        rw, rh = in_w, in_h
    else:
        rt.validate_runtime_files()
        gpu = rt.detect_gpu()
        print(f"INFO GPU: {gpu.get('name', '?')}", flush=True)
        controller = rt.JobController()
        session = rt.DLSSFrameSession(
            input_width=in_w, input_height=in_h, output_width=out_w, output_height=out_h,
            frame_count=n, warmup_frames=a.warmup, factor=factor, mode=mode,
            native_settings=native, controller=controller,
        )
        rw, rh = session.render_width, session.render_height
        print(f"INFO DLSS {mode['name']}: рендер {rw}x{rh} → {out_w}x{out_h}", flush=True)

    guides = vd.TemporalGuideGenerator(rw, rh)
    resets = 0
    try:
        for i, f in enumerate(files):
            with Image.open(f) as im:
                rgba = np.asarray(im.convert("RGBA"), dtype=np.uint8)
            if rgba.shape[1] != rw or rgba.shape[0] != rh:
                rgba = rt.resize_fit(rgba, rw, rh)
            rgba = np.ascontiguousarray(rgba, dtype=np.uint8)
            g = guides.process(rgba)
            resets += int(g.reset and i)
            if session is None:
                result = rgba
            else:
                result, _ = session.process(index=i, rgba=rgba, motion=g.motion, reset=g.reset, pts=i)
            Image.fromarray(result[..., :3], "RGB").save(out / f"dlss5_{i:06d}.png", compress_level=1)
            print(f"PROGRESS {i + 1} {n}", flush=True)
        evidence = {}
        if session is not None:
            session.close()
            session = None
            try:
                ev = rt.verify_feature_18([])
                evidence = {"verified": True, "native_fallback": bool(ev.get("nr_native_fallback"))}
            except Exception as exc:  # рендер готов, но доказательства feature 18 нет
                evidence = {"verified": False, "warning": str(exc)[:600]}
    finally:
        if session is not None:
            session.abort()

    dt = time.perf_counter() - t0
    print("RESULT " + json.dumps({
        "frames": n, "width": out_w, "height": out_h, "seconds": round(dt, 1),
        "fps": round(n / dt, 2) if dt else 0, "scene_resets": resets, **evidence,
    }, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:
        print("ERROR " + str(exc).replace("\n", " | ")[:2000], flush=True)
        sys.exit(1)
