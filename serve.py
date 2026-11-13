#!/usr/bin/env python3
"""Serve the static frontend with a small single-page-app route fallback."""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


SPA_ROUTES = {
    "/login",
    "/dashboard",
    "/subjects",
    "/question-bank",
    "/pyqs",
    "/generate-paper",
    "/my-papers",
    "/profile",
    "/activity",
    "/teachers",
    "/syllabus",
    "/ai-generate",
}


class FrontendHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        request_path = urlsplit(self.path).path
        local_path = Path(self.translate_path(self.path))
        route_path = request_path.rstrip("/") or "/"

        # Only known frontend routes fall back. API endpoints and unknown
        # paths keep SimpleHTTPRequestHandler's normal 404 behavior.
        if route_path in SPA_ROUTES and not local_path.exists():
            original_path = self.path
            self.path = "/index.html"
            try:
                return super().send_head()
            finally:
                self.path = original_path

        return super().send_head()


def main():
    parser = argparse.ArgumentParser(description="Serve the Smart QPG frontend")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3000)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.bind, args.port), FrontendHandler)
    print(f"Serving frontend at http://{args.bind}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
