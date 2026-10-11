import ast
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace
import numpy as np

# dev/mobile/automix-window-reference.py — execute original desktop stitching functions.
# Inference is replayed from actual Node ORT outputs, with every requested input checked.
# Uses an already-installed NumPy. Does not import/install Python ORT or rewrite model files.


def main():
    if len(sys.argv) != 4:
        raise ValueError('usage: reference.py input.f32 node-output-directory NEW-reference-directory')
    source = Path(__file__).resolve().parents[2] / 'electron/analysis/htdemucs_runner.py'
    raw_source = source.read_bytes()
    tree = ast.parse(raw_source, filename=str(source))
    function_names = {'segment_of', 'build_window', 'separate'}
    constant_names = {'SOURCES', 'RETURNED'}
    selected = [node for node in tree.body if
                isinstance(node, ast.FunctionDef) and node.name in function_names or
                isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in constant_names for t in node.targets)]
    if len(selected) != 5:
        raise ValueError('desktop reference functions changed; review extraction before use')
    namespace = {'np': np}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), 'exec'), namespace)
    node_dir = Path(sys.argv[2])
    report = json.loads((node_dir / 'report.json').read_text())
    if report['model'] != 'htdemucs' or report['runtime']['node'] != '1.30.0':
        raise ValueError('unexpected inference reference')
    model_manifest = json.loads((source.parents[2] / 'shared/modelManifest.json').read_text())
    model = next(m for m in model_manifest['models'] if m['name'] == 'htdemucs')
    if report['modelSHA256'] != model['sha256']:
        raise ValueError('model identity mismatch')
    data = Path(sys.argv[1]).read_bytes()
    if hashlib.sha256(data).hexdigest() != report['input']['sha256']:
        raise ValueError('input SHA256 mismatch')
    total, segment = report['window']['total'], report['window']['segment']
    if not 0 < total <= 30 * 44100 or len(data) != 2 * total * 4:
        raise ValueError('invalid window length')
    samples = np.frombuffer(data, dtype='<f4').reshape(2, total)

    class ReplaySession:
        def __init__(self):
            self.calls = 0

        def get_inputs(self):
            return [SimpleNamespace(name='mix', shape=[1, 2, segment])]

        def run(self, names, feeds):
            chunk = report['chunks'][self.calls]
            requested = feeds['mix']
            if hashlib.sha256(requested.tobytes()).hexdigest() != chunk['inputSHA256']:
                raise ValueError(f'original desktop input differs at chunk {self.calls}')
            output = report['outputs'][self.calls]
            if (output['chunk'] != self.calls or output['shape'] != [1, 4, 2, segment]
                    or output['file'] != f'{self.calls}.0.f32'):
                raise ValueError('unexpected output shape/order')
            raw = (node_dir / output['file']).read_bytes()
            if hashlib.sha256(raw).hexdigest() != output['sha256']:
                raise ValueError('recorded inference output changed')
            self.calls += 1
            return [np.frombuffer(raw, dtype='<f4').reshape(1, 4, 2, segment)]

    session = ReplaySession()
    parts = namespace['separate'](session, samples[0], samples[1])
    if session.calls != len(report['chunks']):
        raise ValueError('desktop and recorded chunk counts differ')
    output_dir = Path(sys.argv[3])
    output_dir.mkdir()
    outputs = []
    for name in namespace['RETURNED']:
        stereo = np.stack(parts[name]).astype('<f4')
        if stereo.shape != (2, total) or not np.isfinite(stereo).all():
            raise ValueError('invalid original desktop output')
        raw = stereo.tobytes()
        (output_dir / f'{name}.f32').write_bytes(raw)
        outputs.append({'name': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'shape': [2, total]})
    result = {'status': 'PASS_ORIGINAL_STITCHING_REFERENCE', 'sourceSHA256': hashlib.sha256(raw_source).hexdigest(),
              'numpyVersion': np.__version__, 'pythonVersion': sys.version.split()[0], 'chunks': session.calls,
              'inference': 'replayed actual Node ORT 1.30.0 outputs; every input verified',
              'inputSHA256': report['input']['sha256'], 'modelSHA256': model['sha256'], 'outputs': outputs}
    (output_dir / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
