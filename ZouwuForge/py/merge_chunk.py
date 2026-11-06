# Zouwu Forge — сборка частей генерации внахлёст.
# Кадры части кладутся в общую папку результата; первые <overlap> кадров части плавно смешиваются
# с уже записанными кадрами предыдущей части (вес растёт от 0 к 1 по S-кривой) — стык не дёргается.
# Использование: merge_chunk.py <папка части> <папка результата> <первый кадр> <нахлёст> <сколько кадров взять>
import os
import sys

import numpy as np
from PIL import Image


def main():
    cdir, out, start, ov, take = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
    files = sorted(f for f in os.listdir(cdir) if f.lower().endswith('.png'))[:take]
    os.makedirs(out, exist_ok=True)
    blended = 0
    for i, fn in enumerate(files):
        dst = os.path.join(out, 'ltx_%06d.png' % (start + i))
        src = os.path.join(cdir, fn)
        if i < ov and os.path.exists(dst):
            x = (i + 1) / (ov + 1)
            w = x * x * (3 - 2 * x)                      # smoothstep
            a = Image.open(dst).convert('RGB')
            b = Image.open(src).convert('RGB')
            if b.size != a.size:
                b = b.resize(a.size, Image.LANCZOS)
            m = np.asarray(a, np.float32) * (1 - w) + np.asarray(b, np.float32) * w
            Image.fromarray(np.clip(m + 0.5, 0, 255).astype(np.uint8)).save(dst, compress_level=1)
            blended += 1
        else:
            os.replace(src, dst) if not os.path.exists(dst) else (os.remove(dst), os.replace(src, dst))
    print('RESULT', len(files), 'blended', blended, flush=True)


if __name__ == '__main__':
    main()
