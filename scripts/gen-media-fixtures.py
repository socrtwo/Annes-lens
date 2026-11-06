#!/usr/bin/env python3
"""Video and audio fixtures for the media reader (tests/fixtures/media), made with ffmpeg: short clips in every
container the app reads, with tags and cover art where the container carries them, and expected.json from ffprobe
(the container's duration, each stream's codec, size, sample rate and channels, the tags). Needs ffmpeg, ffprobe
and Pillow."""
import json, os, subprocess, sys
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'media')
os.makedirs(OUT, exist_ok=True)
cover = os.path.join(OUT, 'cover.png')
im = Image.new('RGB', (64, 64), (20, 60, 160)); d = ImageDraw.Draw(im); d.ellipse((16, 16, 48, 48), fill=(240, 200, 40)); im.save(cover)
coverjpg = os.path.join(OUT, 'cover.jpg'); im.save(coverjpg, quality=85)

def ff(*args):
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', *args], check=True)
VIDEO = ['-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=10:duration=1']
TONE = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1']
TAGS = ['-metadata', 'title=Fixture Title', '-metadata', 'artist=Anne Lens', '-metadata', 'album=Test Album', '-metadata', 'date=2024']
files = {}
def make(name, args, note):
    ff(*args, os.path.join(OUT, name)); files[name] = note
# Video containers.
make('clip-vp9.webm', [*VIDEO, *TONE, '-c:v', 'libvpx-vp9', '-b:v', '60k', '-c:a', 'libopus', '-b:a', '24k', '-shortest', *TAGS], 'WebM: VP9 video with Opus audio, tags')
make('clip-vp8.webm', [*VIDEO, '-c:v', 'libvpx', '-b:v', '60k', '-an'], 'WebM: VP8 video only')
make('clip-h264.mp4', [*VIDEO, *TONE, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '32k', '-shortest', *TAGS, '-metadata', 'creation_time=2024-03-12T10:15:00Z', '-movflags', '+faststart'], 'MP4: H.264 video with AAC audio, tags, a creation time, moov first')
make('clip-h264.mov', [*VIDEO, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', *TAGS], 'QuickTime: H.264 video, tags')
make('clip-h264.mkv', [*VIDEO, *TONE, '-i', coverjpg, '-map', '0', '-map', '1', '-attach', coverjpg, '-metadata:s:t', 'mimetype=image/jpeg', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'flac', '-shortest', *TAGS], 'Matroska: H.264 video, FLAC audio, an attached cover, tags')
make('clip-mjpeg.avi', [*VIDEO, *TONE, '-c:v', 'mjpeg', '-q:v', '8', '-c:a', 'pcm_s16le', '-shortest', *TAGS], 'AVI: Motion JPEG video with PCM audio, INFO tags')
make('clip-theora.ogv', [*VIDEO, *TONE, '-c:v', 'libtheora', '-q:v', '3', '-c:a', 'libvorbis', '-q:a', '2', '-shortest', *TAGS], 'Ogg: Theora video with Vorbis audio, comments')
make('clip-3gp.3gp', [*VIDEO, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', '-an', '-f', '3gp'], '3GPP: H.264 Baseline video')
# Audio containers.
make('tone.wav', [*TONE, '-c:a', 'pcm_s16le', *TAGS], 'WAVE: 16-bit PCM, INFO tags')
make('tone-float.wav', [*TONE, '-c:a', 'pcm_f32le', '-ac', '2'], 'WAVE: 32-bit float stereo (WAVE_FORMAT_EXTENSIBLE)')
make('tone.flac', [*TONE, '-i', cover, '-map', '0', '-map', '1', '-c:a', 'flac', '-c:v', 'png', '-disposition:v', 'attached_pic', *TAGS], 'FLAC with a PNG cover and comments')
make('tone.mp3', [*TONE, '-i', coverjpg, '-map', '0', '-map', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-c:v', 'mjpeg', '-id3v2_version', '3', *TAGS], 'MP3: ID3v2.3 with a JPEG cover, CBR 64 kbit/s with an Info frame')
make('tone-vbr.mp3', [*TONE, '-c:a', 'libmp3lame', '-q:a', '7', '-id3v2_version', '4', '-write_id3v1', '1', *TAGS], 'MP3: ID3v2.4 and ID3v1, VBR with a Xing frame')
make('tone-bare.mp3', [*TONE, '-c:a', 'libmp3lame', '-b:a', '32k', '-write_xing', '0', '-map_metadata', '-1', '-id3v2_version', '0'], 'MP3: frames only, no tags, no Xing (duration from the bitrate)')
make('tone.ogg', [*TONE, '-c:a', 'libvorbis', '-q:a', '2', *TAGS], 'Ogg Vorbis with comments')
make('tone.opus', [*TONE, '-c:a', 'libopus', '-b:a', '24k', *TAGS], 'Ogg Opus with tags')
make('tone.m4a', [*TONE, '-i', cover, '-map', '0', '-map', '1', '-c:a', 'aac', '-b:a', '48k', '-c:v', 'png', '-disposition:v', 'attached_pic', *TAGS], 'M4A: AAC with iTunes tags and a PNG cover')
make('tone.aiff', [*TONE, '-c:a', 'pcm_s16be', *TAGS], 'AIFF: 16-bit PCM, NAME/AUTH chunks')
make('tone-opus.mka', [*TONE, '-c:a', 'libopus', '-b:a', '24k', *TAGS], 'Matroska audio: Opus')
# An ID3v2.2 tag written by hand (ffmpeg writes only 2.3 and 2.4) in front of the bare frames.
bare = open(os.path.join(OUT, 'tone-bare.mp3'), 'rb').read()
def f22(fid, text): body = b'\x00' + text.encode('latin-1'); return fid.encode() + len(body).to_bytes(3, 'big') + body
frames = f22('TT2', 'Old Title') + f22('TP1', 'Old Artist') + f22('TAL', 'Old Album') + f22('TYE', '1999')
pic = b'\x00JPG\x03' + b'front\x00' + open(coverjpg, 'rb').read()
frames += b'PIC' + len(pic).to_bytes(3, 'big') + pic
size = len(frames); ss = bytes([(size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127])
open(os.path.join(OUT, 'tone-id3v22.mp3'), 'wb').write(b'ID3\x02\x00\x00' + ss + frames + bare); files['tone-id3v22.mp3'] = 'MP3: an ID3v2.2 tag (TT2/TP1/TAL/TYE, PIC cover) before bare frames'

expected = {}
for name, note in files.items():
    pr = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', os.path.join(OUT, name)], check=True, capture_output=True).stdout)
    streams = []
    for s in pr['streams']:
        if s.get('disposition', {}).get('attached_pic'): continue
        st = {'type': s['codec_type'], 'codec': s['codec_name']}
        for k in ('width', 'height', 'channels'):
            if k in s: st[k] = int(s[k])
        if 'sample_rate' in s: st['sampleRate'] = int(s['sample_rate'])
        streams.append(st)
    tags = {k.lower(): v for k, v in pr['format'].get('tags', {}).items() if k.lower() in ('title', 'artist', 'album', 'date')}
    if not tags:
        for s in pr['streams']:
            for k, v in s.get('tags', {}).items():
                if k.lower() in ('title', 'artist', 'album', 'date') and k.lower() not in tags: tags[k.lower()] = v
    expected[name] = {'note': note, 'duration': float(pr['format']['duration']), 'streams': streams, 'tags': tags, 'cover': any(s.get('disposition', {}).get('attached_pic') for s in pr['streams']) or name.endswith('.mkv') or name == 'tone-id3v22.mp3', 'size': int(pr['format']['size'])}
with open(os.path.join(OUT, 'expected.json'), 'w') as f:
    json.dump(expected, f, indent=1, sort_keys=True)
for k, v in expected.items(): print(k, v['duration'], v['streams'], v['tags'])
