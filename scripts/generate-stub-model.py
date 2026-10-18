"""Generate the stub intent model: public/models/intent.tflite.

A single FULLY_CONNECTED layer (256 features -> 3 logits) whose weights encode keyword
buckets for [none, searchFiles, showStatus]. It mirrors src/inference/featurize.ts exactly
(tokenizer, FNV-1a hashing, 254 text buckets + 2 pointer features). Replace with the real
quantized intent model later.

Usage (needs: pip install tflite flatbuffers numpy ai-edge-litert):
    python3 scripts/generate-stub-model.py
"""

import json
import math
import re
import sys
from pathlib import Path

import flatbuffers
import numpy as np
import tflite

ROOT = Path(__file__).resolve().parent.parent
FEATURIZE_TS = ROOT / "src" / "inference" / "featurize.ts"
MODEL_PATH = ROOT / "public" / "models" / "intent.tflite"
PARITY_PATH = ROOT / "src" / "test" / "fixtures" / "stub-model-parity.json"

FEATURE_SIZE = 256
TEXT_BUCKETS = FEATURE_SIZE - 2
LABELS = ["none", "searchFiles", "showStatus"]
KEYWORD_WEIGHT = 4.0
NONE_BIAS = 1.0

KEYWORDS = {
    "searchFiles": [
        "find", "search", "file", "files", "locate", "open", "invoice", "invoices", "pdf",
        "photo", "photos", "image", "images", "notes", "report", "budget", "contract", "tax",
        "resume", "travel", "spreadsheet", "documents", "receipts", "meeting",
    ],
    "showStatus": [
        "status", "system", "accelerator", "npu", "gpu", "memory", "tensors", "tensor",
        "health", "diagnostics", "performance", "webnn", "ledger",
    ],
}

# Common words that must never share a bucket with a keyword (would cause false positives).
FILLER = [
    "my", "me", "the", "for", "show", "how", "is", "a", "an", "of", "to", "in", "what", "where",
    "and", "there", "hello", "please", "all", "can", "you", "i", "it", "this", "that", "with",
]

EXPECTATIONS = {
    "find my invoices": "searchFiles",
    "search for the tax pdf": "searchFiles",
    "open meeting notes": "searchFiles",
    "system status": "showStatus",
    "how is the npu memory": "showStatus",
    "show tensor ledger": "showStatus",
    "hello there": "none",
    "": "none",
}


def tokenize(text: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", text.lower()) if t]


def fnv1a(token: str) -> int:
    h = 0x811C9DC5
    for ch in token:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


HASH_SEED = 0  # replaced by choose_seed()


def bucket_of(token: str, seed: int | None = None) -> int:
    return fnv1a(f"{HASH_SEED if seed is None else seed}:{token}") % TEXT_BUCKETS


def collisions(seed: int) -> list[str]:
    owner: dict[int, str] = {}
    problems = []
    for label, words in KEYWORDS.items():
        for word in words:
            b = bucket_of(word, seed)
            if owner.get(b, label) != label:
                problems.append(f"'{word}' ({label}) shares bucket {b} with {owner[b]}")
            owner[b] = label
    for word in FILLER:
        if bucket_of(word, seed) in owner:
            problems.append(f"filler '{word}' shares a bucket with {owner[bucket_of(word, seed)]}")
    return problems


def choose_seed() -> int:
    for seed in range(100_000):
        if not collisions(seed):
            return seed
    sys.exit("no collision-free hash seed found")


def sync_typescript_seed(seed: int) -> None:
    source = FEATURIZE_TS.read_text()
    updated = re.sub(r"export const HASH_SEED = \d+", f"export const HASH_SEED = {seed}", source)
    if updated != source:
        FEATURIZE_TS.write_text(updated)
        print(f"updated HASH_SEED in {FEATURIZE_TS.relative_to(ROOT)} to {seed}")


def featurize(text: str) -> np.ndarray:
    features = np.zeros(FEATURE_SIZE, dtype=np.float32)
    for token in tokenize(text):
        features[bucket_of(token)] += 1
    norm = math.sqrt(float(np.sum(features[:TEXT_BUCKETS] ** 2)))
    if norm > 0:
        features[:TEXT_BUCKETS] /= norm
    # Pointer features (activity, idle) are left at 0 for verification; their weights are 0.
    return features


def build_weights() -> tuple[np.ndarray, np.ndarray]:
    problems = collisions(HASH_SEED)
    if problems:
        sys.exit("bucket collisions: " + "; ".join(problems))
    owner = {bucket_of(word): label for label, words in KEYWORDS.items() for word in words}
    weights = np.zeros((len(LABELS), FEATURE_SIZE), dtype=np.float32)
    for bucket, label in owner.items():
        weights[LABELS.index(label), bucket] = KEYWORD_WEIGHT
    bias = np.array([NONE_BIAS, 0.0, 0.0], dtype=np.float32)
    return weights, bias


def build_model(weights: np.ndarray, bias: np.ndarray) -> bytes:
    b = flatbuffers.Builder(4096)

    def data_buffer(array: np.ndarray | None) -> int:
        if array is None:
            tflite.BufferStart(b)
            return tflite.BufferEnd(b)
        raw = array.astype("<f4").tobytes()
        b.StartVector(1, len(raw), 16)
        for byte in reversed(raw):
            b.PrependUint8(byte)
        vec = b.EndVector()
        tflite.BufferStart(b)
        tflite.BufferAddData(b, vec)
        return tflite.BufferEnd(b)

    def int_vector(start, values: list[int]) -> int:
        start(b, len(values))
        for v in reversed(values):
            b.PrependInt32(v)
        return b.EndVector()

    def tensor(name: str, shape: list[int], buffer: int) -> int:
        name_off = b.CreateString(name)
        shape_off = int_vector(tflite.TensorStartShapeVector, shape)
        tflite.TensorStart(b)
        tflite.TensorAddShape(b, shape_off)
        tflite.TensorAddType(b, tflite.TensorType.FLOAT32)
        tflite.TensorAddBuffer(b, buffer)
        tflite.TensorAddName(b, name_off)
        return tflite.TensorEnd(b)

    # Buffers: 0 = required empty sentinel, 1 = input, 2 = weights, 3 = bias, 4 = output.
    buffers = [data_buffer(None), data_buffer(None), data_buffer(weights), data_buffer(bias), data_buffer(None)]
    tensors = [
        tensor("features", [1, FEATURE_SIZE], 1),
        tensor("weights", [len(LABELS), FEATURE_SIZE], 2),
        tensor("bias", [len(LABELS)], 3),
        tensor("logits", [1, len(LABELS)], 4),
    ]

    tflite.FullyConnectedOptionsStart(b)
    tflite.FullyConnectedOptionsAddFusedActivationFunction(b, tflite.ActivationFunctionType.NONE)
    fc_options = tflite.FullyConnectedOptionsEnd(b)

    op_inputs = int_vector(tflite.OperatorStartInputsVector, [0, 1, 2])
    op_outputs = int_vector(tflite.OperatorStartOutputsVector, [3])
    tflite.OperatorStart(b)
    tflite.OperatorAddOpcodeIndex(b, 0)
    tflite.OperatorAddInputs(b, op_inputs)
    tflite.OperatorAddOutputs(b, op_outputs)
    tflite.OperatorAddBuiltinOptionsType(b, tflite.BuiltinOptions.FullyConnectedOptions)
    tflite.OperatorAddBuiltinOptions(b, fc_options)
    operator = tflite.OperatorEnd(b)

    tflite.SubGraphStartTensorsVector(b, len(tensors))
    for t in reversed(tensors):
        b.PrependUOffsetTRelative(t)
    tensors_vec = b.EndVector()
    sg_inputs = int_vector(tflite.SubGraphStartInputsVector, [0])
    sg_outputs = int_vector(tflite.SubGraphStartOutputsVector, [3])
    tflite.SubGraphStartOperatorsVector(b, 1)
    b.PrependUOffsetTRelative(operator)
    operators_vec = b.EndVector()
    sg_name = b.CreateString("main")
    tflite.SubGraphStart(b)
    tflite.SubGraphAddTensors(b, tensors_vec)
    tflite.SubGraphAddInputs(b, sg_inputs)
    tflite.SubGraphAddOutputs(b, sg_outputs)
    tflite.SubGraphAddOperators(b, operators_vec)
    tflite.SubGraphAddName(b, sg_name)
    subgraph = tflite.SubGraphEnd(b)

    tflite.OperatorCodeStart(b)
    tflite.OperatorCodeAddDeprecatedBuiltinCode(b, tflite.BuiltinOperator.FULLY_CONNECTED)
    tflite.OperatorCodeAddBuiltinCode(b, tflite.BuiltinOperator.FULLY_CONNECTED)
    tflite.OperatorCodeAddVersion(b, 1)
    opcode = tflite.OperatorCodeEnd(b)

    def tensor_map(name: str, index: int) -> int:
        name_off = b.CreateString(name)
        tflite.TensorMapStart(b)
        tflite.TensorMapAddName(b, name_off)
        tflite.TensorMapAddTensorIndex(b, index)
        return tflite.TensorMapEnd(b)

    sig_in = tensor_map("features", 0)
    sig_out = tensor_map("logits", 3)
    tflite.SignatureDefStartInputsVector(b, 1)
    b.PrependUOffsetTRelative(sig_in)
    sig_inputs = b.EndVector()
    tflite.SignatureDefStartOutputsVector(b, 1)
    b.PrependUOffsetTRelative(sig_out)
    sig_outputs = b.EndVector()
    sig_key = b.CreateString("serving_default")
    tflite.SignatureDefStart(b)
    tflite.SignatureDefAddInputs(b, sig_inputs)
    tflite.SignatureDefAddOutputs(b, sig_outputs)
    tflite.SignatureDefAddSignatureKey(b, sig_key)
    tflite.SignatureDefAddSubgraphIndex(b, 0)
    signature = tflite.SignatureDefEnd(b)

    def table_vector(start, items: list[int]) -> int:
        start(b, len(items))
        for item in reversed(items):
            b.PrependUOffsetTRelative(item)
        return b.EndVector()

    subgraphs_vec = table_vector(tflite.ModelStartSubgraphsVector, [subgraph])
    opcodes_vec = table_vector(tflite.ModelStartOperatorCodesVector, [opcode])
    buffers_vec = table_vector(tflite.ModelStartBuffersVector, buffers)
    signatures_vec = table_vector(tflite.ModelStartSignatureDefsVector, [signature])
    description = b.CreateString("Infinite Canvas stub intent model (keyword buckets)")

    tflite.ModelStart(b)
    tflite.ModelAddVersion(b, 3)
    tflite.ModelAddOperatorCodes(b, opcodes_vec)
    tflite.ModelAddSubgraphs(b, subgraphs_vec)
    tflite.ModelAddDescription(b, description)
    tflite.ModelAddBuffers(b, buffers_vec)
    tflite.ModelAddSignatureDefs(b, signatures_vec)
    model = tflite.ModelEnd(b)
    b.Finish(model, file_identifier=b"TFL3")
    return bytes(b.Output())


def verify(model_bytes: bytes) -> None:
    from ai_edge_litert.interpreter import Interpreter

    interpreter = Interpreter(model_content=model_bytes)
    runner = interpreter.get_signature_runner("serving_default")
    for text, expected in EXPECTATIONS.items():
        logits = runner(features=featurize(text)[None, :])["logits"][0]
        exp = np.exp(logits - logits.max())
        probs = exp / exp.sum()
        label = LABELS[int(np.argmax(probs))]
        print(f"  {text!r:28} -> {label:12} p={probs.max():.3f}")
        if label != expected:
            sys.exit(f"verification failed for {text!r}: expected {expected}, got {label}")


def main() -> None:
    global HASH_SEED
    HASH_SEED = choose_seed()
    print(f"hash seed: {HASH_SEED}")
    sync_typescript_seed(HASH_SEED)
    weights, bias = build_weights()
    model_bytes = build_model(weights, bias)
    print(f"verifying {len(model_bytes)} bytes with the LiteRT interpreter:")
    verify(model_bytes)
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    MODEL_PATH.write_bytes(model_bytes)
    parity = {
        "featureSize": FEATURE_SIZE,
        "hashSeed": HASH_SEED,
        "buckets": {word: bucket_of(word) for words in KEYWORDS.values() for word in words},
        "phrases": {text: featurize(text).round(6).tolist() for text in EXPECTATIONS},
    }
    PARITY_PATH.write_text(json.dumps(parity, indent=2) + "\n")
    print(f"wrote {MODEL_PATH.relative_to(ROOT)} and {PARITY_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
