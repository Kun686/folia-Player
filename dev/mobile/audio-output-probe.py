import argparse
import http.server
import math
import os
import pathlib
import re
import struct
import subprocess
import sys
import threading
import time
import urllib.request
import wave

# Bounded, synthesized loopback audio fixture; never contacts a music provider or user server.
parser = argparse.ArgumentParser(description="Native audio output probe with local HTTP Range audio")
parser.add_argument("--simulator", required=True)
parser.add_argument("--evidence", required=True)
parser.add_argument("--test", action="append", default=[])
args = parser.parse_args()
if not re.fullmatch(r"[A-Za-z0-9_-]+", args.evidence):
    parser.error("evidence must be a simple file name")
repo = pathlib.Path(__file__).resolve().parents[2]
root = repo / ".mobile-test-results"
root.mkdir(exist_ok=True)
evidence = root / args.evidence
if evidence.with_suffix(".xcresult").exists():
    parser.error("evidence already exists; use a new name to preserve previous results")
source = root / "reader-mono.wav"
with wave.open(str(source), "wb") as audio:
    audio.setparams((1, 2, 44100, 44100 * 60, "NONE", "not compressed"))
    second = b"".join(struct.pack("<h", round(math.sin(i * 2 * math.pi * 2000 / 44100) * 1000)) for i in range(44100))
    for _ in range(60):
        audio.writeframesraw(second)

transfers = []
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200); self.end_headers(); self.wfile.write(b"ready"); return
        if self.path != "/mono.wav":
            self.send_error(404); return
        size = source.stat().st_size
        start, end = 0, size - 1
        requested = self.headers.get("Range", "")
        match = re.fullmatch(r"bytes=(\d+)-(\d*)", requested)
        if requested and not match:
            self.send_error(416); return
        if match:
            start = int(match[1]); end = min(int(match[2]) if match[2] else end, end)
        if start > end:
            self.send_error(416); return
        self.send_response(206 if match else 200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if match:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        sent = 0
        try:
            with source.open("rb") as stream:
                stream.seek(start)
                while sent < end - start + 1:
                    block = stream.read(min(16384, end - start + 1 - sent))
                    self.wfile.write(block); sent += len(block)
                    time.sleep(0.05)
        except (ConnectionError, BrokenPipeError):
            pass
        finally:
            transfers.append((start, end, sent))

server = http.server.ThreadingHTTPServer(("127.0.0.1", 18779), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    assert urllib.request.urlopen("http://127.0.0.1:18779/health", timeout=2).read() == b"ready"
    print(f"probe pid={os.getpid()} health=ready log={evidence.with_suffix('.log')}", flush=True)
    command = [str(pathlib.Path.home() / ".local/bin/codex-bounded"), "600", "--", "xcodebuild", "test",
        "-project", "ios/App/App.xcodeproj", "-scheme", "App", "-configuration", "Release", "ENABLE_TESTABILITY=YES",
        "SWIFT_ACTIVE_COMPILATION_CONDITIONS=FOLIA_AUDIO_OUTPUT_PROBE",
        "-destination", f"platform=iOS Simulator,id={args.simulator}", "-derivedDataPath", "ios/DerivedData",
        "-resultBundlePath", str(evidence.with_suffix(".xcresult")), "CODE_SIGN_IDENTITY=-", "CODE_SIGNING_ALLOWED=YES"]
    tests = args.test or ["testPausedTapAppliesDisabledEffectsWithoutResumingPlayback", "testRemoteAssetReaderStereoProbe", "testMonoCompositionTapFormatProbe"]
    command.extend("-only-testing:FoliaNativeTests/NativeTests/" + name for name in tests)
    with evidence.with_suffix(".log").open("w") as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=610, cwd=repo)
    print(f"xcodebuild exit={result.returncode} transfers={transfers}", flush=True)
finally:
    server.shutdown(); server.server_close(); thread.join(timeout=2)
    print("probe server closed", flush=True)
sys.exit(result.returncode)
