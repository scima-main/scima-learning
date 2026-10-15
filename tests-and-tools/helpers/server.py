"""Local servers for the test suite.

Two modes:

1. static  (default everywhere in this suite)
   Serves the repo's preferred frontend (minified/home, falling back to
   site/home) over plain HTTP — exactly the files the
   FastAPI backend serves at "/" in production, minus the API. Community
   fetches to /api/v1/* then 404, which the frontend handles gracefully
   ("Server temporarily offline"), and tests can mock the API in-browser
   via helpers/api_mock.py.

2. backend (`serve.py --with-backend`)
   Launches the real FastAPI app from backend/ (uvicorn), which serves
   home/ at "/" AND "/dashboard/" plus the live /api/v1 registry. Requires
   the backend deps (fastapi, uvicorn) and a writable /data/study/data
   (hard-coded DATA_DIR in backend/app/db.py).
"""
from __future__ import annotations

import functools
import http.server
import os
import socket
import socketserver
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"

# Preferred serve root is the minified deploy bundle (./minified/home);
# fall back to the unminified tree and the historical layout.
def _find_home() -> Path:
    for cand in ("minified/home", "site/home", "home"):
        p = REPO_ROOT / cand
        if (p / "index.html").exists():
            return p
    return REPO_ROOT / "minified" / "home"


def _find_backend() -> Path:
    for cand in ("minified/backend", "backend"):
        p = REPO_ROOT / cand
        if (p / "app" / "main.py").exists():
            return p
    return REPO_ROOT / "minified" / "backend"


HOME_DIR = _find_home()
BACKEND_DIR = _find_backend()


def find_free_port(host: str = "127.0.0.1") -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


class _Handler(http.server.SimpleHTTPRequestHandler):
    """No-store caching so reloads never serve a stale index.html/JS file."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # silence unless server.verbose
        if getattr(self.server, "verbose", False):
            super().log_message(fmt, *args)


class _ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def wait_for_http(url: str, timeout: float = 15.0) -> None:
    """Poll `url` until it answers (any status) or timeout."""
    deadline = time.time() + timeout
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2)
            return
        except urllib.error.HTTPError:
            return  # server is up; 4xx/5xx is fine
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(0.1)
    raise RuntimeError(f"server at {url} did not come up: {last_err}")


def start_static_server(root: str | Path | None = None,
                        host: str = "127.0.0.1",
                        port: int = 0,
                        verbose: bool = False) -> tuple[str, _ThreadingServer]:
    """Serve `root` (default: <repo>/minified/home) on a background thread.

    Returns (base_url, server). Call stop_static_server(server) to shut down.
    """
    root = Path(root) if root else HOME_DIR
    if not (root / "index.html").exists():
        raise FileNotFoundError(f"{root}/index.html not found — wrong repo layout?")
    handler = functools.partial(_Handler, directory=str(root))
    server = _ThreadingServer((host, port), handler)
    server.verbose = verbose
    thread = __import__("threading").Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://{host}:{server.server_address[1]}"
    wait_for_http(base + "/")
    return base, server


def stop_static_server(server: _ThreadingServer) -> None:
    server.shutdown()
    server.server_close()


def start_backend_server(host: str = "127.0.0.1",
                         port: int = 8013,
                         verbose: bool = False) -> subprocess.Popen:
    """Launch the real FastAPI backend (minified/ bundle; serves the
    frontend + /api/v1 together).

    Caller owns the Popen — terminate() it when done.
    """
    try:
        import uvicorn  # noqa: F401
        import fastapi  # noqa: F401
    except ImportError as e:
        raise SystemExit(
            "Full-stack mode needs the backend deps:\n"
            "  pip install -r tests-and-tools/requirements.txt   (or backend/requirements.txt)\n"
            f"ImportError was: {e}"
        )
    env = dict(os.environ)
    cmd = [sys.executable, "-m", "uvicorn", "app.main:app",
           "--host", host, "--port", str(port), "--log-level",
           "info" if verbose else "warning"]
    proc = subprocess.Popen(cmd, cwd=str(BACKEND_DIR), env=env)
    try:
        wait_for_http(f"http://{host}:{port}/api/v1/health", timeout=20)
    except RuntimeError:
        proc.terminate()
        raise
    return proc
