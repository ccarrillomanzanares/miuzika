#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Empaqueta un render del song-worker como proyecto .miuzika.zip.

Incluye el master WAV, el MIDI original y project.json con las pistas MIDI
editables (silenciadas para que el master no se duplique al abrir).
No incluye los stems: pesan ~1 GB y deben descargarse aparte.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import wave
import zipfile
from datetime import datetime, timezone

import mido

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def read_track(path: str, ppq: int, length_beats: float) -> dict | None:
    midi = mido.MidiFile(path)
    ticks_per_beat = midi.ticks_per_beat or ppq
    name = os.path.splitext(os.path.basename(path))[0]
    notes: list[dict] = []
    active: dict[int, tuple[int, int]] = {}
    tick = 0
    for msg in midi.tracks[0]:
        tick += int(msg.time)
        if msg.type == "track_name":
            name = str(msg.name) or name
        elif msg.type == "note_on" and msg.velocity > 0:
            active[int(msg.note)] = (tick, int(msg.velocity))
        elif msg.type in ("note_off", "note_on"):
            note = int(msg.note)
            if note not in active:
                continue
            start_tick, velocity = active.pop(note)
            start = start_tick / ticks_per_beat
            duration = max(0.01, (tick - start_tick) / ticks_per_beat)
            if start >= length_beats:
                continue
            notes.append({
                "pitch": note,
                "start": round(start, 6),
                "duration": round(min(duration, length_beats - start), 6),
                "velocity": max(1, min(127, velocity)),
            })
    if not notes:
        return None
    notes.sort(key=lambda note: (note["start"], note["pitch"]))
    return {"name": name, "notes": notes}


def instrument_for(name: str) -> str:
    key = name.lower()
    if any(word in key for word in ("kick", "snare", "hat", "perc", "drum", "metal")):
        return "drumkit"
    if any(word in key for word in ("bass", "sub")):
        return "bass"
    if any(word in key for word in ("organ", "drone", "pad")):
        return "pad"
    if any(word in key for word in ("piano",)):
        return "soundfont"
    if any(word in key for word in ("guitar", "gtr")):
        return "synth"
    if any(word in key for word in ("lead", "squelch", "growl")):
        return "lead"
    return "synth"


def parse_key(raw: str) -> dict:
    parts = (raw or "C minor").strip().split()
    tonic = parts[0] if parts else "C"
    mode = "major"
    if len(parts) > 1 and "min" in parts[1].lower():
        mode = "minor"
    return {"tonic": tonic, "mode": mode}


def wav_duration_beats(path: str, bpm: float) -> float:
    with wave.open(path, "rb") as handle:
        frames = handle.getnframes()
        rate = handle.getframerate() or 44_100
    return frames / rate * bpm / 60.0


def find_master(out_dir: str, explicit: str | None) -> str:
    if explicit:
        return os.path.abspath(explicit)
    candidates = [
        os.path.join(out_dir, name)
        for name in os.listdir(out_dir)
        if name.lower().endswith(".wav") and not name.startswith("_")
    ]
    if not candidates:
        raise FileNotFoundError("No hay master WAV en el directorio de salida")
    return max(candidates, key=os.path.getmtime)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.getcwd())
    parser.add_argument("--master")
    parser.add_argument("--title", default="Canción")
    parser.add_argument("--key", default="C minor")
    parser.add_argument("--bpm", type=float, default=90)
    parser.add_argument("--bars", type=int, default=32)
    parser.add_argument("--destination")
    args = parser.parse_args()

    out_dir = os.path.abspath(args.out)
    render_info = {}
    render_path = os.path.join(out_dir, "render.json")
    if os.path.isfile(render_path):
        with open(render_path, encoding="utf-8") as handle:
            render_info = json.load(handle)
    title = args.title if args.title != "Canción" else str(render_info.get("title", args.title))
    key = args.key if args.key != "C minor" else str(render_info.get("key", args.key))
    bpm = args.bpm if args.bpm != 90 else float(render_info.get("bpm", args.bpm))
    bars = args.bars if args.bars != 32 else int(render_info.get("bars", args.bars))
    master = find_master(out_dir, args.master or render_info.get("master"))
    length_beats = bars * 4
    duration_beats = wav_duration_beats(master, bpm)
    midi_dir = os.path.join(out_dir, "midi")
    tracks: list[dict] = []
    if os.path.isdir(midi_dir):
        for name in sorted(os.listdir(midi_dir)):
            if not name.lower().endswith(".mid") or name.lower() == "song.mid":
                continue
            parsed = read_track(os.path.join(midi_dir, name), 480, length_beats)
            if not parsed:
                continue
            track_id = "trk_" + "".join(
                ch if ch.isalnum() else "_" for ch in parsed["name"].lower()
            )[:48]
            tracks.append({
                "id": track_id,
                "name": parsed["name"][:60],
                "kind": "midi",
                "instrument": {"type": instrument_for(parsed["name"])},
                "gainDb": 0,
                "pan": 0,
                "muted": True,
                "solo": False,
                "devices": [],
                "clips": [{
                    "id": track_id + "_clip",
                    "name": parsed["name"][:60],
                    "start": 0,
                    "length": length_beats,
                    "notes": parsed["notes"],
                }],
            })

    asset_id = "aud_song_master"
    master_bytes = os.path.getsize(master)
    tracks.insert(0, {
        "id": "trk_master",
        "name": "Master",
        "kind": "audio",
        "instrument": {"type": "sampler"},
        "gainDb": 0,
        "pan": 0,
        "muted": False,
        "solo": False,
        "devices": [],
        "clips": [{
            "id": "trk_master_clip",
            "name": os.path.basename(master),
            "start": 0,
            "length": length_beats,
            "notes": [],
            "audio": {"assetId": asset_id, "offset": 0, "gainDb": 0},
        }],
    })
    project = {
        "schemaVersion": 1,
        "id": "prj_" + "".join(ch if ch.isalnum() else "_" for ch in title.lower())[:40],
        "name": title,
        "bpm": bpm,
        "key": parse_key(key),
        "timeSignature": {"numerator": 4, "denominator": 4},
        "lengthBars": bars,
        "seed": 1,
        "tracks": tracks,
        "audioAssets": [{
            "id": asset_id,
            "name": "Master",
            "durationBeats": duration_beats,
        }],
        "master": {"gainDb": 0},
        "meta": {
            "generator": "miuzika-song-worker",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        },
    }
    manifest = {
        "format": "miuzika-project",
        "version": 1,
        "assets": [{
            "id": asset_id,
            "name": "Master",
            "durationBeats": duration_beats,
            "file": "audio/master.wav",
        }],
    }
    destination = args.destination or os.path.join(
        out_dir, "".join(ch if ch.isalnum() else "-" for ch in title.lower()).strip("-") + ".miuzika.zip"
    )
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_STORED) as bundle:
        bundle.writestr("project.json", json.dumps(project, ensure_ascii=False, indent=2))
        bundle.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        bundle.write(master, "audio/master.wav")
        if os.path.isdir(midi_dir):
            for name in sorted(os.listdir(midi_dir)):
                if name.lower().endswith(".mid"):
                    bundle.write(os.path.join(midi_dir, name), "midi/" + name)
    print(json.dumps({
        "ok": True,
        "bundle": os.path.abspath(destination),
        "master": master,
        "bytes": os.path.getsize(destination),
        "masterBytes": master_bytes,
        "tracks": len(tracks),
        "midiTracks": len(tracks) - 1,
        "lengthBars": bars,
        "bpm": bpm,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
