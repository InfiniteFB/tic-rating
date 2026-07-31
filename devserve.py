#!/usr/bin/env python3
"""Static server for `web/` that never lets the browser cache a module.

`python3 -m http.server` sends no cache headers, so browsers fall back to
heuristic caching and hold on to ES modules across reloads — editing a file
then reloading shows the old code, silently. That cost real debugging time, so
the dev server states the obvious instead of leaving it to a heuristic.

Production is the opposite case and is handled in vercel.json, where the data
payload gets a long max-age.
"""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:  # quieter than the default
        if not str(args[1] if len(args) > 1 else "").startswith("2"):
            super().log_message(fmt, *args)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8142)
    parser.add_argument("--directory", default="web")
    args = parser.parse_args()

    handler = partial(NoCacheHandler, directory=args.directory)
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as httpd:
        print(f"serving {args.directory}/ on http://127.0.0.1:{args.port} (no-store)")
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
