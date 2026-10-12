import array
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import wave

# stem-codec-inputs.py — generated impulses/tones encoded by the existing macOS system tool; no music assets.
def main():
    if len(sys.argv) != 2:
        raise ValueError("usage: stem-codec-inputs.py NEW-output-directory")
    root = Path(sys.argv[1])
    root.mkdir(parents=True, exist_ok=False)
    cases = [
        ("aac48", 48000, 2, "m4af", "aac ", 128000),
        ("aac-mono", 44100, 1, "m4af", "aac ", 64000),
        ("alac44", 44100, 2, "m4af", "alac", None),
        ("flac48", 48000, 2, "flac", "flac", None),
    ]
    manifest = []
    for name, rate, channels, fmt, codec, bitrate in cases:
        frames = rate * (3 if name == "aac-mono" else 32) + 137
        pcm = array.array("h")
        for i in range(frames):
            phase = i % rate
            level = 0.5 * (0.5 + 0.5 * math.cos(math.pi * phase / (rate / 20))) if phase < rate / 20 else 0
            for c in range(channels):
                pcm.append(round(32767 * level * math.sin(2 * math.pi * i * (440 if c == 0 else 997) / rate)))
        if sys.byteorder != "little":
            pcm.byteswap()
        source = root / (name + ".wav")
        target = root / (name + (".flac" if fmt == "flac" else ".m4a"))
        with wave.open(str(source), "wb") as file:
            file.setnchannels(channels)
            file.setsampwidth(2)
            file.setframerate(rate)
            file.writeframes(pcm.tobytes())
        command = ["/usr/bin/afconvert", "-f", fmt, "-d", codec]
        if bitrate:
            command += ["-b", str(bitrate)]
        command += [str(source), str(target)]
        subprocess.run(command, check=True, timeout=20, capture_output=True)
        data = target.read_bytes()
        manifest.append(dict(name=name, file=str(target), rate=rate, channels=channels, frames=frames,
                             bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), encoder=command))
    (root / "inputs.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps([dict(name=row["name"], bytes=row["bytes"]) for row in manifest]))


if __name__ == "__main__":
    main()
