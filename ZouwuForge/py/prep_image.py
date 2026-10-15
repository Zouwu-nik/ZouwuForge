# Zouwu Forge — уменьшает кадр для помощника (ЛЛМ): JPEG, длинная сторона до N пикселей.
# prep_image.py <вход> <выход.jpg> [1024]
import sys, time
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
n = int(sys.argv[3]) if len(sys.argv) > 3 else 1024

im = None
for attempt in range(20):          # After Effects мог ещё не дописать PNG — ждём до ~10 с
    try:
        with Image.open(src) as f:
            im = f.convert('RGB')
        break
    except (OSError, SyntaxError):
        time.sleep(0.5)
if im is None:
    sys.exit('After Effects не дописал кадр ' + src)

k = n / max(im.size)
if k < 1:
    im = im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.LANCZOS)
im.save(dst, quality=90)
print('RESULT', im.size[0], im.size[1], flush=True)
