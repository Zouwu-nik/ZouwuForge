"""Zouwu Forge — фоновая установка: ноды ComfyUI и модели LTX 2.5.

Запускается встроенным Python портативного ComfyUI отдельным процессом,
поэтому продолжает работать, даже если закрыть панель или After Effects.
Прогресс пишет в JSON (status), подробности — в лог.

Использование:  python -s ltx_setup.py <job.json>
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

CHUNK = 8 * 1024 * 1024
UA = "ZouwuForge/1.0"
HF_BASE = os.environ.get("LTXPOST_HF_BASE", "https://huggingface.co")
GH_BASE = os.environ.get("LTXPOST_GH_BASE", "https://codeload.github.com")


class Job:
    def __init__(self, path: str) -> None:
        self.cfg = json.loads(Path(path).read_text(encoding="utf-8"))
        self.status_path = Path(self.cfg["statusFile"])
        self.log_path = Path(self.cfg["logFile"])
        self.status: dict = {"state": "starting", "pid": os.getpid(), "started": time.time()}
        self._last = 0.0

    def log(self, msg: str) -> None:
        line = time.strftime("[%H:%M:%S] ") + msg
        pass
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    def write(self, force: bool = False, **kw) -> None:
        self.status.update(kw)
        now = time.time()
        if not force and now - self._last < 0.8:
            return
        self._last = now
        self.status["updated"] = now
        tmp = self.status_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.status, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.status_path)


def request(url: str, token: str | None = None, rng: str | None = None) -> urllib.request.Request:
    h = {"User-Agent": UA}
    if token and url.startswith(HF_BASE):
        h["Authorization"] = "Bearer " + token
    if rng:
        h["Range"] = rng
    return urllib.request.Request(url, headers=h)


def hf_url(repo: str, path: str) -> str:
    return f"{HF_BASE}/{repo}/resolve/main/{path}"


# ------------------------------------------------------------------ ноды
def install_nodes(job: Job) -> None:
    comfy = Path(job.cfg["comfyDir"])
    nodes_dir = comfy / "custom_nodes"
    py = job.cfg["python"]
    for i, repo in enumerate(job.cfg.get("nodes", [])):
        name = repo.split("/")[1]
        dest = nodes_dir / name
        mark = dest / ".ltxpost_ok"
        job.write(force=True, state="nodes", step=f"Ноды ComfyUI: {name}", index=i + 1, count=len(job.cfg["nodes"]))
        if mark.exists():
            job.log(f"{name}: уже установлена")
            continue
        job.log(f"{name}: скачиваю")
        tmp = Path(tempfile.mkdtemp(prefix="ltxnode_"))
        try:
            zpath = tmp / "n.zip"
            with urllib.request.urlopen(request(f"{GH_BASE}/{repo}/zip/HEAD"), timeout=120) as r, zpath.open("wb") as f:
                shutil.copyfileobj(r, f, CHUNK)
            with zipfile.ZipFile(zpath) as z:
                z.extractall(tmp / "x")
            inner = next(p for p in (tmp / "x").iterdir() if p.is_dir())
            if dest.exists():
                shutil.rmtree(dest, ignore_errors=True)
            shutil.move(str(inner), str(dest))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        req = dest / "requirements.txt"
        if req.exists():
            job.log(f"{name}: ставлю зависимости")
            job.write(force=True, step=f"Ноды ComfyUI: {name} — зависимости")
            p = subprocess.run([py, "-s", "-m", "pip", "install", "--no-warn-script-location", "-q", "-r", str(req)],
                               capture_output=True, text=True, encoding="utf-8", errors="replace")
            if p.returncode != 0:
                job.log(p.stdout[-2000:] + p.stderr[-4000:])
                raise RuntimeError(f"pip не смог поставить зависимости {name}:\n{p.stderr[-800:]}")
        mark.write_text(time.strftime("%Y-%m-%d %H:%M:%S"), encoding="utf-8")
        job.log(f"{name}: готово")


# ------------------------------------------------------------------ модели
def probe(url: str, token: str | None) -> tuple[int, int]:
    """Возвращает (http_code, total_size). Работает через редиректы HF."""
    try:
        with urllib.request.urlopen(request(url, token, "bytes=0-0"), timeout=60) as r:
            cr = r.headers.get("Content-Range", "")
            total = int(cr.split("/")[-1]) if "/" in cr else int(r.headers.get("Content-Length", "0"))
            return r.status, total
    except urllib.error.HTTPError as e:
        return e.code, 0


def check_access(job: Job, files: list[dict]) -> dict[str, int]:
    token = job.cfg.get("token")
    sizes: dict[str, int] = {}
    locked: list[str] = []
    missing: list[str] = []
    seen_repo: set[str] = set()
    for i, f in enumerate(files):
        job.write(state="checking", step=f"Проверяю доступ: {f['file']}", index=i + 1, count=len(files))
        code, total = probe(hf_url(f["repo"], f["path"]), token)
        if code in (200, 206):
            sizes[f["path"] + "|" + f["repo"]] = total
        elif code in (401, 403):
            if f["repo"] not in seen_repo:
                locked.append(f["repo"])
                seen_repo.add(f["repo"])
        else:
            missing.append(f"{f['repo']}/{f['path']} (HTTP {code})")
    if locked:
        job.write(force=True, state="need_access", repos=locked,
                  step="Нужно принять соглашение на Hugging Face для части моделей")
        job.log("Нет доступа к: " + ", ".join(locked))
        sys.exit(3)
    if missing:
        raise RuntimeError("Файлы не найдены на Hugging Face:\n" + "\n".join(missing))
    return sizes


def download(job: Job, files: list[dict], sizes: dict[str, int]) -> None:
    token = job.cfg.get("token")
    models = Path(job.cfg["comfyDir"]) / "models"
    plan = []
    total_all = 0
    finished = 0  # байты полностью готовых файлов + начатых .part
    for f in files:
        size = sizes.get(f["path"] + "|" + f["repo"], 0)
        dest = models / f["dir"] / f["file"]
        if dest.exists() and (not size or dest.stat().st_size == size):
            continue
        part = dest.with_name(dest.name + ".part")
        plan.append((f, dest, part, size))
        total_all += size
        finished += min(part.stat().st_size if part.exists() else 0, size)
    job.log(f"К загрузке: {len(plan)} файлов, {total_all / 1e9:.1f} ГБ (уже скачано {finished / 1e9:.1f} ГБ)")
    # хватит ли места: оставшееся + 2 ГБ запаса
    need = total_all - finished + 2e9
    try:
        free = shutil.disk_usage(models if models.exists() else models.parent).free
    except Exception:
        free = None
    if free is not None and plan and free < need:
        raise RuntimeError(f"Не хватает места на диске {models.drive or models}: свободно {free / 1e9:.1f} ГБ, "
                           f"нужно ещё около {need / 1e9:.1f} ГБ. Освободите место (или выберите модели полегче) и запустите установку снова — "
                           f"уже скачанное сохранится.")
    t0 = time.time()
    start_bytes = finished
    for i, (f, dest, part, size) in enumerate(plan):
        dest.parent.mkdir(parents=True, exist_ok=True)
        label = f.get("label") or f["file"]
        before = min(part.stat().st_size if part.exists() else 0, size)
        ok = False
        fails = 0          # попытки подряд без прогресса; пока файл качается — переподключаемся сколько нужно
        last_err = ""
        while fails < 8:
            pre = part.stat().st_size if part.exists() else 0
            if size and pre >= size:
                ok = True
                break
            try:
                req = request(hf_url(f["repo"], f["path"]), token, f"bytes={pre}-" if pre else None)
                with urllib.request.urlopen(req, timeout=120) as r:
                    if pre and r.status != 206:
                        pre = 0
                    with part.open("ab" if pre else "wb") as out:
                        got = pre
                        while True:
                            buf = r.read(CHUNK)
                            if not buf:
                                break
                            out.write(buf)
                            got += len(buf)
                            overall = finished - before + got
                            el = max(1e-3, time.time() - t0)
                            job.write(state="downloading", step=f"Скачиваю: {label}", index=i + 1, count=len(plan),
                                      file=f["file"], fileDone=got, fileTotal=size,
                                      done=overall, total=total_all, speed=(overall - start_bytes) / el)
                cur = part.stat().st_size
                if size and cur < size:
                    fails = 0 if cur > pre else fails + 1
                    job.log(f"{label}: соединение оборвалось на {cur / 1e6:.0f} МБ, докачиваю")
                    time.sleep(2)
                    continue
                ok = True
                break
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                if getattr(e, "errno", None) == 28 or "No space left" in str(e) or getattr(e, "winerror", None) == 112:
                    psz = part.stat().st_size if part.exists() else 0
                    try:
                        fr = shutil.disk_usage(dest.parent).free
                    except Exception:
                        fr = 0
                    if fr > 2e9:
                        # место есть, а Windows говорит «диск полон» — почти всегда FAT32 (максимум 4 ГБ на файл)
                        raise RuntimeError(f"Диск {models.drive or models} не принимает файлы больше 4 ГБ (свободно {fr / 1e9:.0f} ГБ, "
                                           f"файл оборвался на {psz / 1e9:.2f} ГБ). Скорее всего он в формате FAT32. "
                                           f"Поставьте движок на диск с NTFS (или exFAT) — модели весят до 19 ГБ одним файлом.")
                    raise RuntimeError(f"Закончилось место на диске при загрузке {label}. Освободите место и запустите установку снова — "
                                       f"скачанное ({(part.stat().st_size if part.exists() else 0) / 1e9:.1f} ГБ) сохранится.")
                cur = part.stat().st_size if part.exists() else 0
                fails = 0 if cur > pre else fails + 1
                last_err = str(e)
                job.log(f"{label}: обрыв ({e}), повтор через 10 с" + (f" (без прогресса {fails}/8)" if fails else ""))
                time.sleep(10)
        if not ok:
            raise RuntimeError(f"Не удалось скачать {label}: 8 попыток подряд без прогресса. Последняя ошибка: {last_err or 'обрыв соединения'}. "
                               f"Проверьте интернет/VPN и запустите установку снова — скачанное сохранится.")
        real = part.stat().st_size
        if size and real != size:
            raise RuntimeError(f"{label}: размер {real} вместо {size}. Запустите установку ещё раз — докачает")
        os.replace(part, dest)
        finished += size - before
        job.write(force=True, done=finished, total=total_all)
        job.log(f"{label}: готово")


def main() -> int:
    job = Job(sys.argv[1])
    try:
        job.log("Старт установки Zouwu Forge")
        install_nodes(job)
        files = job.cfg.get("files", [])
        if files:
            sizes = check_access(job, files)
            download(job, files, sizes)
        job.write(force=True, state="done", step="Установка завершена")
        job.log("Готово")
        return 0
    except SystemExit:
        raise
    except Exception as e:
        job.log(traceback.format_exc())
        job.write(force=True, state="error", step="Ошибка", message=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
