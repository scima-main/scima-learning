#!/usr/bin/env python3
"""serve.py — run the SCIMA Learning frontend locally for tests-and-tools/exploration.

  python tests-and-tools/serve.py                    # static: serves home/ on :8013
  python tests-and-tools/serve.py --port 9000        # custom port (0 = random free port)
  python tests-and-tools/serve.py --with-backend     # full stack: real FastAPI backend
                                           # (serves home/ + live /api/v1)

Static mode (default) is all the test suite needs: it serves exactly the
files production serves at "/", with no API — community fetches 404 and the
UI shows its graceful "Server temporarily offline" state (tests mock the
API in-browser instead; see helpers/api_mock.py).

--with-backend launches backend/app/main.py via uvicorn (needs fastapi +
uvicorn installed, and a writable /data/study/data — the backend's
hard-coded DATA_DIR). It serves home/ at BOTH "/" and "/dashboard/", the
legacy mount families, plus the real registry API.

Point tests at a server you started yourself with:
  SCIMA_BASE_URL=http://127.0.0.1:8013 pytest tests-and-tools/
"""
from __future__ import annotations

import argparse
import signal
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from helpers import server as srv  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8013,
                    help="0 picks a random free port")
    ap.add_argument("--with-backend", action="store_true",
                    help="run the real FastAPI backend instead of the static server")
    ap.add_argument("--root", default=None,
                    help="static mode only: serve this directory (default: <repo>/home)")
    ap.add_argument("--verbose", action="store_true", help="log every request")
    args = ap.parse_args(argv)

    if args.with_backend:
        proc = srv.start_backend_server(host=args.host, port=args.port or 8013,
                                        verbose=args.verbose)
        base = f"http://{args.host}:{args.port or 8013}"
        print(f"SCIMA full stack on {base}  (home at / and /dashboard/, API at /api/v1)")
        print("Ctrl+C to stop.")
        try:
            while proc.poll() is None:
                time.sleep(0.25)
            return proc.returncode or 0
        except KeyboardInterrupt:
            proc.terminate()
            return 0

    base, httpd = srv.start_static_server(root=args.root, host=args.host,
                                          port=args.port, verbose=args.verbose)
    print(f"SCIMA static frontend on {base}  (serving {srv.HOME_DIR})")
    print(f"  pages: {base}/  {base}/decks/  {base}/study/  {base}/library/")
    print(f"         {base}/analytics/  {base}/settings/  {base}/about/")
    print("Ctrl+C to stop.")

    def _stop(*_):
        srv.stop_static_server(httpd)
        sys.exit(0)

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        srv.stop_static_server(httpd)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
