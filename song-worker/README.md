# Song worker

Renderer Python **disk-backed** para canciones completas. Es la ruta que usa el
agente de canción; no es un sintetizador en tiempo real.

## Composición

- `template/song_data.py`: plantilla **neutra** de 8 compases. Solo muestra el
  contrato; no contiene la composición de Filament.
- `examples/filament_song_data.py`: ejemplo completo de 140 compases, fuera del
  workspace del agente.
- El agente escribe `song_data.py` en un workspace y ejecuta el renderer.

## Render

```bash
python render_song.py --bars 1 8 --out out   # prueba corta
python render_song.py --out out              # canción completa
python bundle.py --out out                   # .miuzika.zip (master + MIDI)
```

El renderer necesita `MIUZIKA_RENDERED` apuntando a `../rendered` (lo pone el
workspace automáticamente). Salida:

```text
out/
  <titulo>.wav          master
  render.json           manifiesto del render
  stems/*.wav           stems (si el render es completo)
  midi/*.mid            pistas MIDI + multitrack + guía
  <titulo>.miuzika.zip  bundle para abrir en la GUI
```

## Memoria

La restricción es real: 140 compases × 15 pistas estéreo en `float64` son ~3,6 GB,
y el portátil tiene ~1,8 GB libres. Por eso:

- cada pista se escribe a disco por trozos de 30 s;
- la mezcla se reconstruye leyendo los stems;
- la reverb usa overlap-add;
- solo hay una matriz de mezcla `(2, n)` en RAM (~255 MB);
- la caché de voces evita repetir síntesis.

No cargues los stems completos en el navegador ni los devuelvas por JSON/base64.
La GUI importa el **master + MIDI**; los stems quedan para descarga.

## Dependencias

Python 3.12, `numpy` y `mido`. No se usa scipy. `rendered/` contiene
`dsp_core.py`, `voices_drums.py`, `voices_synths.py`, `voices_extras.py`,
`mix_master.py` y `midi_export.py`.
