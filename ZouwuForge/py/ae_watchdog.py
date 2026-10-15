# Zouwu Forge — сторож движка: когда After Effects закрыт, останавливает ComfyUI и помощника (llama-server).
# Использование: ae_watchdog.py <pid движка> <папка настроек>
import os, sys, time, subprocess

NO_WIN = 0x08000000  # CREATE_NO_WINDOW


def tasklist(flt):
    try:
        return subprocess.run(['tasklist', '/FI', flt, '/NH'], capture_output=True, text=True,
                              creationflags=NO_WIN, timeout=20).stdout or ''
    except Exception:
        return None  # не смогли проверить — ничего не делаем


def alive(pid):
    out = tasklist('PID eq %d' % pid)
    return True if out is None else (' %d ' % pid) in (' ' + ' '.join(out.split()) + ' ')


def ae_running():
    out = tasklist('IMAGENAME eq AfterFX.exe')
    return True if out is None else 'afterfx.exe' in out.lower()


def kill(pid):
    try:
        subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True, creationflags=NO_WIN, timeout=30)
    except Exception:
        pass


def read_pid(f):
    try:
        with open(f) as fh:
            return int(fh.read().strip())
    except Exception:
        return 0


def main():
    pid, appdir = int(sys.argv[1]), sys.argv[2]
    eng_file = os.path.join(appdir, 'engine.pid')
    busy_file = os.path.join(appdir, 'busy.flag')
    misses = 0
    while True:
        time.sleep(10)
        # идёт генерация — никаких проверок, только stat одного файла (флаг старше 12 ч считаем забытым)
        try:
            if time.time() - os.path.getmtime(busy_file) < 12 * 3600:
                misses = 0
                continue
        except OSError:
            pass
        if not alive(pid):
            return  # движок уже остановлен вручную
        if read_pid(eng_file) not in (0, pid):
            return  # запущен другой движок — у него свой сторож
        misses = 0 if ae_running() else misses + 1
        if misses >= 2:  # AE нет ~20 секунд подряд
            llm = read_pid(os.path.join(appdir, 'llm.pid'))
            if llm:
                kill(llm)
            kill(pid)
            for f in (eng_file, os.path.join(appdir, 'llm.pid')):
                try:
                    if read_pid(f) in (pid, llm):
                        os.remove(f)
                except Exception:
                    pass
            return


if __name__ == '__main__':
    main()
