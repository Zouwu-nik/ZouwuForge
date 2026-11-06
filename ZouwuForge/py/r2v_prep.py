# Zouwu Forge — кадры для «Заменить объект по образцу» (LoRA ltx23_inpaint_masked_r2v, Alissonerdx).
# Повторяет подготовку из воркфлоу автора:
#   * область замены (маска из AE, расширенная и огрублённая блоками) заливается пурпурным (255, 0, 255);
#   * слева к каждому кадру добавляется полоса с образцом нового объекта на хромакейном зелёном (0, 255, 0)
#     (ReservedRegionFrameComposer: «left», объект вписан с полями и масштабом 90 %).
# Использование:
#   r2v_prep.py <src> <mask> <ref.png> <out> <W> <H> <strip> <grow_px> <block_px>
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

MAGENTA = (255, 0, 255)
GREEN = (0, 255, 0)


def pngs(d):
    return [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.lower().endswith('.png')]


def dilate(m, r):
    """Квадратное расширение бинарной маски на r пикселей (через интегральное изображение)."""
    if r <= 0:
        return m
    h, w = m.shape
    ii = np.zeros((h + 1, w + 1), np.int32)
    ii[1:, 1:] = np.cumsum(np.cumsum(m.astype(np.int32), 0), 1)
    y0 = np.clip(np.arange(h) - r, 0, h)
    y1 = np.clip(np.arange(h) + r + 1, 0, h)
    x0 = np.clip(np.arange(w) - r, 0, w)
    x1 = np.clip(np.arange(w) + r + 1, 0, w)
    s = ii[y1][:, x1] - ii[y0][:, x1] - ii[y1][:, x0] + ii[y0][:, x0]
    return s > 0


def blockify(m, b):
    """Как BlockifyMask (KJNodes): блок b×b закрашивается целиком, если в нём есть хоть один пиксель маски."""
    if b <= 1:
        return m
    h, w = m.shape
    H, W = -(-h // b) * b, -(-w // b) * b
    p = np.zeros((H, W), bool)
    p[:h, :w] = m
    blk = p.reshape(H // b, b, W // b, b).any(axis=(1, 3))
    return np.repeat(np.repeat(blk, b, 0), b, 1)[:h, :w]


def ref_strip(ref_path, S, H):
    im = Image.open(ref_path).convert('RGBA')
    a = np.asarray(im)[..., 3]
    if a.min() >= 250:
        print('WARN Образец без прозрачности — в полосу попадёт весь кадр слоя. Лучше вырезанный объект (PNG с альфой, Roto, маска).', flush=True)
        box = (0, 0, im.width, im.height)
    else:
        ys, xs = np.where(a > 8)
        if not len(xs):
            raise SystemExit('ERROR Слой-образец пустой (полностью прозрачный) в этом кадре')
        box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    obj = im.crop(box)
    margin = max(4, round(12 * H / 960))
    aw, ah = (S - 2 * margin) * 0.9, (H - 2 * margin) * 0.9
    k = min(aw / obj.width, ah / obj.height)
    obj = obj.resize((max(1, round(obj.width * k)), max(1, round(obj.height * k))), Image.LANCZOS)
    strip = Image.new('RGB', (S, H), GREEN)
    strip.paste(obj, ((S - obj.width) // 2, (H - obj.height) // 2), obj)
    print('INFO Образец: %dx%d px из слоя, в полосе %dx%d' % (box[2] - box[0], box[3] - box[1], obj.width, obj.height), flush=True)
    return strip


def main():
    src, mdir, ref, out = sys.argv[1:5]
    W, H, S, grow, block = (int(x) for x in sys.argv[5:10])
    os.makedirs(out, exist_ok=True)
    frames, masks = pngs(src), pngs(mdir)
    if not frames:
        raise SystemExit('ERROR Нет кадров в ' + src)
    if not masks:
        raise SystemExit('ERROR Нет кадров маски в ' + mdir)
    strip = ref_strip(ref, S, H)
    cover = [0.0] * len(frames)

    def one(i):
        im = Image.open(frames[i]).convert('RGB')
        if im.size != (W, H):
            im = im.resize((W, H), Image.LANCZOS)
        mk = Image.open(masks[min(i, len(masks) - 1)]).convert('L')
        if mk.size != (W, H):
            mk = mk.resize((W, H), Image.BILINEAR)
        m = np.asarray(mk) > 127
        m = blockify(dilate(m, grow), block)
        cover[i] = float(m.mean())
        arr = np.asarray(im).copy()
        arr[m] = MAGENTA
        canvas = Image.new('RGB', (S + W, H))
        canvas.paste(strip, (0, 0))
        canvas.paste(Image.fromarray(arr), (S, 0))
        canvas.save(os.path.join(out, 'r2v_%06d.png' % i), compress_level=1)
        return i

    done = 0
    with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 4)) as ex:
        for _ in ex.map(one, range(len(frames))):
            done += 1
            if done % 10 == 0 or done == len(frames):
                print('PROGRESS', done, len(frames), flush=True)
    avg = sum(cover) / len(cover)
    if max(cover) == 0:
        print('WARN Маска пустая во всех кадрах — менять нечего. Проверьте слой-маску (белое = заменить).', flush=True)
    elif avg < 0.003:
        print('WARN Маска очень маленькая (%.2f%% кадра) — новому объекту может не хватить места. Увеличьте «Расширить маску» или блоки.' % (avg * 100), flush=True)
    print('INFO Маска занимает в среднем %.1f%% кадра' % (avg * 100), flush=True)
    print('RESULT', len(frames), S + W, H, flush=True)


if __name__ == '__main__':
    main()
