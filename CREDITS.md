# Credits

## SigmaQuoridor model

The bundled neural model comes from [SigmaQuoridor](https://github.com/bartolomeo3000/SigmaQuoridor), by Bartosz Pokora. Wallz Adviser uses this pretrained model; it did not train it.

- Upstream file: `docs/models_9x9/best.onnx`
- Bundled file: `extension/models/quoridor.onnx`
- SHA-256: `d790dac68389f7602ff8a887a2385417d3c925fe22da7164c86e9226f943908d`
- License: [MIT, copyright 2026 Bartosz Pokora](extension/models/SigmaQuoridor-LICENSE.txt)

## ka model

The local ka adapter supports the epoch4225 checkpoint from [Kanta Sugiyama's Quoridor engine](https://github.com/sugiyama2718/Quoridor), tested at revision `8aeb97dacbff7aec440255f15891752e68d8ae0a`. The model uses 15 board feature planes and a 137-action policy. Wallz Adviser converts its output into the shared game rules and search.

This private repository includes the converted epoch4225 weights in `extension/models/ka.onnx` and `extension/models/ka-batch.onnx`, with integrity hashes in `ka.json`. The author provides the pretrained checkpoint for download and use. No explicit redistribution license was found; the project's MIT license does not cover these weights. Review their redistribution terms before making this copy public. `scripts/convert-ka.py` converts the checkpoint without importing the upstream engine's code.

The adapter and batched search are original project code. The checkpoint was trained by its author, not by this project.

## ONNX Runtime Web

[ONNX Runtime](https://github.com/microsoft/onnxruntime), by Microsoft and its contributors, runs the model locally using WebGPU or CPU WebAssembly. This project bundles version **1.17.3**.

- Bundled files: `extension/vendor/`
- License: [MIT, copyright Microsoft Corporation](extension/vendor/ONNX-Runtime-LICENSE.txt)
- The extension includes a modified WebGPU runtime and packaged worker loaders so workers can run under the extension's content security policy. `scripts/build-worker-runtime.cjs` reproduces the WebGPU loader modifications from the bundled original runtime.

Keep these license notices with redistributed copies of the model and runtime. The project's root MIT license does not replace the third-party notices.
