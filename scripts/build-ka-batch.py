"""Derive a larger static GPU batch without changing any learned weights.

Requires onnx==1.17.0. The original four-position graph remains the fallback.
"""
import argparse
import hashlib
import json
from pathlib import Path

import onnx
from onnx import numpy_helper


def build(directory, size):
    source = directory / 'ka-batch.onnx'
    metadata_path = directory / 'ka.json'
    metadata = json.loads(metadata_path.read_text())
    if hashlib.sha256(source.read_bytes()).hexdigest() != metadata['batch']['sha256']:
        raise ValueError('Batch source integrity mismatch')
    model = onnx.load(source)
    if metadata['batch']['size'] != 4 or model.graph.input[0].type.tensor_type.shape.dim[0].dim_value != 4:
        raise ValueError('Expected the original four-position ka graph')
    # Only batch-explicit Reshape shape tensors may change. Attention's four
    # heads and all floating-point tensors must retain their original values.
    shapes = {node.input[1] for node in model.graph.node if node.op_type == 'Reshape'}
    changed = []
    for tensor in model.graph.initializer:
        if tensor.name in shapes:
            data = numpy_helper.to_array(tensor).copy()
            if data.ndim == 1 and data[0] == 4:
                data[0] = size
                changed.append(tensor.name)
                tensor.CopyFrom(numpy_helper.from_array(data, tensor.name))
    if changed != ['new_shape__783']:
        raise ValueError(f'Unexpected graph: explicit batch shapes {changed}')
    for value in [*model.graph.input, *model.graph.output]:
        shape = value.type.tensor_type.shape
        if shape.dim[0].dim_value != 4:
            raise ValueError('Unexpected model I/O batch dimension')
        shape.dim[0].dim_value = size
    del model.graph.value_info[:]
    model = onnx.shape_inference.infer_shapes(model, strict_mode=True)
    onnx.checker.check_model(model, full_check=True)
    destination = directory / f'ka-batch{size}.onnx'
    onnx.save(model, destination)
    metadata['gpuBatches'] = [{'size': size, 'file': destination.name,
                               'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}]
    metadata_path.write_text(json.dumps(metadata, indent=2) + '\n')
    print(f'Built {destination}; learned tensors unchanged')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models', type=Path, default=Path(__file__).resolve().parents[1] / 'extension/models')
    parser.add_argument('--size', type=int, choices=[8, 16], default=8)
    args = parser.parse_args()
    build(args.models, args.size)
