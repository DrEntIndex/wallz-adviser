import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def convert(checkpoint, destination):
    for suffix in ('.meta', '.index', '.data-00000-of-00001'):
        if not Path(str(checkpoint) + suffix).is_file():
            raise FileNotFoundError(f'Missing checkpoint file: {checkpoint}{suffix}')

    os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')
    os.environ.setdefault('TF_NUM_INTRAOP_THREADS', '8')
    os.environ.setdefault('TF_NUM_INTEROP_THREADS', '1')
    import tensorflow as tf
    import tf2onnx

    tf.compat.v1.disable_eager_execution()
    with tf.Graph().as_default() as graph:
        saver = tf.compat.v1.train.import_meta_graph(str(checkpoint) + '.meta', clear_devices=True)
        with tf.compat.v1.Session(graph=graph) as session:
            saver.restore(session, str(checkpoint))
            features = graph.get_tensor_by_name('x:0')
            policy = graph.get_tensor_by_name('Softmax_5:0')
            value = graph.get_tensor_by_name('Tanh:0')
            if (features.shape.as_list() != [None, 9, 9, 15]
                    or policy.shape.as_list() != [None, 137]
                    or value.shape.as_list() != [None]):
                raise ValueError('This checkpoint does not match the supported ka model layout')
            frozen = tf.compat.v1.graph_util.convert_variables_to_constants(
                session, graph.as_graph_def(), [policy.op.name, value.op.name])

    with tempfile.TemporaryDirectory(prefix='wallz-ka-') as temporary:
        staging = Path(temporary)
        for size, name in ((1, 'ka.onnx'), (4, 'ka-batch.onnx')):
            tf2onnx.convert.from_graph_def(
                frozen, input_names=[features.name], output_names=[policy.name, value.name],
                opset=17, shape_override={features.name: [size, 9, 9, 15]},
                output_path=str(staging / name))
        metadata = {
            'format': 'ka15-v1',
            'input': features.name,
            'policy': policy.name,
            'value': value.name,
            'sha256': digest(staging / 'ka.onnx'),
            'batch': {'size': 4, 'sha256': digest(staging / 'ka-batch.onnx')},
            'source': 'sugiyama2718/Quoridor',
            'checkpoint': checkpoint.name,
            'checkpointSha256': digest(Path(str(checkpoint) + '.data-00000-of-00001')),
        }
        destination.mkdir(parents=True, exist_ok=True)
        for name in ('ka.onnx', 'ka-batch.onnx'):
            shutil.copyfile(staging / name, destination / name)
        (destination / 'ka.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    return destination


def main():
    parser = argparse.ArgumentParser(description='Convert a local ka epoch4225 checkpoint for Wallz Adviser')
    parser.add_argument('checkpoint', type=Path, help='Checkpoint prefix, such as path/to/epoch4225.ckpt')
    parser.add_argument('--output-dir', type=Path,
                        default=Path(__file__).resolve().parents[1] / 'extension' / 'models')
    arguments = parser.parse_args()
    try:
        destination = convert(arguments.checkpoint.expanduser().resolve(), arguments.output_dir.resolve())
    except (FileNotFoundError, KeyError, ValueError) as error:
        parser.exit(1, f'{error}\n')
    print(f'Local model installed in {destination}. Reload the extension and refresh Wallz.')


if __name__ == '__main__':
    main()
