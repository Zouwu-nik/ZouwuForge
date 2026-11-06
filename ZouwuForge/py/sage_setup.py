# Zouwu Forge — установка Sage Attention в Python движка (ComfyUI portable) с проверкой и откатом.
# Шаги: проверка torch/CUDA → triton-windows под версию torch → заголовки Python (include/libs, нужны Triton
# для сборки ядер; во встроенном Python их нет — берём из официального пакета python на NuGet той же версии)
# → sageattention 1.0.6 (на Triton, без компилятора) → тест на видеокарте. Если тест не прошёл — всё,
# что поставили, удаляется, движок остаётся как был.
# Использование: sage_setup.py <папка настроек плагина>     (запускать python_embeded\python.exe -s)
import io
import json
import os
import subprocess
import sys
import sysconfig
import urllib.request
import zipfile

APPDIR = sys.argv[1] if len(sys.argv) > 1 else '.'
STATE = os.path.join(APPDIR, 'sage.json')
PY = sys.executable
PYDIR = os.path.dirname(PY)


def say(*a):
    print(*a, flush=True)


LAST_ERR = ['']


def pip(*args):
    say('INFO pip ' + ' '.join(args))
    r = subprocess.run([PY, '-s', '-m', 'pip', *args, '--disable-pip-version-check', '--no-input'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    lines = (r.stdout + r.stderr).strip().splitlines()
    tail = [l for l in lines if l.strip()][-4:]
    for line in tail:
        say('  ' + line[:300])
    if r.returncode != 0:
        errs = [l for l in lines if 'ERROR' in l or 'error' in l]
        LAST_ERR[0] = (errs[-1] if errs else (tail[-1] if tail else 'pip завершился с ошибкой'))[:300]
    return r.returncode == 0


def installed(name):
    r = subprocess.run([PY, '-s', '-m', 'pip', 'show', name], capture_output=True, text=True)
    return r.returncode == 0


def save(ok, **kw):
    kw['ok'] = ok
    os.makedirs(APPDIR, exist_ok=True)
    with open(STATE, 'w', encoding='utf-8') as f:
        json.dump(kw, f, ensure_ascii=False)


TEST = r'''
import torch
from sageattention import sageattn
q = torch.randn(1, 8, 256, 64, device="cuda", dtype=torch.float16)
o = sageattn(q, q, q, tensor_layout="HND", is_causal=False)
ref = torch.nn.functional.scaled_dot_product_attention(q, q, q)
err = (o.float() - ref.float()).abs().max().item()
print("SAGE_OK" if torch.isfinite(o).all().item() and err < 0.1 else "SAGE_BAD", err)
'''


def headers():
    inc = sysconfig.get_paths().get('include') or os.path.join(PYDIR, 'include')
    if os.path.exists(os.path.join(inc, 'Python.h')) and os.path.isdir(os.path.join(PYDIR, 'libs')):
        say('INFO заголовки Python уже есть')
        return True
    ver = '%d.%d.%d' % sys.version_info[:3]
    url = 'https://www.nuget.org/api/v2/package/python/' + ver
    say('INFO скачиваю заголовки Python ' + ver + ' (NuGet)')
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'ZouwuForge'}), timeout=120) as r:
            data = r.read()
        z = zipfile.ZipFile(io.BytesIO(data))
        n = 0
        for m in z.namelist():
            for part, dst in (('tools/include/', 'include'), ('tools/libs/', 'libs')):
                if m.startswith(part) and not m.endswith('/'):
                    out = os.path.join(PYDIR, dst, m[len(part):].replace('/', os.sep))
                    os.makedirs(os.path.dirname(out), exist_ok=True)
                    with open(out, 'wb') as f:
                        f.write(z.read(m))
                    n += 1
        say('INFO заголовки установлены: %d файлов' % n)
        return n > 0
    except Exception as e:
        say('WARN не удалось скачать заголовки Python %s: %s' % (ver, e))
        return False


def main():
    try:
        import torch
    except Exception as e:
        say('ERROR в движке нет torch: %s' % e)
        save(False, reason='no torch')
        return 1
    tv = torch.__version__.split('+')[0]
    major, minor = (int(x) for x in tv.split('.')[:2])
    say('INFO Python %s, torch %s, CUDA %s' % (sys.version.split()[0], tv, torch.version.cuda))
    if not torch.cuda.is_available():
        say('ERROR torch не видит видеокарту (CUDA недоступна) — Sage Attention не поставить')
        save(False, reason='no cuda')
        return 1
    cap = torch.cuda.get_device_capability(0)
    say('INFO видеокарта %s, compute %d.%d' % (torch.cuda.get_device_name(0), cap[0], cap[1]))
    if cap[0] < 8:
        say('ERROR Sage Attention нужна RTX 30 и новее')
        save(False, reason='old gpu')
        return 1

    had_triton = installed('triton-windows') or installed('triton')
    had_sage = installed('sageattention')
    say('PROGRESS 1 4')
    if not had_triton:
        # torch 2.7 → triton 3.3, 2.8 → 3.4, 2.9 → 3.5 …; если точной пары ещё нет (новый torch) — пробуем соседние
        tmin = minor - 4 if major == 2 else 3
        specs = ['triton-windows>=3.%d,<3.%d' % (tmin, tmin + 1), 'triton-windows>=3.%d,<3.%d' % (tmin - 1, tmin),
                 'triton-windows<3.%d' % (tmin + 2), 'triton-windows']
        if not any(pip('install', sp) for sp in specs):
            say('ERROR не удалось поставить triton-windows под torch %s: %s' % (tv, LAST_ERR[0]))
            save(False, reason='triton', detail=LAST_ERR[0], torch=tv, python=sys.version.split()[0])
            return 1
    say('PROGRESS 2 4')
    headers()
    say('PROGRESS 3 4')
    if not had_sage and not pip('install', 'sageattention==1.0.6'):
        say('ERROR не удалось поставить sageattention: ' + LAST_ERR[0])
        if not had_triton:
            pip('uninstall', '-y', 'triton-windows')
        save(False, reason='sage pip', detail=LAST_ERR[0])
        return 1
    say('INFO проверяю на видеокарте (первый запуск компилирует ядра, до пары минут)…')
    try:
        r = subprocess.run([PY, '-s', '-c', TEST], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
        out = (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        out = 'тест завис дольше 15 минут'
    say('PROGRESS 4 4')
    if 'SAGE_OK' in out:
        save(True, torch=tv, sage='1.0.6')
        say('RESULT ok')
        return 0
    say('WARN тест не прошёл: ' + out[-600:])
    if not had_sage:
        pip('uninstall', '-y', 'sageattention')
    if not had_triton:
        pip('uninstall', '-y', 'triton-windows')
    save(False, reason='test', detail=out[-600:])
    say('ERROR Sage Attention не заработала на этой системе — всё откатил, движок как был')
    return 1


if __name__ == '__main__':
    sys.exit(main())
