import sys, time
sys.path.insert(0, 'codigo')
import numpy as np
import instruments as I
import cancion as C
import dsp as D
from dsp import SR, rms_db, lin2db

def stat(name, x, t0):
    x = np.asarray(x)
    print('%-14s %6.2fs  len=%7d  rms=%6.1f dB  peak=%6.1f dB  nan=%s'
          % (name, time.time() - t0, len(x), rms_db(x), lin2db(np.max(np.abs(x))),
             np.isnan(x).any()))

t = time.time(); stat('kick', I.kick(), t)
t = time.time(); stat('snare', I.snare(), t)
t = time.time(); stat('hat', I.hat(), t)
t = time.time(); stat('metal', I.metal_hit(), t)
t = time.time(); stat('shaker', I.shaker(), t)
t = time.time(); stat('bass A1', I.bass_note(33, 0.28), t)
t = time.time(); stat('bass squelch', I.bass_note(33, 0.2, squelch=1.0), t)
t = time.time(); stat('drone', I.drone_note(21, 21.3), t)
t = time.time(); stat('organ', I.organ_chord([57, 60, 64], 5.3), t)
t = time.time(); stat('guitar loop', I.guitar_loop(16, 90.0, C.GUITARRA), t)
t = time.time(); stat('piano', I.piano_note(76, 1.7), t)
t = time.time(); stat('squelch', I.squelch(), t)
t = time.time(); stat('growl', I.feedback_growl(), t)

sil = C.silabas_voz()
s1 = [s for s in sil if s[0] < C.t_de(60)]
t = time.time(); v = I.voice(s1, seed=11); stat('voz estrofa', v, t)
s2 = [s for s in sil if s[0] >= C.t_de(60)]
t = time.time(); v2 = I.voice(s2, seed=12, drive=1.7); stat('voz estribillo', v2, t)
t = time.time(); w = I.voice(s1, seed=41, whisper=True); stat('voz susurro', w, t)

# preview corto para escuchar
def wav(path, x):
    import struct
    x = np.asarray(x, np.float32)
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.9
    i = np.round(x * 32767).astype('<i2')
    data = i.tobytes()
    with open(path, 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVE' +
                b'fmt ' + struct.pack('<IHHIIHH', 16, 1, 2, SR, SR * 4, 4, 16) +
                b'data' + struct.pack('<I', len(data)) + data)

wav('audio/_test_voz.wav', v[:int(20 * SR)])
wav('audio/_test_voz_estribillo.wav', v2[:int(20 * SR)])
print('ok')
