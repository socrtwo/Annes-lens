"""Tiny ONNX models with the input/output shapes of the real on-device models, for the unit and
e2e tests of src/ai/device.ts (the real models are downloaded by the app, never committed):
  matte-test.onnx      input [1,3,h,w] (MODNet normalization)  -> [1,1,h,w]  alpha = clip((mean(ch) + 1) / 2)
  depth-test.onnx      pixel_values [1,3,518,518]              -> [1,518,518] mean of channels
  inpaint-test.onnx    image [1,3,512,512], mask [1,1,512,512] -> [1,3,512,512] image where mask is 0, mid-gray where 1 (0..255)
  sr-x2-test.onnx / sr-x4-test.onnx  pixel_values [1,3,h,w]   -> nearest-neighbor ×2 / ×4
  clip-vision-test.onnx pixel_values [1,3,224,224]            -> image_embeds [1,3] (mean per channel)
  clip-text-test.onnx  input_ids, attention_mask [1,77] int64 -> text_embeds [1,3] (first three ids)
plus a minimal vocab.json / merges.txt for the tokenizer. Run: python3 scripts/gen-ai-fixtures.py
"""
import json, os
import numpy as np
import onnx
from onnx import helper, TensorProto, numpy_helper

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'ai')
os.makedirs(OUT, exist_ok=True)

def const(name, arr, dtype=np.float32):
    return numpy_helper.from_array(np.asarray(arr, dtype=dtype), name)

def save(name, graph):
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)], producer_name="annes-lens-tests")
    model.ir_version = 8
    onnx.checker.check_model(model)
    onnx.save(model, os.path.join(OUT, name))
    print(name, os.path.getsize(os.path.join(OUT, name)), 'bytes')

# matte: mean over channels -> (x + 1) / 2 -> clip
g = helper.make_graph([
    helper.make_node('ReduceMean', ['input'], ['m'], axes=[1], keepdims=1),
    helper.make_node('Add', ['m', 'one'], ['a']),
    helper.make_node('Mul', ['a', 'half'], ['b']),
    helper.make_node('Clip', ['b', 'zero', 'one'], ['output']),
], 'matte', [helper.make_tensor_value_info('input', TensorProto.FLOAT, [1, 3, 'h', 'w'])],
   [helper.make_tensor_value_info('output', TensorProto.FLOAT, [1, 1, 'h', 'w'])],
   [const('one', 1.0), const('half', 0.5), const('zero', 0.0)])
save('matte-test.onnx', g)

# depth: mean over channels, no keepdims
g = helper.make_graph([helper.make_node('ReduceMean', ['pixel_values'], ['predicted_depth'], axes=[1], keepdims=0)], 'depth',
   [helper.make_tensor_value_info('pixel_values', TensorProto.FLOAT, [1, 3, 518, 518])],
   [helper.make_tensor_value_info('predicted_depth', TensorProto.FLOAT, [1, 518, 518])])
save('depth-test.onnx', g)

# inpaint: image * (1 - mask) + 0.5 * mask, times 255
g = helper.make_graph([
    helper.make_node('Sub', ['one', 'mask'], ['inv']),
    helper.make_node('Mul', ['image', 'inv'], ['keep']),
    helper.make_node('Mul', ['mask', 'half'], ['fill']),
    helper.make_node('Add', ['keep', 'fill'], ['sum']),
    helper.make_node('Mul', ['sum', 'k255'], ['output']),
], 'inpaint', [helper.make_tensor_value_info('image', TensorProto.FLOAT, [1, 3, 512, 512]), helper.make_tensor_value_info('mask', TensorProto.FLOAT, [1, 1, 512, 512])],
   [helper.make_tensor_value_info('output', TensorProto.FLOAT, [1, 3, 512, 512])],
   [const('one', 1.0), const('half', 0.5), const('k255', 255.0)])
save('inpaint-test.onnx', g)

for s in (2, 4):
    g = helper.make_graph([helper.make_node('Resize', ['pixel_values', 'roi', 'scales'], ['reconstruction'], mode='nearest', coordinate_transformation_mode='asymmetric', nearest_mode='floor')], 'sr',
       [helper.make_tensor_value_info('pixel_values', TensorProto.FLOAT, [1, 3, 'h', 'w'])],
       [helper.make_tensor_value_info('reconstruction', TensorProto.FLOAT, [1, 3, 'H', 'W'])],
       [const('roi', [], np.float32), const('scales', [1, 1, s, s], np.float32)])
    save(f'sr-x{s}-test.onnx', g)

# clip vision: mean over h, w -> [1,3]; a second output to make sure the named one is picked
g = helper.make_graph([
    helper.make_node('ReduceMean', ['pixel_values'], ['image_embeds'], axes=[2, 3], keepdims=0),
    helper.make_node('Mul', ['image_embeds', 'k2'], ['last_hidden_state']),
], 'clipv', [helper.make_tensor_value_info('pixel_values', TensorProto.FLOAT, [1, 3, 224, 224])],
   [helper.make_tensor_value_info('last_hidden_state', TensorProto.FLOAT, [1, 3]), helper.make_tensor_value_info('image_embeds', TensorProto.FLOAT, [1, 3])],
   [const('k2', 2.0)])
save('clip-vision-test.onnx', g)

# clip text: first three ids as floats
g = helper.make_graph([
    helper.make_node('Cast', ['input_ids'], ['f'], to=TensorProto.FLOAT),
    helper.make_node('Slice', ['f', 'st', 'en', 'ax'], ['text_embeds']),
    helper.make_node('Cast', ['attention_mask'], ['am'], to=TensorProto.FLOAT),
    helper.make_node('ReduceSum', ['am', 'ax'], ['last_hidden_state'], keepdims=1),
], 'clipt', [helper.make_tensor_value_info('input_ids', TensorProto.INT64, [1, 77]), helper.make_tensor_value_info('attention_mask', TensorProto.INT64, [1, 77])],
   [helper.make_tensor_value_info('text_embeds', TensorProto.FLOAT, [1, 3]), helper.make_tensor_value_info('last_hidden_state', TensorProto.FLOAT, [1, 1])],
   [const('st', [0], np.int64), const('en', [3], np.int64), const('ax', [1], np.int64)])
save('clip-text-test.onnx', g)

# a minimal CLIP-style vocabulary: every byte character with and without </w>, plus the special tokens
bs = list(range(33, 127)) + list(range(161, 173)) + list(range(174, 256))
cs = bs[:]
n = 0
for b in range(256):
    if b not in bs:
        bs.append(b); cs.append(256 + n); n += 1
chars = [chr(c) for c in cs]
vocab = {}
for ch in chars: vocab[ch] = len(vocab)
for ch in chars: vocab[ch + '</w>'] = len(vocab)
vocab['<|startoftext|>'] = 49406
vocab['<|endoftext|>'] = 49407
# a few merges so the BPE path is exercised: "t h" -> "th", "th e</w>" -> "the</w>"
merges = '#version: 0.2\nt h\nth e</w>\nc a\nca t</w>\n'
vocab['th'] = 40000; vocab['the</w>'] = 40001; vocab['ca'] = 40002; vocab['cat</w>'] = 40003
json.dump(vocab, open(os.path.join(OUT, 'vocab.json'), 'w'))
open(os.path.join(OUT, 'merges.txt'), 'w').write(merges)
print('vocab', len(vocab))
