"""midi_export.py - Volcado del plan de eventos a Standard MIDI File (SMF tipo 1).

Contrato: ``INTERFACES_closer.md`` seccion "2. midi_export.py".

Los eventos llegan YA resueltos por el render (aqui no se calcula musica):

    pitched: (start_s, dur_s, midi_note, velocity)      velocity 1..127
    drum   : (start_s, velocity)                        velocity 1..127

API publica
-----------
    write_track_midi(path, name, kind, events, *, bpm=90.0, program=0,
                     gm_note=36, channel=0, ppq=480, start_offset=0.0) -> dict
    write_multitrack_midi(path, tracks, *, bpm=90.0, ppq=480) -> dict
    read_midi(path) -> dict
    verify_midi(path, expected, *, kind, tol_ticks=2) -> dict

Decisiones de formato (documentadas porque el contrato las deja abiertas)
--------------------------------------------------------------------------
* SMF **tipo 1**, ``ticks_per_beat = ppq`` (480 por defecto).
* Cada pista lleva al principio ``track_name`` = ``name`` y ``set_tempo``
  derivado de ``bpm`` (``mido.bpm2tempo``: 90 BPM -> 666667 us/beat). En un
  multitrack cada pista repite el mismo tempo: asi cada pista extraida del
  SMF se puede reproducir sola sin perder el tempo.
* ``program_change`` **solo** si ``kind == 'pitched'``.
* Conversion tiempo -> ticks: ``round(t_s * ppq * bpm / 60)``, identica para el
  onset y para la duracion de la nota; duracion minima 1 tick.
* ``kind == 'drum'``: canal 9 fijo y nota = ``gm_note`` (percusion GM). La
  duracion de nota es **fija de 1/16 de negra**, es decir ``ppq / 4`` ticks
  (120 ticks con ppq=480). Es un valor en ticks, por tanto independiente del
  tempo; solo sirve para que el note_off exista y no se solapen bombos.
* Extension aceptada (no rompe el contrato): un evento de bateria puede venir
  como ``(start_s, velocity, midi_note)`` con la nota GM explicita, util para
  escribir un kit entero (bombo/caja/charles) en una sola pista. Con la tupla
  de 2 elementos se usa siempre ``gm_note``, que es el caso normal.
* Solapamientos de la MISMA nota en el MISMO canal: si una nota empieza antes
  de que acabe la anterior, se trunca el ``note_off`` anterior al onset nuevo
  (se cuenta en ``overlaps_fixed``). Si el onset coincide exactamente con el
  anterior (nota duplicada, imposible de separar), se descarta la segunda y se
  cuenta en ``duplicates_skipped``. Asi los delta-times nunca son negativos y
  no hay note_off sin su note_on.

Solo se usan ``mido`` y la stdlib (numpy no hace falta aqui).
"""

import os

import mido

__all__ = [
    "Event",
    "DRUM_NOTE_FRACTION",
    "write_track_midi",
    "write_multitrack_midi",
    "read_midi",
    "verify_midi",
]

#: Tipo (documental) de los eventos que llegan del render.
Event = tuple

#: Duracion de nota fija en 'drum', en fracciones de negra (1/16 de negra).
DRUM_NOTE_FRACTION = 0.25

VALID_KINDS = ("pitched", "drum")


# ---------------------------------------------------------------------------
# utilidades internas
# ---------------------------------------------------------------------------
def _check_kind(kind):
    if kind not in VALID_KINDS:
        raise ValueError("kind debe ser 'pitched' o 'drum', recibido %r" % (kind,))
    return kind


def _check_velocity(vel, where):
    try:
        iv = int(vel)
    except (TypeError, ValueError):
        raise ValueError("%s: velocity no entera: %r" % (where, vel))
    if iv < 1 or iv > 127:
        raise ValueError("%s: velocity fuera de 1..127: %r" % (where, vel))
    return iv


def _check_note(note, where):
    try:
        inote = int(note)
    except (TypeError, ValueError):
        raise ValueError("%s: nota no entera: %r" % (where, note))
    if inote < 0 or inote > 127:
        raise ValueError("%s: nota fuera de 0..127: %r" % (where, note))
    return inote


def _s_to_ticks(t_s, ppq, bpm):
    """round(t_s * ppq * bpm / 60) segun contrato."""
    return int(round(float(t_s) * float(ppq) * float(bpm) / 60.0))


def _ticks_to_s(tick, ppq, bpm):
    return float(tick) * 60.0 / (float(ppq) * float(bpm))


def _drum_note_ticks(ppq):
    """Duracion fija de nota en 'drum': 1/16 de negra en ticks."""
    return max(1, int(round(float(ppq) * DRUM_NOTE_FRACTION)))


def _collect_intervals(events, kind, name, ppq, bpm, gm_note, channel, start_offset):
    """Convierte eventos de tiempo a intervalos [on_tick, off_tick) en ticks.

    Devuelve (intervals, stats); cada intervalo es
    ``[on_tick, off_tick, note, velocity]`` ya sin solapamientos ilegales.
    """
    stats = {
        "overlaps_fixed": 0,
        "duplicates_skipped": 0,
        "clamped": 0,
    }
    drum_ticks = _drum_note_ticks(ppq)
    raw = []
    for i, ev in enumerate(events):
        where = "evento %d de la pista %r" % (i, name)
        if not isinstance(ev, (tuple, list)):
            raise TypeError("%s: se esperaba tupla, recibido %r" % (where, type(ev)))
        if kind == "pitched":
            if len(ev) != 4:
                raise ValueError("%s: pitched espera (start_s, dur_s, midi_note, velocity), "
                                 "recibido %r" % (where, ev))
            start_s, dur_s, note, vel = ev
            note = _check_note(note, where)
            vel = _check_velocity(vel, where)
            on = _s_to_ticks(float(start_s) + float(start_offset), ppq, bpm)
            off = on + max(1, _s_to_ticks(float(dur_s), ppq, bpm))
        else:
            if len(ev) == 2:
                start_s, vel = ev
                note = int(gm_note)
            elif len(ev) == 3:
                # extension documentada: nota GM explicita por evento
                start_s, vel, note = ev
            else:
                raise ValueError("%s: drum espera (start_s, velocity) o "
                                 "(start_s, velocity, midi_note), recibido %r" % (where, ev))
            note = _check_note(note, where)
            vel = _check_velocity(vel, where)
            on = _s_to_ticks(float(start_s) + float(start_offset), ppq, bpm)
            off = on + drum_ticks
        if on < 0:
            raise ValueError("%s: onset negativo en ticks (%d); revisa start_offset" % (where, on))
        raw.append([on, off, note, vel, i])

    # Orden estable por onset y, a igualdad, por orden de entrada.
    raw.sort(key=lambda r: (r[0], r[4]))

    # Resolucion de solapamientos por (nota): misma nota en el mismo canal.
    intervals = []
    last_of_note = {}
    for it in raw:
        on, off, note = it[0], it[1], it[2]
        prev = last_of_note.get(note)
        if prev is not None and on < prev[1]:
            if on > prev[0]:
                prev[1] = on          # truncamos la nota anterior
                stats["overlaps_fixed"] += 1
            else:
                stats["duplicates_skipped"] += 1
                continue
        last_of_note[note] = it
        intervals.append(it)

    return intervals, stats


def _make_track(name, kind, events, *, bpm, program, gm_note, channel, ppq, start_offset):
    """Construye una MidiTrack (meta + notas) y devuelve (track, stats)."""
    _check_kind(kind)
    ppq = int(ppq)
    if ppq <= 0:
        raise ValueError("ppq debe ser positivo")
    if bpm <= 0:
        raise ValueError("bpm debe ser positivo")

    if kind == "drum":
        used_channel = 9
    else:
        used_channel = int(channel)
        if not (0 <= used_channel <= 15):
            raise ValueError("channel debe estar en 0..15")

    intervals, stats = _collect_intervals(
        events, kind, name, ppq, bpm, gm_note, channel, start_offset
    )

    track = mido.MidiTrack()
    track.append(mido.MetaMessage("track_name", name=str(name), time=0))
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    if kind == "pitched":
        prog = int(program)
        if not (0 <= prog <= 127):
            raise ValueError("program debe estar en 0..127")
        track.append(mido.Message("program_change", program=prog,
                                  channel=used_channel, time=0))

    # Mensajes absolutos: note_off (prio 0) antes que note_on (prio 1) a igual tick.
    msgs = []
    for on, off, note, vel, _idx in intervals:
        msgs.append((on, 1, note, 0, mido.Message("note_on", note=int(note),
                                                 velocity=int(vel),
                                                 channel=used_channel, time=0)))
        msgs.append((off, 0, note, 0, mido.Message("note_off", note=int(note),
                                                  velocity=64,
                                                  channel=used_channel, time=0)))
    msgs.sort(key=lambda m: (m[0], m[1], m[2]))

    prev = 0
    for tick, _prio, _note, _x, msg in msgs:
        delta = tick - prev
        if delta < 0:                      # imposible tras ordenar; cinturon
            raise AssertionError("delta-time negativo (%d); fallo de ordenacion" % delta)
        msg.time = delta
        prev = tick
        track.append(msg)

    stats["channel"] = used_channel
    stats["note_ticks"] = _drum_note_ticks(ppq) if kind == "drum" else None
    stats["notes_written"] = len(intervals)
    stats["end_tick"] = max([iv[1] for iv in intervals], default=0)
    return track, stats


# ---------------------------------------------------------------------------
# escritura
# ---------------------------------------------------------------------------
def write_track_midi(path, name, kind, events, *, bpm=90.0, program=0, gm_note=36,
                     channel=0, ppq=480, start_offset=0.0):
    """Escribe UNA pista en su propio SMF tipo 1.

    Parametros
    ----------
    path : str        destino .mid
    name : str        nombre de pista (MetaMessage track_name)
    kind : str        'pitched' | 'drum'
    events : list     pitched: (start_s, dur_s, midi_note, velocity)
                      drum:    (start_s, velocity)  [o (start_s, velocity, note)]
    bpm, program, gm_note, channel, ppq, start_offset : ver docstring del modulo.

    Devuelve un dict con: path, name, kind, bpm, us_per_beat, ppq, channel,
    program, gm_note, events_in, notes_written, overlaps_fixed,
    duplicates_skipped, drum_note_ticks, end_tick, duration_s.
    """
    _check_kind(kind)
    events = list(events or [])
    track, stats = _make_track(name, kind, events, bpm=float(bpm), program=program,
                               gm_note=gm_note, channel=channel, ppq=int(ppq),
                               start_offset=float(start_offset))

    mf = mido.MidiFile(type=1, ticks_per_beat=int(ppq))
    mf.tracks.append(track)
    mf.save(os.fspath(path))

    return {
        "path": os.path.abspath(os.fspath(path)),
        "name": str(name),
        "kind": kind,
        "bpm": float(bpm),
        "us_per_beat": int(mido.bpm2tempo(bpm)),
        "ppq": int(ppq),
        "channel": stats["channel"],
        "program": int(program) if kind == "pitched" else None,
        "gm_note": int(gm_note) if kind == "drum" else None,
        "events_in": len(events),
        "notes_written": stats["notes_written"],
        "overlaps_fixed": stats["overlaps_fixed"],
        "duplicates_skipped": stats["duplicates_skipped"],
        "drum_note_ticks": stats["note_ticks"],
        "end_tick": stats["end_tick"],
        "duration_s": _ticks_to_s(stats["end_tick"], int(ppq), float(bpm))
        if stats["end_tick"] else 0.0,
    }


def write_multitrack_midi(path, tracks, *, bpm=90.0, ppq=480):
    """Escribe varias pistas en UN solo SMF tipo 1 (una MidiTrack por track).

    ``tracks`` es una lista de dicts con las mismas claves que acepta
    ``write_track_midi``: name, kind, events, program, gm_note, channel y
    opcionalmente start_offset. Todas usan el mismo ``bpm`` y ``ppq``
    (los valores del dict se ignoran si los hay: manda la llamada).

    Devuelve un dict con: path, bpm, us_per_beat, ppq, n_tracks, tracks[...]
    (el dict de cada pista tal como lo devolveria ``write_track_midi``).
    """
    ppq = int(ppq)
    bpm = float(bpm)
    mf = mido.MidiFile(type=1, ticks_per_beat=ppq)
    report = []
    for i, spec in enumerate(tracks or []):
        if not isinstance(spec, dict):
            raise TypeError("tracks[%d] debe ser un dict, recibido %r" % (i, type(spec)))
        name = spec.get("name", "track%d" % i)
        kind = spec.get("kind", "pitched")
        td, stats = _make_track(
            name,
            kind,
            list(spec.get("events") or []),
            bpm=bpm,
            program=spec.get("program", 0),
            gm_note=spec.get("gm_note", 36),
            channel=spec.get("channel", 0),
            ppq=ppq,
            start_offset=spec.get("start_offset", 0.0),
        )
        mf.tracks.append(td)
        report.append({
            "name": str(name),
            "kind": kind,
            "channel": stats["channel"],
            "program": int(spec.get("program", 0)) if kind == "pitched" else None,
            "gm_note": int(spec.get("gm_note", 36)) if kind == "drum" else None,
            "events_in": len(spec.get("events") or []),
            "notes_written": stats["notes_written"],
            "overlaps_fixed": stats["overlaps_fixed"],
            "duplicates_skipped": stats["duplicates_skipped"],
            "drum_note_ticks": stats["note_ticks"],
            "end_tick": stats["end_tick"],
        })

    mf.save(os.fspath(path))
    return {
        "path": os.path.abspath(os.fspath(path)),
        "bpm": bpm,
        "us_per_beat": int(mido.bpm2tempo(bpm)),
        "ppq": ppq,
        "n_tracks": len(report),
        "tracks": report,
        "duration_s": max([t["end_tick"] for t in report], default=0) * 60.0 / (ppq * bpm),
    }


# ---------------------------------------------------------------------------
# lectura
# ---------------------------------------------------------------------------
def _primary_tempo(mf):
    """Primer set_tempo del fichero (en orden de pista); 120 BPM si no hay."""
    for tr in mf.tracks:
        for msg in tr:
            if msg.type == "set_tempo":
                return msg.tempo
    return mido.bpm2tempo(120.0)


def read_midi(path):
    """Relee un SMF con mido y devuelve los onsets en segundos.

    -> {'ppq': int, 'bpm': float,
        'tracks': [{'name': str, 'events': [(abs_s, note, vel), ...]}, ...]}

    Solo se devuelven los onsets (``note_on`` con velocity > 0). El tempo se
    supone constante (es lo que escribe este modulo); ``bpm`` va redondeado a
    3 decimales porque ``bpm2tempo``/``tempo2bpm`` no son exactos
    (90 BPM <-> 666667 us/beat -> 89.99996).
    """
    mf = mido.MidiFile(os.fspath(path))
    ppq = int(mf.ticks_per_beat)
    us_per_beat = _primary_tempo(mf)
    bpm = mido.tempo2bpm(us_per_beat)

    tracks = []
    for tr in mf.tracks:
        name = ""
        tick = 0
        events = []
        for msg in tr:
            tick += int(msg.time)
            if msg.type == "track_name":
                name = str(msg.name)
            elif msg.type == "note_on" and msg.velocity > 0:
                events.append((round(_ticks_to_s(tick, ppq, bpm), 9),
                               int(msg.note), int(msg.velocity)))
        events.sort(key=lambda e: (e[0], e[1]))
        tracks.append({"name": name, "events": events})

    return {
        "ppq": ppq,
        "bpm": round(bpm, 3),
        "ticks_per_beat": ppq,
        "us_per_beat": int(us_per_beat),
        "n_tracks": len(tracks),
        "tracks": tracks,
    }


# ---------------------------------------------------------------------------
# verificacion
# ---------------------------------------------------------------------------
def _normalize_expected(expected):
    """Acepta lista de eventos, dict con 'events', dict con 'tracks' o lista de dicts.

    Devuelve (grupos, is_multitrack) con grupos = [{'name': str|None, 'events': [...]}]
    """
    def _g(d, default_name=None):
        g = {"name": d.get("name", default_name), "events": list(d.get("events") or [])}
        if "kind" in d:                      # multitrack mixto: kind por pista
            g["kind"] = d["kind"]
        return g

    if isinstance(expected, dict):
        if "tracks" in expected:
            return ([_g(t) for t in expected["tracks"]], True)
        if "events" in expected:
            return ([_g(expected)], False)
        return ([{"name": k, "events": list(v)} for k, v in expected.items()], True)
    if isinstance(expected, (list, tuple)):
        exp = list(expected)
        if exp and isinstance(exp[0], dict):
            return ([_g(t) for t in exp], True)
        return ([{"name": None, "events": exp}], False)
    raise TypeError("expected debe ser lista de eventos, lista de dicts o dict")


def _expected_ticks(events, kind, ppq, bpm):
    """Eventos esperados -> [(tick, note|None, vel)] (note None en drum de 2 tuplas)."""
    out = []
    for i, ev in enumerate(events):
        if kind == "pitched":
            start_s, _dur, note, vel = ev
            out.append((_s_to_ticks(float(start_s), ppq, bpm), int(note), int(vel)))
        else:
            if len(ev) == 2:
                start_s, vel = ev
                note = None
            else:
                start_s, vel, note = ev
                note = int(note)
            out.append((_s_to_ticks(float(start_s), ppq, bpm), note, int(vel)))
    return out


def _fmt_row(cells):
    return "| " + " | ".join(cells) + " |"


def verify_midi(path, expected, *, kind, tol_ticks=2):
    """Relee el fichero con mido (independiente de la escritura) y compara.

    Comprueba: numero de eventos, nota y onset (en ticks, dentro de
    ``tol_ticks``). Imprime una tabla y devuelve
    ``{'ok', 'checked', 'max_tick_error', 'errors'}`` (+ datos de apoyo:
    'path', 'kind', 'bpm', 'ppq', 'tracks', 'worst_track').

    ``expected`` puede ser:
      * lista de eventos (un solo track),
      * lista de dicts con 'name'/'events' (multitrack, como en
        ``write_multitrack_midi``),
      * dict con 'tracks' o 'events'.
    """
    _check_kind(kind)
    tol_ticks = int(tol_ticks)
    path = os.fspath(path)

    # --- relectura independiente con mido (ticks absolutos) ---------------
    mf = mido.MidiFile(path)
    ppq = int(mf.ticks_per_beat)
    bpm = mido.tempo2bpm(_primary_tempo(mf))
    file_tracks = []
    for tr in mf.tracks:
        name = ""
        tick = 0
        onsets = []
        for msg in tr:
            tick += int(msg.time)
            if msg.type == "track_name":
                name = str(msg.name)
            elif msg.type == "note_on" and msg.velocity > 0:
                onsets.append((tick, int(msg.note), int(msg.velocity)))
        onsets.sort(key=lambda o: (o[0], o[1]))
        file_tracks.append({"name": name, "onsets": onsets})

    groups, _multi = _normalize_expected(expected)

    errors = []
    checked = 0
    max_tick_error = 0
    worst_track = ""
    per_track = []

    print("verify_midi: %s  (kind=%s, file=%s)" % (os.path.basename(path), kind,
                                                   os.path.basename(path)))
    print("  fichero: ppq=%d  bpm=%.4f  us/beat=%d  n_tracks=%d"
          % (ppq, bpm, int(_primary_tempo(mf)), len(file_tracks)))
    header = _fmt_row(["track", "#", "exp_tick", "got_tick", "d_tick",
                       "exp_note", "got_note", "exp_vel", "got_vel", "ok"])
    sep = "|" + "|".join(["-" * (len(c) + 2) for c in
                          ["track", "#", "exp_tick", "got_tick", "d_tick",
                           "exp_note", "got_note", "exp_vel", "got_vel", "ok"]]) + "|"
    print(header)
    print(sep)

    used = set()
    for gi, grp in enumerate(groups):
        gkind = grp.get("kind", kind)
        _check_kind(gkind)
        exp = _expected_ticks(grp["events"], gkind, ppq, bpm)
        gname = grp["name"]

        # localizar la pista real: por nombre; si no, la primera libre con notas
        idx = None
        if gname is not None:
            for k, ft in enumerate(file_tracks):
                if ft["name"] == gname and k not in used:
                    idx = k
                    break
        if idx is None:
            with_notes = [k for k, ft in enumerate(file_tracks) if ft["onsets"]]
            if len(groups) == 1 and with_notes:
                idx = with_notes[0]
            elif len(file_tracks) == len(groups):
                idx = gi
            elif with_notes:
                idx = [k for k in with_notes if k not in used][0]
            else:
                idx = 0
        used.add(idx)
        got = file_tracks[idx]["onsets"]
        tname = file_tracks[idx]["name"] or "<sin nombre>"

        if gname is not None and file_tracks[idx]["name"] != gname:
            errors.append("pista %d: nombre esperado %r, encontrado %r"
                          % (gi, gname, file_tracks[idx]["name"]))
        if len(exp) != len(got):
            errors.append("pista %r: %d eventos esperados, %d leidos"
                          % (tname, len(exp), len(got)))

        # nota de referencia en drum cuando el evento esperado no la trae
        drum_ref = None
        if gkind == "drum":
            notes = {n for (_t, n, _v) in got}
            drum_ref = notes.pop() if len(notes) == 1 else None

        tr_max = 0
        n = min(len(exp), len(got))
        for j in range(n):
            et, en, ev = exp[j]
            gt, gn, gv = got[j]
            dt = abs(gt - et)
            tr_max = max(tr_max, dt)
            exp_note = en if en is not None else drum_ref
            ok = (dt <= tol_ticks) and (exp_note == gn) and (ev == gv)
            if not ok:
                bits = []
                if dt > tol_ticks:
                    bits.append("onset %d ticks (tol %d)" % (dt, tol_ticks))
                if exp_note != gn:
                    bits.append("nota %r != %r" % (exp_note, gn))
                if ev != gv:
                    bits.append("velocity %d != %d" % (ev, gv))
                errors.append("pista %r evento %d: %s" % (tname, j, "; ".join(bits)))
            print(_fmt_row([tname[:12], str(j), str(et), str(gt), str(dt),
                            str(exp_note), str(gn), str(ev), str(gv),
                            "OK" if ok else "FAIL"]))
            checked += 1
        # eventos sobrantes / que faltan se listan explicitamente
        for j in range(n, len(exp)):
            print(_fmt_row([tname[:12], str(j), str(exp[j][0]), "-", "-",
                            str(exp[j][1] if exp[j][1] is not None else drum_ref),
                            "-", str(exp[j][2]), "-", "MISSING"]))
        for j in range(n, len(got)):
            print(_fmt_row([tname[:12], str(j), "-", str(got[j][0]), "-", "-",
                            str(got[j][1]), "-", str(got[j][2]), "EXTRA"]))

        if tr_max > max_tick_error:
            max_tick_error = tr_max
            worst_track = tname
        per_track.append({"name": tname, "expected": len(exp), "read": len(got),
                          "max_tick_error": tr_max})

    ok = not errors
    print("  -> checked=%d  max_tick_error=%d ticks  %s"
          % (checked, max_tick_error, "OK" if ok else "FALLOS: %d" % len(errors)))
    if not ok:
        for e in errors:
            print("     ! " + e)

    return {
        "ok": ok,
        "checked": checked,
        "max_tick_error": int(max_tick_error),
        "errors": errors,
        "path": os.path.abspath(path),
        "kind": kind,
        "bpm": round(bpm, 4),
        "ppq": ppq,
        "worst_track": worst_track,
        "tracks": per_track,
        "tol_ticks": tol_ticks,
    }


# ---------------------------------------------------------------------------
# TEST REAL: 3 pistas (bateria 8 compases, bajo 8 notas, pad de acordes)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import sys
    try:                                    # consola Windows: acentos y flechas
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tmp")
    os.makedirs(ROOT, exist_ok=True)
    BPM = 90.0
    BEAT = 60.0 / BPM                      # 0.6666... s
    BAR = 4.0 * BEAT                      # 2.6666... s
    STEP = BEAT / 4.0                      # semicorchea

    created = []

    def fpath(fname):
        p = os.path.join(ROOT, fname)
        created.append(p)
        return p

    def head(txt):
        print("")
        print("=" * 78)
        print(txt)
        print("=" * 78)

    # ------------------------------------------------------------------ datos
    # bateria: 8 compases a 90 BPM (21.333 s), rejilla de semicorcheas.
    # Notas GM: 36 bombo, 38 caja, 42 charles.  Eventos (start, vel, note).
    kick_steps = [0, 4, 8, 12]
    snare_steps = [4, 12]
    hat_steps = [0, 2, 4, 6, 8, 10, 12, 14]
    drums = []
    for bar_i in range(8):
        t0 = bar_i * BAR
        for s in kick_steps:
            drums.append((t0 + s * STEP, 118 if s == 0 else 100, 36))
        for s in snare_steps:
            drums.append((t0 + s * STEP, 108, 38))
        for s in hat_steps:
            drums.append((t0 + s * STEP, 92 if s % 4 == 0 else 70, 42))
    drums.sort(key=lambda e: (e[0], e[2]))
    n_kick = sum(1 for e in drums if e[2] == 36)
    n_snare = sum(1 for e in drums if e[2] == 38)
    n_hat = sum(1 for e in drums if e[2] == 42)

    # bajo: 8 notas cromaticas funky, corcheas, staccato
    bass_notes = [36, 39, 43, 46, 43, 41, 39, 37]
    bass = []
    for i, nt in enumerate(bass_notes):
        bass.append((i * BEAT * 0.5, BEAT * 0.42, nt, 112 - (i % 3) * 6))

    # pad: 4 acordes de 4 notas (una nota por voz, todas simultaneas)
    chords = [[48, 51, 55, 58], [44, 48, 51, 55], [46, 50, 53, 58], [48, 51, 55, 60]]
    pad = []
    for ci, ch in enumerate(chords):
        for nt in ch:
            pad.append((ci * BAR, BAR * 0.98, nt, 84))

    print("Plan de prueba: 90 BPM, 4/4, negra=%.6f s, compas=%.6f s" % (BEAT, BAR))
    print("  bateria: %d eventos (bombo %d / caja %d / charles %d) en 8 compases"
          % (len(drums), n_kick, n_snare, n_hat))
    print("  bajo   : %d eventos" % len(bass))
    print("  pad    : %d eventos (%d acordes x 4 notas)" % (len(pad), len(chords)))

    failures = []

    def check(cond, label):
        if not cond:
            failures.append(label)
            print("  ASSERT FAIL: %s" % label)

    try:
        # ------------------------------------------------ 1) pistas sueltas
        head("1) ESCRITURA DE CADA PISTA EN SU PROPIO FICHERO")

        p_drums = fpath("_test_bateria.mid")
        w_drums = write_track_midi(p_drums, "bateria", "drum", drums, bpm=BPM, channel=9)
        print("write_track_midi(bateria) -> %s" % w_drums)

        # ruta estricta del contrato: bombo solo con gm_note y tuplas de 2
        kick_simple = [(e[0], e[1]) for e in drums if e[2] == 36]
        p_kick = fpath("_test_kick.mid")
        w_kick = write_track_midi(p_kick, "kick", "drum", kick_simple,
                                  bpm=BPM, gm_note=36)
        print("write_track_midi(kick, gm_note=36) -> %s" % w_kick)

        p_bass = fpath("_test_bajo.mid")
        w_bass = write_track_midi(p_bass, "bajo", "pitched", bass,
                                  bpm=BPM, program=38, channel=0)
        print("write_track_midi(bajo) -> %s" % w_bass)

        p_pad = fpath("_test_pad.mid")
        w_pad = write_track_midi(p_pad, "pad", "pitched", pad,
                                 bpm=BPM, program=16, channel=2)
        print("write_track_midi(pad) -> %s" % w_pad)

        # ------------------------------------------------ 2) multitrack
        head("2) ESCRITURA DE LAS TRES PISTAS EN UN SOLO SMF (write_multitrack_midi)")
        p_song = fpath("_test_song.mid")
        tracks_spec = [
            {"name": "bateria", "kind": "drum", "events": drums, "gm_note": 36},
            {"name": "bajo", "kind": "pitched", "events": bass, "program": 38, "channel": 0},
            {"name": "pad", "kind": "pitched", "events": pad, "program": 16, "channel": 2},
        ]
        w_song = write_multitrack_midi(p_song, tracks_spec, bpm=BPM)
        print("write_multitrack_midi -> path=%s n_tracks=%d ppq=%d bpm=%s us/beat=%d"
              % (os.path.basename(w_song["path"]), w_song["n_tracks"], w_song["ppq"],
                 w_song["bpm"], w_song["us_per_beat"]))
        for t in w_song["tracks"]:
            print("   pista %-8s kind=%-7s ch=%d prog=%-4s eventos=%d notas_escritas=%d"
                  % (t["name"], t["kind"], t["channel"], t["program"],
                     t["events_in"], t["notes_written"]))

        # ------------------------------------------------ 3) relectura
        head("3) REELECTURA CON mido (read_midi) Y VERIFICACION (verify_midi)")

        r_drums = read_midi(p_drums)
        print("read_midi(bateria): ppq=%d bpm=%s n_tracks=%d nombre=%r eventos=%d"
              % (r_drums["ppq"], r_drums["bpm"], r_drums["n_tracks"],
                 r_drums["tracks"][0]["name"], len(r_drums["tracks"][0]["events"])))
        check(abs(r_drums["bpm"] - 90.0) < 1e-3, "bpm leido de bateria = 90")
        check(r_drums["ppq"] == 480, "ppq leido de bateria = 480")
        check(r_drums["tracks"][0]["name"] == "bateria", "track_name leido = 'bateria'")
        check(len(r_drums["tracks"][0]["events"]) == len(drums),
              "nº eventos bateria == %d" % len(drums))
        first = r_drums["tracks"][0]["events"][0]
        check(abs(first[0]) < 1e-9, "primer onset bateria en t=0 s")

        v_drums = verify_midi(p_drums, drums, kind="drum")
        check(v_drums["ok"], "verify bateria ok")
        check(v_drums["max_tick_error"] <= 1, "bateria max_tick_error <= 1")
        check(v_drums["checked"] == len(drums), "bateria checked == %d" % len(drums))

        v_kick = verify_midi(p_kick, kick_simple, kind="drum")
        check(v_kick["ok"], "verify kick (gm_note estricto) ok")
        check(v_kick["max_tick_error"] <= 1, "kick max_tick_error <= 1")
        r_kick = read_midi(p_kick)
        check({n for (_t, n, _v) in r_kick["tracks"][0]["events"]} == {36},
              "kick: todos los eventos con nota GM 36")

        v_bass = verify_midi(p_bass, bass, kind="pitched")
        check(v_bass["ok"], "verify bajo ok")
        check(v_bass["max_tick_error"] <= 1, "bajo max_tick_error <= 1")

        v_pad = verify_midi(p_pad, pad, kind="pitched")
        check(v_pad["ok"], "verify pad ok")
        check(v_pad["max_tick_error"] <= 1, "pad max_tick_error <= 1")

        # multitrack: se verifica cada pista por nombre
        v_song = verify_midi(p_song, tracks_spec, kind="pitched")
        check(v_song["ok"], "verify multitrack ok")
        check(v_song["max_tick_error"] <= 1, "multitrack max_tick_error <= 1")
        check(v_song["checked"] == len(drums) + len(bass) + len(pad),
              "multitrack checked == suma de las 3 pistas")

        r_song = read_midi(p_song)
        print("")
        print("read_midi(song): ppq=%d bpm=%s n_tracks=%d" %
              (r_song["ppq"], r_song["bpm"], r_song["n_tracks"]))
        check(r_song["n_tracks"] == 3, "song tiene 3 pistas")
        check(abs(r_song["bpm"] - 90.0) < 1e-3, "song bpm = 90")
        names = [t["name"] for t in r_song["tracks"]]
        check(names == ["bateria", "bajo", "pad"], "nombres de pista song: %r" % (names,))
        counts = [len(t["events"]) for t in r_song["tracks"]]
        check(counts == [len(drums), len(bass), len(pad)],
              "nº eventos por pista song: %r" % (counts,))
        for t, ref, label in ((r_song["tracks"][0], drums, "bateria"),
                              (r_song["tracks"][1], bass, "bajo"),
                              (r_song["tracks"][2], pad, "pad")):
            nts = [e[1] for e in t["events"]]
            exp = [e[2] for e in ref]
            check(sorted(nts) == sorted(exp),
                  "notas de %s coinciden con el plan (multiconjunto)" % label)
            print("   %-8s eventos=%3d notas(min/max)=%d/%d dur_hasta=%.3f s"
                  % (label, len(t["events"]), min(nts), max(nts), t["events"][-1][0]))

        # ------------------------------------------------ 4) casos limite
        head("4) CASOS LIMITE: pista vacia, un solo evento, acorde y solapamiento")

        p_empty = fpath("_test_vacia.mid")
        w_empty = write_track_midi(p_empty, "vacia", "pitched", [], bpm=BPM, program=0)
        v_empty = verify_midi(p_empty, [], kind="pitched")
        r_empty = read_midi(p_empty)
        check(v_empty["ok"] and v_empty["checked"] == 0, "track vacio: verify ok, 0 eventos")
        check(len(r_empty["tracks"][0]["events"]) == 0, "track vacio: 0 eventos releidos")
        check(r_empty["tracks"][0]["name"] == "vacia", "track vacio: nombre conservado")
        check(abs(r_empty["bpm"] - 90.0) < 1e-3, "track vacio: tempo conservado")
        print("track vacio: notes_written=%d, end_tick=%d" % (w_empty["notes_written"],
                                                              w_empty["end_tick"]))

        p_one = fpath("_test_uno.mid")
        one = [(1.5, 0.75, 60, 127)]
        w_one = write_track_midi(p_one, "uno", "pitched", one, bpm=BPM, program=52, channel=3)
        v_one = verify_midi(p_one, one, kind="pitched")
        check(v_one["ok"], "un solo evento: ok")
        check(v_one["max_tick_error"] <= 1, "un solo evento: error <= 1 tick")
        r_one = read_midi(p_one)
        check(len(r_one["tracks"][0]["events"]) == 1, "un solo evento: 1 evento releido")
        print("un evento: onset leido=%.6f s (esperado 1.5), nota=%d vel=%d"
              % r_one["tracks"][0]["events"][0][0:3])

        # acorde de 4 notas simultaneas + nota duplicada solapada (misma nota)
        p_chord = fpath("_test_acorde.mid")
        chord_ev = [(0.0, 2.0, 48, 100), (0.0, 2.0, 52, 100),
                    (0.0, 2.0, 55, 100), (0.0, 2.0, 58, 100),
                    (1.0, 1.0, 60, 90), (1.5, 1.0, 60, 90)]   # solapamiento misma nota
        w_chord = write_track_midi(p_chord, "acorde", "pitched", chord_ev, bpm=BPM, program=0)
        v_chord = verify_midi(p_chord, chord_ev, kind="pitched")
        check(v_chord["ok"], "acorde + solapamiento: verify ok")
        check(v_chord["max_tick_error"] <= 1, "acorde: error <= 1 tick")
        check(w_chord["overlaps_fixed"] == 1,
              "acorde: 1 solapamiento corregido (obtenido %d)" % w_chord["overlaps_fixed"])
        r_chord = read_midi(p_chord)
        ch_ev = r_chord["tracks"][0]["events"]
        same_start = [e for e in ch_ev if abs(e[0]) < 1e-9]
        check(len(same_start) == 4, "acorde: 4 onsets simultaneos en t=0")
        # el SMF debe seguir siendo legal: 4 note_on + 4 note_off a t=0/2s
        mf_ch = mido.MidiFile(p_chord)
        ons = sum(1 for m in mf_ch.tracks[0] if m.type == "note_on")
        offs = sum(1 for m in mf_ch.tracks[0] if m.type == "note_off")
        check(ons == offs and ons == 6, "acorde: note_on == note_off == 6 (%d/%d)" % (ons, offs))
        print("acorde: %d note_on / %d note_off, overlaps_fixed=%d, duplicates_skipped=%d"
              % (ons, offs, w_chord["overlaps_fixed"], w_chord["duplicates_skipped"]))

        # nota duplicada exacta en el mismo tick -> se descarta y se cuenta
        p_dup = fpath("_test_dup.mid")
        dup_ev = [(0.0, 1.0, 62, 80), (0.0, 1.0, 62, 80)]
        w_dup = write_track_midi(p_dup, "dup", "pitched", dup_ev, bpm=BPM)
        mf_dup = mido.MidiFile(p_dup)
        d_on = sum(1 for m in mf_dup.tracks[0] if m.type == "note_on")
        check(w_dup["duplicates_skipped"] == 1 and d_on == 1,
              "nota duplicada descartada (skipped=%d, note_on=%d)"
              % (w_dup["duplicates_skipped"], d_on))

        # offset de pista
        p_off = fpath("_test_offset.mid")
        write_track_midi(p_off, "offset", "pitched", [(0.0, 0.5, 64, 100)],
                         bpm=BPM, start_offset=BEAT)
        r_off = read_midi(p_off)
        check(abs(r_off["tracks"][0]["events"][0][0] - BEAT) < 1e-6,
              "start_offset aplicado (%.6f s)" % r_off["tracks"][0]["events"][0][0])

        # ------------------------------------------------ 5) resumen
        head("5) RESUMEN")
        print("tempo en fichero: us/beat=%d  ->  bpm=%.4f (90 BPM exactos en el SMF)"
              % (w_drums["us_per_beat"], mido.tempo2bpm(w_drums["us_per_beat"])))
        print("error maximo en ticks: bateria=%d bajo=%d pad=%d multitrack=%d acorde=%d"
              % (v_drums["max_tick_error"], v_bass["max_tick_error"],
                 v_pad["max_tick_error"], v_song["max_tick_error"],
                 v_chord["max_tick_error"]))
        total = (len(drums) + len(bass) + len(pad))
        print("eventos verificados: bateria=%d + bajo=%d + pad=%d = %d (multitrack: %d)"
              % (len(drums), len(bass), len(pad), total, v_song["checked"]))
        if failures:
            print("FALLOS (%d):" % len(failures))
            for f in failures:
                print("  - " + f)
        else:
            print("TODOS LOS TESTS OK")
    finally:
        print("")
        print("Ficheros de prueba dejados en %s (no se borra nada sin permiso):" % ROOT)
        for p in created:
            if os.path.exists(p):
                print("  %s" % os.path.basename(p))

    sys.exit(1 if failures else 0)
