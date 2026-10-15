# Zouwu Forge — уменьшает кадры из AE до рабочего размера прохода, пока они не ушли в движок.
# 4K-кадры целиком в памяти (73 × 3840×2160 float32 ≈ 7 ГБ) роняют ComfyUI с MemoryError.
# Использование: fit_frames.py <папка> <ширина> <высота>
import sys, os
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

def fit(path, w, h):
    try:
        im = Image.open(path)
        if im.size == (w, h):
            return 0
        im = im.convert('RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB')
        im.resize((w, h), Image.LANCZOS).save(path, compress_level=1)
        return 1
    except Exception as e:
        print('ERROR', os.path.basename(path), e, flush=True)
        return 0

if __name__ == '__main__':
    d, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    files = [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.lower().endswith('.png')]
    n = 0
    with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 4)) as ex:
        for i, r in enumerate(ex.map(lambda p: fit(p, w, h), files)):
            n += r
            if (i + 1) % 10 == 0 or i + 1 == len(files):
                print('PROGRESS', i + 1, len(files), flush=True)
    print('RESULT', n, 'of', len(files), 'resized to', w, 'x', h, flush=True)
