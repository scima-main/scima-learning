"""Shared helpers for the SCIMA Learning frontend test suite.

Modules
-------
server   static file server for minified/home (+ real backend launcher)
storage  localStorage seeding / reading (mf_state + SCIMATracker)
pages    navigation + common UI flows (page-object style functions)
api_mock /api/v1 route mocking for community tests (no backend needed)

Everything here is importable from tests (conftest.py puts tests-and-tools/ on
sys.path) and from the CLI scripts (serve.py, render.py, seed.py).
"""
from . import api_mock, pages, server, storage  # noqa: F401
