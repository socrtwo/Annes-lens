#!/usr/bin/env python3
"""Fixtures for Browse ▸ People, with OpenCV (cv.FaceDetectorYN, cv.FaceRecognizerSF) as the reference.

Downloads five public-domain White House portraits from Wikimedia Commons (Barack Obama, Joe Biden,
Kamala Harris, and the 2009 and 2012 joint portraits of Obama and Biden), reduces them to 480 px,
and writes to tests/fixtures/people/:
  *.jpg                               the pictures
  face_detection_yunet_2023mar.onnx   the YuNet detector (MIT, OpenCV Zoo via huggingface.co/opencv)
  opencv-reference.json               OpenCV's faces: box, landmarks, score, SFace features (fp32)
  align-<n>.png, align-src-<n>.png    OpenCV's 112×112 aligned crops of the first two faces, and the decoded
                                      pixels around them (offsets in the JSON)
The SFace models are not stored (38.7 MB / 9.9 MB): they are downloaded into node_modules/.cache/annes-lens-models,
where the browser test (tests/e2e/smoke.mjs) takes the int8 one.
Needs numpy, Pillow, opencv-python-headless.
"""
import glob, json, os, sys, time, urllib.request
import numpy as np
import cv2 as cv
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'people')
CACHE = os.path.join(os.path.dirname(__file__), '..', 'node_modules', '.cache', 'annes-lens-models')
UA = 'AnnesLensTests/1.0 (https://github.com/socrtwo/annes-lens; test fixtures)'
PHOTOS = {
    'obama.jpg': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8d/President_Barack_Obama.jpg/960px-President_Barack_Obama.jpg',
    'biden.jpg': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6a/Inaugural_portrait_of_Joe_Biden.jpg/960px-Inaugural_portrait_of_Joe_Biden.jpg',
    'harris.jpg': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/41/Kamala_Harris_Vice_Presidential_Portrait.jpg/960px-Kamala_Harris_Vice_Presidential_Portrait.jpg',
    'both-2009.jpg': 'https://upload.wikimedia.org/wikipedia/commons/8/80/Official_portrait_of_President_Obama_and_Vice_President_Biden_2009.jpg',
    'both-2012.jpg': 'https://upload.wikimedia.org/wikipedia/commons/e/e4/Official_portrait_of_President_Obama_and_Vice_President_Biden_2012.jpg',
}
MODELS = {
    'face_detection_yunet_2023mar.onnx': 'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx',
    'face_recognition_sface_2021dec.onnx': 'https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx',
    # What the app downloads by default; the browser test runs it.
    'face_recognition_sface_2021dec_int8.onnx': 'https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec_int8.onnx',
}


def fetch(url, path):
    if os.path.exists(path):
        return
    for k in range(8):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=120).read()
            open(path, 'wb').write(data)
            return
        except Exception as e:  # Commons rate-limits; back off
            print('retry', os.path.basename(path), e, file=sys.stderr)
            time.sleep(4 * (k + 1))
    raise SystemExit(f'could not download {url}')


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    for n, u in MODELS.items():
        fetch(u, os.path.join(CACHE, n))
    for n, u in PHOTOS.items():
        raw = os.path.join(CACHE, 'photo-' + n)
        fetch(u, raw)
        im = Image.open(raw).convert('RGB')
        k = 480 / max(im.size)
        if k < 1:
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        im.save(os.path.join(OUT, n), quality=88)
        time.sleep(1)
    det_path = os.path.join(CACHE, 'face_detection_yunet_2023mar.onnx')
    open(os.path.join(OUT, 'face_detection_yunet_2023mar.onnx'), 'wb').write(open(det_path, 'rb').read())
    det = cv.FaceDetectorYN.create(det_path, '', (320, 320), 0.6, 0.3, 5000)
    rec = cv.FaceRecognizerSF.create(os.path.join(CACHE, 'face_recognition_sface_2021dec.onnx'), '')
    faces, offsets = [], []
    for p in sorted(glob.glob(os.path.join(OUT, '*.jpg'))):
        img = cv.imread(p)
        h, w = img.shape[:2]
        det.setInputSize((w, h))
        _, found = det.detect(img)
        for row in (found if found is not None else []):
            al = rec.alignCrop(img, row)
            if len(faces) < 2:
                cv.imwrite(os.path.join(OUT, f'align-{len(faces)}.png'), al)
                # The decoded pixels around the face, losslessly, for the alignment test.
                x0, y0 = max(0, int(row[0] - row[2] * 0.4)), max(0, int(row[1] - row[3] * 0.4))
                x1, y1 = min(w, int(row[0] + row[2] * 1.4)), min(h, int(row[1] + row[3] * 1.4))
                cv.imwrite(os.path.join(OUT, f'align-src-{len(faces)}.png'), img[y0:y1, x0:x1])
                offsets.append([x0, y0])
            faces.append({'file': os.path.basename(p), 'box': [round(float(v), 2) for v in row[:4]], 'kps': [round(float(v), 2) for v in row[4:14]],
                          'score': round(float(row[14]), 4), 'feat': [float(v) for v in rec.feature(al)[0]]})
    json.dump({'faces': faces, 'alignOffsets': offsets}, open(os.path.join(OUT, 'opencv-reference.json'), 'w'))
    F = np.array([f['feat'] for f in faces])
    F /= np.linalg.norm(F, axis=1, keepdims=True)
    np.set_printoptions(precision=2, suppress=True, linewidth=160)
    for f in faces:
        print(f['file'], f['box'], f['score'])
    print(F @ F.T)


if __name__ == '__main__':
    main()
