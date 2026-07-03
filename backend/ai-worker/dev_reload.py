from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
WATCH_TARGETS = [
    ROOT_DIR / "worker.py",
    ROOT_DIR / "ai_worker",
]

stop_requested = False


def iter_python_files():
    for target in WATCH_TARGETS:
        if target.is_file() and target.suffix == ".py":
            yield target
            continue
        if not target.is_dir():
            continue
        for path in target.rglob("*.py"):
            if "__pycache__" not in path.parts:
                yield path


def snapshot():
    files = {}
    for path in iter_python_files():
        try:
            stat = path.stat()
        except FileNotFoundError:
            continue
        files[str(path)] = (stat.st_mtime_ns, stat.st_size)
    return files


def start_worker():
    command = [sys.executable, str(ROOT_DIR / "worker.py")]
    options = {
        "cwd": str(ROOT_DIR),
        "env": os.environ.copy(),
    }
    if os.name == "nt":
        options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        options["start_new_session"] = True

    process = subprocess.Popen(command, **options)
    print(f"[ai-worker-reload] started worker pid={process.pid}", flush=True)
    return process


def stop_worker(process, timeout=5):
    if process.poll() is not None:
        return

    try:
        if os.name == "nt":
            process.terminate()
        else:
            os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=timeout)
        return
    except ProcessLookupError:
        return
    except subprocess.TimeoutExpired:
        pass

    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=timeout)
    except ProcessLookupError:
        return


def request_stop(_signum, _frame):
    global stop_requested
    stop_requested = True


def main():
    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    interval = float(os.environ.get("AI_WORKER_RELOAD_INTERVAL", "1"))
    known_files = snapshot()
    process = start_worker()

    try:
        while not stop_requested:
            exit_code = process.poll()
            if exit_code is not None:
                print(f"[ai-worker-reload] worker exited with code {exit_code}", flush=True)
                return exit_code or 0

            time.sleep(interval)
            current_files = snapshot()
            if current_files != known_files:
                print("[ai-worker-reload] Python file changed; restarting worker", flush=True)
                stop_worker(process)
                known_files = current_files
                process = start_worker()
    finally:
        stop_worker(process)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
