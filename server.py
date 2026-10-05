#!/usr/bin/env python3
import json
import mimetypes
import os
import re
import shutil
import sys
import tempfile
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

try:
    import yt_dlp
except ImportError:
    yt_dlp = None

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
COOKIE_BROWSERS = {"safari", "chrome", "firefox", "edge", "brave"}

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

def available_js_runtimes():
    runtimes = {}
    if shutil.which("deno"):
        runtimes["deno"] = {}
    if shutil.which("node"):
        runtimes["node"] = {}
    if shutil.which("qjs"):
        runtimes["quickjs"] = {}
    return runtimes

class Handler(SimpleHTTPRequestHandler):
    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/status":
            self._json(200, {
                "ytDlpInstalled": yt_dlp is not None,
                "ytDlpVersion": getattr(getattr(yt_dlp, "version", None), "__version__", None) if yt_dlp else None,
                "jsRuntimes": list(available_js_runtimes().keys()),
                "ffmpeg": bool(shutil.which("ffmpeg")),
            })
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/api/youtube-download":
            self._json(404, {"error": "Bulunamadı"})
            return

        if yt_dlp is None:
            self._json(500, {"error": "yt-dlp kurulu değil. Terminalde: python3 -m pip install -U -r requirements.txt"})
            return

        runtimes = available_js_runtimes()
        if not runtimes:
            self._json(500, {
                "error": "YouTube için gerekli JavaScript çalışma ortamı bulunamadı. Mac'te Deno kur: brew install deno. Alternatif olarak Node 22+ da kullanılabilir."
            })
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 100_000:
                raise ValueError("Geçersiz istek")

            data = json.loads(self.rfile.read(length).decode("utf-8"))
            url = str(data.get("url", "")).strip()
            authorized = bool(data.get("authorized"))
            cookie_browser = str(data.get("cookieBrowser", "none")).strip().lower()

            if not authorized:
                self._json(400, {"error": "İndirme hakkına sahip olduğunu onaylamalısın."})
                return
            if not is_youtube_url(url):
                self._json(400, {"error": "Geçerli bir YouTube bağlantısı gir."})
                return
            if cookie_browser not in COOKIE_BROWSERS:
                cookie_browser = "none"

            with tempfile.TemporaryDirectory(prefix="yt-loop-") as tmp:
                has_ffmpeg = bool(shutil.which("ffmpeg"))
                if has_ffmpeg:
                    # Prefer a Safari/iPhone-friendly H.264 + M4A pair, then progressively
                    # relax the selector. The old selector required one combined MP4 stream,
                    # which many current YouTube videos no longer expose.
                    format_selector = (
                        "bv*[vcodec^=avc1]+ba[ext=m4a]/"
                        "b[ext=mp4][vcodec^=avc1]/"
                        "bv*+ba/"
                        "b"
                    )
                else:
                    # Without ffmpeg we cannot merge separate video/audio streams.
                    format_selector = "b[ext=mp4]/b"

                opts = {
                    "format": format_selector,
                    "outtmpl": os.path.join(tmp, "%(id)s.%(ext)s"),
                    "noplaylist": True,
                    "quiet": True,
                    "no_warnings": False,
                    "restrictfilenames": True,
                    "js_runtimes": runtimes,
                }
                if has_ffmpeg:
                    opts["merge_output_format"] = "mp4"
                if cookie_browser != "none":
                    opts["cookiesfrombrowser"] = (cookie_browser,)

                try:
                    with yt_dlp.YoutubeDL(opts) as ydl:
                        info = ydl.extract_info(url, download=True)
                except yt_dlp.utils.DownloadError as exc:
                    message = str(exc)
                    if "Sign in to confirm" in message or "not a bot" in message:
                        if cookie_browser == "none":
                            raise RuntimeError(
                                "YouTube giriş doğrulaması istiyor. Sayfadaki 'YouTube oturumu' alanından Safari veya Chrome'u seçip tekrar dene."
                            )
                        raise RuntimeError(
                            "YouTube giriş doğrulaması başarısız oldu. Seçtiğin tarayıcıda youtube.com hesabının açık olduğundan emin ol. "
                            "Safari kullanıyorsan Terminal/Python için macOS Tam Disk Erişimi gerekebilir. Ayrıntı: " + message
                        )
                    if "JavaScript runtime" in message or "EJS" in message:
                        raise RuntimeError(
                            "YouTube JavaScript doğrulaması çözülemedi. 'python3 -m pip install -U -r requirements.txt' çalıştır ve Deno'nun kurulu olduğundan emin ol. Ayrıntı: " + message
                        )
                    raise RuntimeError(message)

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

        except RuntimeError as exc:
            self._json(502, {"error": str(exc)})
        except Exception as exc:
            self._json(500, {"error": "İndirme hatası: " + str(exc)})

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"YouTube Loop Player: http://localhost:{port}")
    print("Aynı Wi-Fi'daki telefon için Mac IP adresini kullanabilirsin.")
    print("JS runtime:", ", ".join(available_js_runtimes().keys()) or "YOK")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nKapatıldı.")
