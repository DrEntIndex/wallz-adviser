# Credits

## SigmaQuoridor model

The bundled neural model comes from [SigmaQuoridor](https://github.com/bartolomeo3000/SigmaQuoridor), by Bartosz Pokora. Wallz Adviser uses this pretrained model; it did not train it.

- Upstream file: `docs/models_9x9/best.onnx`
- Bundled file: `extension/models/quoridor.onnx`
- SHA-256: `d790dac68389f7602ff8a887a2385417d3c925fe22da7164c86e9226f943908d`
- License: [MIT, copyright 2026 Bartosz Pokora](extension/models/SigmaQuoridor-LICENSE.txt)

## ONNX Runtime Web

[ONNX Runtime](https://github.com/microsoft/onnxruntime), by Microsoft and its contributors, runs the model locally using WebGPU or CPU WebAssembly. This project bundles version **1.17.3**.

- Bundled files: `extension/vendor/`
- License: [MIT, copyright Microsoft Corporation](extension/vendor/ONNX-Runtime-LICENSE.txt)
- The extension includes a modified WebGPU runtime and packaged worker loaders so workers can run under the extension's content security policy. `scripts/build-worker-runtime.cjs` reproduces the WebGPU loader modifications from the bundled original runtime.

Keep these license notices with redistributed copies of the model and runtime. The project's root MIT license does not replace the third-party notices.
