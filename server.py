#!/usr/bin/env python3
import json
import mimetypes
import os
import re
import sys
import tempfile
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

try:
    import yt_dlp
except ImportError:
    yt_dlp = None

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}

def is_youtube_url(value: str) -> bool:
    try:
        host = (urlparse(value).hostname or "").lower()
        return host in YOUTUBE_HOSTS or host.endswith(".youtube.com")
    except Exception:
        return False

def safe_filename(value: str) -> str:
    value = re.sub(r'[\\/:*?"<>|]+', "_", value or "youtube-video")
    value = re.sub(r"\s+", " ", value).strip()
    return value[:140] or "youtube-video"

class Handler(SimpleHTTPRequestHandler):
    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/youtube-download":
            self._json(404, {"error": "Bulunamadı"})
            return

        if yt_dlp is None:
            self._json(500, {"error": "yt-dlp kurulu değil. Terminalde: python3 -m pip install -r requirements.txt"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 100_000:
                raise ValueError("Geçersiz istek")
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            url = str(data.get("url", "")).strip()
            authorized = bool(data.get("authorized"))

            if not authorized:
                self._json(400, {"error": "İndirme hakkına sahip olduğunu onaylamalısın."})
                return
            if not is_youtube_url(url):
                self._json(400, {"error": "Geçerli bir YouTube bağlantısı gir."})
                return

            with tempfile.TemporaryDirectory(prefix="yt-loop-") as tmp:
                opts = {
                    "format": "best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best",
                    "outtmpl": os.path.join(tmp, "%(id)s.%(ext)s"),
                    "noplaylist": True,
                    "quiet": True,
                    "no_warnings": True,
                    "restrictfilenames": True,
                }
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(url, download=True)

                candidates = []
                for name in os.listdir(tmp):
                    path = os.path.join(tmp, name)
                    if os.path.isfile(path) and not name.endswith((".part", ".ytdl", ".json")):
                        candidates.append(path)
                if not candidates:
                    self._json(500, {"error": "İndirilen medya dosyası bulunamadı."})
                    return

                path = max(candidates, key=os.path.getsize)
                ext = os.path.splitext(path)[1] or ".mp4"
                title = safe_filename(info.get("title") or info.get("id") or "youtube-video")
                filename = title + ext
                mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
                size = os.path.getsize(path)

                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(size))
                self.send_header("Content-Disposition", 'attachment; filename="' + filename.replace('"', '') + '"')
                self.send_header("X-Media-Title", title)
                self.end_headers()

                with open(path, "rb") as f:
                    while True:
                        chunk = f.read(1024 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)

        except yt_dlp.utils.DownloadError as exc:
            self._json(502, {"error": "YouTube indirmesi başarısız: " + str(exc)})
        except Exception as exc:
            self._json(500, {"error": "İndirme hatası: " + str(exc)})

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"YouTube Loop Player: http://localhost:{port}")
    print("Aynı Wi-Fi'daki telefon için Mac IP adresini kullanabilirsin.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nKapatıldı.")
