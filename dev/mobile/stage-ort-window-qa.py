import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

# stage-ort-window-qa.py — offline fixed-reference staging, restricted to the independent simulator bundle.
ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / ".mobile-test-results/automix-probe"
BUNDLE = "app.folia.validation.App"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: stage-ort-window-qa.py simulator-uuid NEW-report.json")
    report_path = Path(sys.argv[2])
    if report_path.exists():
        raise SystemExit("refusing to overwrite earlier evidence")
    result = subprocess.run(["xcrun", "simctl", "get_app_container", sys.argv[1], BUNDLE, "data"],
                            check=True, capture_output=True, text=True, timeout=20)
    destination = Path(result.stdout.strip()) / "Documents/ORTQA"
    files = {}

    def add(source, relative, expected):
        actual = digest(source)
        if actual != expected:
            raise ValueError("fixture hash mismatch: " + relative)
        files[relative] = (source, actual)

    manifest = json.loads((ROOT / "shared/modelManifest.json").read_text())
    for model in manifest["models"]:
        if model["name"] in ("beat_this", "htdemucs"):
            add(ASSETS / "assets" / (model["name"] + ".onnx"), model["name"] + ".onnx", model["sha256"])
    # Previous single-segment Node 1.30.0 references also cover regression and cancellation recovery.
    singles = {
        "beat-input.f32": ("beat-input.f32", "853e542cdff97a6063f5c4774e9bcb7fdfe56eaeed474c70923840ccc521bfde"),
        "htdemucs-input.f32": ("htdemucs-input.f32", "4a214bd0e298f90af1b4f8b7f5cf259cc8e6cc86692256b5c04b19b667172bd5"),
        "beat.0.f32": ("beat-node-reference/0.f32", "cbc740abb2025493c3643b1c8d794d91f9c48f5c2d45401439b44f3febd2a809"),
        "beat.1.f32": ("beat-node-reference/1.f32", "24d445364d178a8d4ab9240659a1e3377b671213953a3e1fdcf86a7db6d7368b"),
        "htdemucs.0.f32": ("htdemucs-node-reference/0.f32", "24d9f8248664d9b3cbd241a5fcf707c2237d39bac56a6f528b873af20499de02"),
    }
    for name, (path, expected) in singles.items():
        add(ASSETS / path, name, expected)
    add(ASSETS / "music/decoded.wav", "music.wav", "d7db2870d3ab5c1b56f793288c045a34043c1e1cfda468010a3e200f4e8c38a2")
    python_hash = digest(ROOT / "electron/analysis/htdemucs_runner.py")
    for name, path in [("synthetic", "window"), ("music", "music"), ("one-frame", "window/one-frame"),
                       ("stride-exact", "window/stride-exact"), ("stride-plus-one", "window/stride-plus-one")]:
        source = ASSETS / path
        report = json.loads((source / "original/report.json").read_text())
        if report["status"] != "PASS_ORIGINAL_STITCHING_REFERENCE" or report["sourceSHA256"] != python_hash:
            raise ValueError("original reference status or source changed: " + name)
        if report["modelSHA256"] != files["htdemucs.onnx"][1]:
            raise ValueError("original reference used another model")
        prefix = "windows/" + name + "/"
        add(source / "input.f32", prefix + "input.f32", report["inputSHA256"])
        for output in report["outputs"]:
            add(source / "original" / (output["name"] + ".f32"), prefix + output["name"] + ".f32", output["sha256"])
        add(source / "original/report.json", prefix + "report.json", digest(source / "original/report.json"))
    for name, (source, expected) in files.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        if digest(target) != expected:
            raise ValueError("staged fixture hash mismatch: " + name)
    record = {"bundleId": BUNDLE, "simulator": sys.argv[1], "sourceSHA256": python_hash,
              "files": {name: {"bytes": path.stat().st_size, "sha256": sha} for name, (path, sha) in files.items()}}
    with report_path.open("x") as output:
        json.dump(record, output, indent=2)
        output.write("\n")
    print(json.dumps({"bundleId": BUNDLE, "verifiedFiles": len(files), "report": str(report_path)}))


if __name__ == "__main__":
    main()
