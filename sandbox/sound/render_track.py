#!/usr/bin/env python3
"""Renderiza una pista MIDI del proyecto con las voces de Rendered.

Entrada (stdin, JSON):
  {
    "bpm": 100,
    "lengthBars": 32,
    "track": {
      "name": "Bass",
      "instrument": "bass",
      "gainDb": -4,
      "pan": -0.1,
      "clips": [{"start": 0, "length": 16, "notes": [...]}]
    }
  }

Salida: JSON con WAV base64 y métricas.
"""

import base64
import io
import json
import math
import sys
import wave

import numpy as np

sys.path.insert(0, "/app/rendered")

import dsp_core as dc  # noqa: E402
import voices_drums as vd  # noqa: E402
import voices_synths as vs  # noqa: E402

SR = 44_100
MAX_SECONDS = 240.0


def midi_hz(pitch: int) -> float:
    return 440.0 * 2.0 ** ((pitch - 69) / 12.0)


def render_drum(pitch: int, duration: float, velocity: float) -> np.ndarray:
    tail = max(0.12, min(1.4, duration + 0.35))
    n = dc.sec(tail)
    if pitch == 36:
        return vd.kick(n) * velocity
    if pitch in (37, 38):
        return vd.snare(n) * velocity
    if pitch == 39:
        return vd.clap(n) * velocity
    if pitch in (42, 44):
        return vd.hat(n, open=False) * velocity
    if pitch == 46:
        return vd.hat(n, open=True) * velocity
    if pitch in (49, 51):
        return vd.metal(n) * velocity
    if pitch in (45, 47, 48):
        f0 = {45: 105.0, 47: 140.0, 48: 180.0}[pitch]
        return vd.kick(n, f0=f0, f1=f0 * 0.62, decay=0.24, click=0.18) * velocity
    return vd.snare(n) * velocity


def render_note(instrument: str, pitch: int, duration: float, velocity: float) -> np.ndarray:
    frequency = midi_hz(pitch)
    if instrument == "drumkit":
        return render_drum(pitch, duration, velocity)
    if instrument == "bass":
        n = dc.sec(max(0.06, duration) + 0.10)
        return vs.bass(frequency, n, glide=0.0, sub=0.5, fc_env=(90.0, 2600.0),
                       fc_tau=0.22, res=3.2, drive=2.4) * velocity
    if instrument == "pad":
        n = dc.sec(max(0.08, duration) + 0.55)
        return vs.pad([frequency], n, attack=min(0.35, max(0.02, duration * 0.25)),
                      release=0.35, cutoff=2400.0, width=0.0) * velocity
    if instrument == "strings":
        n = dc.sec(max(0.06, duration) + 0.30)
        return vs.strings([frequency], n, attack=0.02, release=0.25,
                          drive=2.0, cutoff=4200.0) * velocity
    if instrument == "choir":
        n = dc.sec(max(0.10, duration) + 0.55)
        return vs.choir([frequency], n, vowel="ah", attack=0.15,
                        release=0.35) * velocity
    if instrument == "pluck" or instrument == "arp":
        n = dc.sec(max(0.06, duration) + 0.18)
        return vs.pluck(frequency, n, decay=min(0.5, max(0.08, duration)),
                        cutoff=2400.0, drive=1.4) * velocity
    # lead, synth, soundfont y sampler usan la voz solista
    n = dc.sec(max(0.06, duration) + 0.20)
    return vs.lead(frequency, n, vibrato=0.0035, drive=2.6,
                   cutoff=3400.0) * velocity


def main() -> None:
    try:
        request = json.loads(sys.stdin.buffer.read(2_000_000).decode("utf-8"))
        bpm = float(request.get("bpm", 100))
        length_bars = int(request.get("lengthBars", 16))
        track = request.get("track") or {}
        instrument = str(track.get("instrument", "synth"))
        gain_db = float(track.get("gainDb", 0))
        pan = float(track.get("pan", 0))
        if bpm <= 0 or length_bars <= 0:
            raise ValueError("BPM/compases inválidos")
        seconds_per_beat = 60.0 / bpm
        seconds = length_bars * 4 * seconds_per_beat + 2.0
        if seconds > MAX_SECONDS:
            raise ValueError(f"La pista dura {seconds:.1f}s; máximo {MAX_SECONDS:.0f}s")
        total = dc.sec(seconds)
        bus = dc.bus(total)
        gain = dc.db2lin(gain_db)
        notes = 0
        for clip in track.get("clips") or []:
            clip_start = float(clip.get("start", 0))
            for note in clip.get("notes") or []:
                pitch = int(note.get("pitch", 60))
                start = (clip_start + float(note.get("start", 0))) * seconds_per_beat
                duration = float(note.get("duration", 1)) * seconds_per_beat
                velocity = max(0.0, min(1.0, float(note.get("velocity", 100)) / 127.0))
                if velocity <= 0 or start >= seconds:
                    continue
                mono = render_note(instrument, pitch, duration, velocity)
                dc.add_at(bus, mono, start, gain=gain, pan_value=pan)
                notes += 1
        if notes == 0:
            raise ValueError("La pista no tiene notas que renderizar")
        peak = dc.peak(bus)
        if peak > 0.99:
            bus *= 0.99 / peak
        ensure = dc.ensure_finite(bus, "rendered-track")
        pcm = np.round(np.clip(ensure.T * 32767.0, -32768, 32767)).astype("<i2")
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(2)
            wav.setsampwidth(2)
            wav.setframerate(SR)
            wav.writeframes(pcm.tobytes())
        rms = float(np.sqrt(np.mean(ensure**2)))
        sys.stdout.write(json.dumps({
            "ok": True,
            "wav": base64.b64encode(output.getvalue()).decode("ascii"),
            "duration": total / SR,
            "sampleRate": SR,
            "channels": 2,
            "frames": total,
            "notes": notes,
            "peakDbfs": 20 * math.log10(max(float(np.max(np.abs(ensure))), 1e-12)),
            "rmsDbfs": 20 * math.log10(max(rms, 1e-12)),
        }))
    except Exception as error:  # noqa: BLE001
        sys.stdout.write(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
