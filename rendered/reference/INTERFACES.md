# INTERFACES.md — contrato de "Static Prayer" (dark synth-pop industrial)

Todos los módulos trabajan con **numpy puro** (SIN scipy), `sr = 44100`, y solo importan
`dsp_core as dc` (ver `dsp_core.py`: notas, osciladores, ruido espectral, envolventes, filtros,
estereo, escritura WAV). Está probado: `python dsp_core.py` imprime `dsp_core OK`.

**Contrato de datos de audio**

| Tipo | Forma | Rango |
|---|---|---|
| voz mono | `np.ndarray` float64 `(n,)` | pico ≤ 1.2, sin NaN/inf |
| bus estereo | `np.ndarray` float64 `(2, n)` | pico ≤ 1.2 antes del master |

Reglas para TODOS los módulos:

1. Solo `numpy` (ya instalado) + `dsp_core`. **Prohibido** scipy, red, pip, ficheros temporales
   fuera del proyecto, y modificar `dsp_core.py` o `song_data.py`.
2. Nada de bucles Python por muestra en señales largas (una canción son ~7,8 M de muestras):
   los bucles sólo valen dentro de una función que se aplica a un buffer corto (una nota/percusion).
3. Cada función devuelve SIEMPRE un array del largo pedido (`n`), finito, sin DC apreciable.
4. Cada módulo tiene un `if __name__ == "__main__":` que **renderiza de verdad** cada voz y
   imprime `nombre len= pico= rms=` con asserts. El módulo no se entrega si ese test no pasa.
5. Identificadores y ficheros en inglés, docstrings/comentarios en español, respuesta en español.

---

## 1. `voices_drums.py` — percusión (todas las funciones devuelven mono `(n,)`)

```python
import numpy as np
import dsp_core as dc

def kick(n, sr=dc.SR, f0=115.0, f1=45.0, pitch_tau=0.045, decay=0.55,
         drive=2.2, click=0.5, seed=11): ...
def snare(n, sr=dc.SR, tone=185.0, decay=0.20, gate=0.0, noise_lo=1200.0,
          noise_hi=9000.0, drive=1.6, seed=21): ...
def hat(n, sr=dc.SR, decay=0.045, lo=7000.0, hi=15000.0, open=False, seed=31): ...
def clap(n, sr=dc.SR, decay=0.18, spread=0.011, lo=900.0, hi=6000.0, seed=41): ...
def metal(n, sr=dc.SR, f=131.0, ratio=1.4142, ratio2=2.732, index0=14.0, index_tau=0.28,
          decay=0.9, crush_hz=11000.0, crush_levels=96.0, drive=3.4, seed=51): ...
def sweep(n, sr=dc.SR, f_start=200.0, f_end=7000.0, res=2.0, up=True, seed=61): ...
def impact(n, sr=dc.SR, f0=90.0, f1=32.0, decay=1.2, drive=2.0, seed=71): ...
def rev_cymbal(n, sr=dc.SR, lo=3000.0, seed=81): ...
```

Requisitos de carácter (dark wave / industrial, DM de los 90):

- `kick`: seno con caída de tono `f0 -> f1` (curva `dc.osc` con array de frecuencia) + click de
  ruido muy corto; saturado con `dc.soft_clip`. Debe tener cuerpo (>40 Hz) **y** ataque audible
  en 1-3 kHz. Sin cola larga (decay ~0.5 s).
- `snare`: tono (dos senos ~185 y ~330 Hz) + ruido con espectro `dc.noise_spec(..., dc.resp_bp(...))`.
  `gate > 0` = cola de **gated reverb de los 80**: ruido brillante que se corta EN SECO tras `gate`
  segundos (clave del sonido DM/Ultravox). Sin `gate` = snare seco.
- `hat`: ruido en banda alta; `open=True` más largo. Muy limpio, sin energía < 5 kHz.
- `clap`: 3-4 ráfagas de ruido separadas por `spread` segundos.
- `metal`: FM inarmónica (dos pares con ratios NO enteros) + bitcrush (retención de muestras
  `crush_hz` + cuantización a `crush_levels`) **antes** del filtro, filtrada en banda, saturada.
  Es el golpe industrial que da el toque sucio del disco.
- `sweep`: ruido de subida (riser) con barrido de filtro `f_start -> f_end` y trémolo;
  `up=True` sube de brillo, `up=False` baja (barrido descendente). Debe acabar a cero (no click).
- `impact`: bombo grave largo con armónicos (sub 30-40 Hz + golpe seco) para marcar secciones.
- `rev_cymbal`: plato invertido: ruido que CRECE hasta el final y se corta (envolvente invertida).

## 2. `voices_synths.py` — voces afinadas (todas devuelven mono `(n,)`)

```python
def bass(f, n, sr=dc.SR, glide=0.0, wave="saw", sub=0.5, fc_env=(90.0, 2600.0), fc_tau=0.22,
         res=3.2, drive=2.4, acc=0.0): ...
def pad(freqs, n, sr=dc.SR, detune=7.0, cutoff=2400.0, res=0.9, attack=0.7, release=1.4,
        width=6.0, seed=101): ...
def strings(freqs, n, sr=dc.SR, attack=0.02, release=0.5, detune=9.0, drive=2.0,
            cutoff=4200.0): ...
def choir(freqs, n, sr=dc.SR, vowel="ah", attack=0.25, release=0.9, vib_hz=4.8,
          vib_depth=0.006, breath=0.15, seed=201): ...
def lead(f, n, sr=dc.SR, glide=0.0, vibrato=0.004, vib_hz=5.2, drive=2.6, wah=(0.4, 2.8),
         cutoff=3400.0): ...
def pluck(f, n, sr=dc.SR, decay=0.45, cutoff=2200.0, drive=1.4, seed=301): ...
```

- `f` = Hz (escalar o array por muestra), `freqs` = lista de Hz (acorde). `glide` en segundos
  (portamento desde la nota previa: usar `dc.osc` con array de frecuencia).
- `bass`: mono, con `sub` (seno una octava abajo) y **filtro con envolvente** `fc_env=(fc_inicio,
  fc_fin)` con constante `fc_tau` usando `dc.svf` (barrido por muestra). `acc` = acento (0..1) que
  abre el filtro. Debe sonar en 60-100 Hz con armónicos hasta ~2,5 kHz tras el filtro.
- `pad`: acorde sostenido, 2-3 sierras por nota desafinadas ±`detune` cents, `attack`/`release`
  suaves (`dc.env_sustain`), filtro `cutoff`, y pequeño `width` (Haas/desafinado) para
  esterilizarlo después. **Pasa-alto a 110 Hz obligatorio** (que no se coma al bajo).
- `strings`: acorde corto y agresivo (ataque 20 ms), saturado: los stabs de cuerda de DM.
- `choir`: **síntesis por formantes** ("ahh"/"ooh"): fuente glotal (pulso con armónicos ricos) +
  3 resonancias formánticas (F1/F2/F3) aplicadas con `dc.fft_shape`/`dc.resp_bp`, vibrato y algo de
  aire (`breath` = ruido suave). Acorde vocal sin palabras: es el coro del disco. Valores de
  formantes: 'ah' ≈ 800/1150/2900 Hz, 'ooh' ≈ 300/870/2240 Hz. Filtra DC y pasa-alto a 120 Hz.
- `lead`: línea solista oscura y saturada, con vibrato, filtro abierto con `wah=(velocidad, prof.)
  = (LFO Hz, profundidad en octavas)`. Debe cortar la mezcla: pico alrededor de 1,0-1,4.
- `pluck`: nota corta percusiva (arpegio), `decay` corto, filtro `cutoff`, ligera saturación.

## 3. `mix_master.py` — reverb, delay, dinámica y escritura

```python
def make_ir(sr=dc.SR, dur=2.8, decay=3.4, predelay=0.02, damp=5200.0, seed=7, width=0.9): ...
    # -> (2, N) IR estereo descorrelacionada: reflexiones tempranas discretas + cola de ruido
    #    con caida exponencial y perdida de agudos (damp). Sin DC.
def convolve_fft(x, ir, sr=dc.SR, block_s=20.0): ...
    # x: (n,) mono o (2,n); ir: (2,N) o (N,) -> (2, n). OVERLAP-ADD por bloques para no
    #    reventar la memoria en 3 minutos (7,8 M muestras). Normaliza la IR internamente.
def pingpong(mono, time_s=0.406, feedback=0.42, mix=0.35, damp=3800.0, taps=6, sr=dc.SR): ...
    # delay con rebote L/R desde una voz mono -> (2, n) (lo que se SUMA al bus seco)
def bus_glue(st, thresh_db=-16.0, ratio=2.0, attack=0.02, release=0.18, makeup_db=0.0, sr=dc.SR): ...
    # compresor de bus VECTORIZADO: envolvente por bloques (RMS cada ~128 muestras) + np.interp
    #    para subirla a la frecuencia de muestreo. PROHIBIDO bucle por muestra.
def limiter(st, ceiling_db=-1.0, lookahead_ms=3.0, release=0.12, sr=dc.SR): ...
    # limitador de pico con lookahead vectorizado (maximo por bloque + suavizado) -> techo garantizado
def stereo_width(st, amount=0.0, sr=dc.SR): ...
    # mid/side, amount -1..+1 (menos = mas mono; el bajo debe quedar mono)
def measure(st, sr=dc.SR): ...
    # -> dict con claves EXACTAS:
    #    'peak_db','rms_db','crest_db','rms_l_db','rms_r_db','dc_l','dc_r','corr','clip_samples'
def write_song(path, st, sr=dc.SR): ...
    # envuelve dc.write_wav16 y devuelve su dict de metricas
```

`measure` calcula: pico global en dBFS, RMS global, crest = pico/RMS en dB, RMS de cada canal,
DC de cada canal en milésimas (mL), correlación L/R, y número de muestras ≥ 0.99999 (clipping).

## 4. `verify_song.py` — verificación independiente (uso: `python verify_song.py <wav>`)

Debe funcionar con CUALQUIER WAV (no solo con la canción) y SIN importar los otros módulos de audio
(solo `wave`, `numpy`, `PIL`, y `song_data` para la tabla por secciones si está disponible).
Salida por stdout, en este orden:

1. Cabecera: canales, bits, sample rate, frames, duración, bytes.
2. Niveles: pico L/R, RMS L/R, crest, DC L/R, muestras clipeadas, correlación estéreo.
3. Curva de energía por tramos de 5 s (tabla `t_inicio  RMS_dB`) y detección de silencio
   inicial/final (>1 s por debajo de -60 dBFS).
4. Centro espectral y pico espectral cada 10 s (ventana 8192 con Hann) → demuestra que la mezcla
   cambia de color con los arreglos.
5. Tabla por secciones usando `song_data.SECTIONS` (compás → segundos con `song_data.BAR`):
   `seccion  t_inicio  t_fin  RMS_dB  pico_dB`.
6. Figura PNG junto al WAV (`<wav>_analisis.png`): (a) espectrograma 0-16 kHz de la canción
   completa, (b) envolvente RMS en dB con líneas verticales y nombre de cada sección, (c) forma de
   onda. Escala de dB **real** (elige DB_MIN/DB_MAX de los datos, no estires la escala).
7. Imprime `VERIFY OK` al final, y termina con `sys.exit(0)`.

Prueba obligatoria antes de entregar: ejecutarlo contra el sample ya existente
`C:\Users\carlos\industrial-synth\industrial_stab_E2_01.wav` (2,40 s, 44.100 Hz, 2 ch, −1,00 dBFS,
0 clipeadas) y comprobar que los números cuadran con su cabecera; además contra una señal sintética
de 30 s que genere el propio script para probar el caso largo (y borrarla al acabar).

---

## 5. `render_song.py` (lo escribe el agente principal — NO tocar)

Es el único que conoce `song_data.py` + los tres módulos anteriores y monta la canción. Reparto
previsto: batería/percusión → `voices_drums`, voces afinadas → `voices_synths`, reverb/delay/bus →
`mix_master`, y la figura final → `verify_song`. Los niveles por pista del master los fija ese
fichero; los módulos solo deben devolver material **predecible** (pico ~0,5-1,2) y sin sorpresas.
