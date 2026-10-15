"""Приводит вывод AE к PNG-секвенции: видео → кадры (ffmpeg из imageio-ffmpeg), TIFF → PNG (Pillow).
Использование: python -s to_png.py <источник: файл видео или папка> <папка для PNG> <префикс>"""
import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    src, out, prefix = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    out.mkdir(parents=True, exist_ok=True)
    if src.is_file():
        try:
            import imageio_ffmpeg
        except ImportError:  # нет в движке — ставим во встроенный Python
            subprocess.run([sys.executable, "-s", "-m", "pip", "install", "-q", "imageio-ffmpeg"], check=True)
            import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        p = subprocess.run([ff, "-v", "error", "-y", "-i", str(src), "-vsync", "0", "-start_number", "0",
                            str(out / f"{prefix}_%05d.png")], capture_output=True, text=True)
        if p.returncode:
            print("ERROR " + p.stderr[-1500:], flush=True)
            return 1
        src.unlink(missing_ok=True)
    else:
        from PIL import Image
        files = sorted(f for f in src.iterdir() if f.suffix.lower() in (".tif", ".tiff"))
        for i, f in enumerate(files):
            with Image.open(f) as im:
                im.convert("RGBA" if "A" in im.getbands() else "RGB").save(out / f"{prefix}_{i:05d}.png", compress_level=1)
            f.unlink()
    print("OK " + str(len([f for f in out.iterdir() if f.suffix == ".png"])), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
