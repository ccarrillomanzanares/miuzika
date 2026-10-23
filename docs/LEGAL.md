# LEGAL — notas de trabajo (BORRADOR)

> **Aviso.** Esto es un registro técnico de decisiones y su encaje legal, **no asesoría
> jurídica**. Antes de comercializar cualquier servicio hay que revisarlo con un abogado de
> propiedad intelectual. Lo que sí es firme: qué datos entran y qué actos se hacen, porque
> eso lo decidimos nosotros y queda registrado aquí.

Última revisión: 2026-10-23.

---

## 1. Licencia del proyecto

Miuzika se distribuye bajo **MIT**. Obliga a incluir el aviso de copyright y el texto de la
licencia en las copias o partes sustanciales del software. En la práctica:

- `LICENSE` en la raíz, sin modificar.
- Los ficheros derivados de terceros conservan su aviso (ver §6).
- Un `CREDITS.md` con la atribución de modelos, datasets y samples (pendiente de crear).

## 2. Qué no es obra: ideas, métodos y estilos

Este es el punto que más se repite y el que más se malinterpreta. **Las ideas, los
procedimientos, los métodos y los sistemas no son objeto de derecho de autor**: lo protegido
es la *expresión*, no el contenido abstracto.

Referencias correctas:

- **TRLPI art. 1**: protege «las creaciones originales literarias, artísticas o científicas
  expresadas por cualquier medio o soporte». Lo que no está *expresado* no está protegido.
- **TRLPI art. 96.1** (programas de ordenador): «No serán objeto de protección las ideas y
  principios en los que se basan cualesquiera de los elementos de un programa de ordenador,
  incluidos los que sirven de fundamento a sus interfaces.»
- **ADPIC/TRIPS art. 9.2**: «la protección del derecho de autor se extenderá a las
  expresiones, no a las ideas, procedimientos, métodos de operación o conceptos matemáticos».
- **Convenio de Berna art. 2.8**: la protección no se extiende a las noticias del día ni a
  los hechos diversos.

> **Corrección de una afirmación anterior.** En una conversación previa se citó el art. 13
> TRLPI como el que excluye las ideas. **Es incorrecto**: el art. 13 TRLPI se refiere a las
> disposiciones legales, resoluciones judiciales y actos de organismos públicos. La exclusión
> de ideas está en las referencias del párrafo anterior. Queda corregido aquí para que no se
> propague a ningún texto público.

### Consecuencias prácticas para Miuzika

Son **conocimiento técnico libre** y podemos usarlos sin licencia:

- Medidas de una mezcla: crest factor, LUFS, RMS, correlación estéreo, balance espectral,
  ancho de banda, predelay de reverb, tiempo de ataque de un compresor.
- Reglas de producción: «grave centrado», «20 ms de predelay», «crest 12-14 dB».
- Estilos y géneros: «rock industrial de los 90», «capas que se acumulan».
- Algoritmos: filtros, envolventes, síntesis, separación de fuentes como *técnica*.

## 3. Qué sí está protegido (y por tanto condiciona el uso)

| Objeto | Qué protege | Consecuencia |
|---|---|---|
| Obra musical (composición) | melodía, armonía, letra | Escribir «en estilo» es libre; copiar la melodía no |
| **Fonograma** (la grabación) | el audio concreto de un disco | Muestrear, separar en stems o reentrenar con él es reproducir/transformar (arts. 18 y 20 TRLPI) |
| Muestra/sample de una librería | según su licencia | Sólo se usa si su licencia lo permite para uso comercial |
| Dataset | licencia propia | Ver §5 |
| Pesos de un modelo | licencia propia | Ver §6 |

**El estilo no está protegido; la grabación que lo demuestra sí.** Por eso medir «cómo suena
*Closer*» exige fabricar copias de *Closer*, y ahí se acaba el camino limpio para un producto
de pago.

## 4. Actos y su encaje

| Acto | Encaje | Decisión para el producto |
|---|---|---|
| Medir nuestro propio render | libre | ✅ |
| Medir una mezcla **CC0/CC-BY** | libre con atribución | ✅ |
| Separar en stems un tema comercial (Demucs) | reproducción + transformación (arts. 18, 20) | ❌ |
| Entrenar con fonogramas comerciales | no amparado por la excepción de minería si hay reserva de derechos (art. 67 bis TRLPI, del art. 4 DSM) | ❌ |
| Entrenar con datasets CC0/CC-BY o con pares generados por nosotros | libre con atribución | ✅ |
| Vender inferencia de un modelo entrenado así | libre | ✅ |

Copia privada (art. 31 TRLPI): no cubre un uso comercial ni la explotación del resultado.

## 5. Fuentes de datos: admitidas y vetadas

Admitidas para el producto:

| Fuente | Licencia | Uso |
|---|---|---|
| VSCO 2 Community Edition | CC0 | instrumentos para pares MIDI→audio |
| Salamander Grand Piano | CC-BY 3.0 | ídem (atribución) |
| NSynth | CC-BY 4.0 | entrenamiento de timbres |
| Jamendo / Free Music Archive (subconjunto CC) | por pista: CC0/CC-BY | mezclas de referencia |
| MIDI de dominio público / CC | según fichero | partituras para generar pares |

Vetadas para el producto:

| Fuente | Motivo |
|---|---|
| Fonogramas comerciales (cualquier disco) | §3 y §4 |
| MUSDB18 / MUSDB18-HQ | licencia de investigación; no comercial |
| Mixing Secrets multitracks | uso educativo |
| Slakh2100 | dataset CC-BY 4.0, pero su audio viene de librerías de samples con licencias propias: **verificar antes de usar** |
| Cualquier cosa **CC-BY-NC** o **CC-BY-SA** | no comercial / copyleft incompatible con MIT |

## 6. Modelos y sus licencias

| Modelo | Licencia | ¿Comercial? |
|---|---|---|
| DDSP (Magenta) | Apache-2.0 (código) | ✅ el código; los pesos que entrenemos son nuestros |
| Demucs | MIT (código) | ✅ la herramienta; ❌ separar música ajena para el producto |
| CLAP (`laion/larger_clap_music_and_speech`) | **Apache-2.0** (verificado 2026-10-23) | ✅ |
| MusicGen (Meta) | pesos **CC-BY-NC 4.0** | ❌ |
| Stable Audio | licencia de Stability, no abierta | ❌ |

Regla: **antes de meter un modelo en el producto, se anota aquí su licencia y la fecha de
consulta.** Si no está claro, no entra.

## 7. Registro de decisiones

| Fecha | Decisión | Motivo |
|---|---|---|
| 2026-10-23 | No analizar ni entrenar con fonogramas comerciales | §3, §4 |
| 2026-10-23 | El conocimiento de mezcla se extrae de material CC y de nuestros propios renders | §2 |
| 2026-10-23 | No usar MusicGen/Stable Audio en el producto | §6 |
| 2026-10-23 | CLAP admitido: Apache-2.0 verificado | §6 |
| 2026-10-23 | El piloto de puntuación usa **sólo audio propio** (sin fonogramas ajenos) | §3, §4 |

## 8. Pendiente

- [ ] Revisión por abogado de PI antes de cobrar por el servicio Pro.
- [ ] `CREDITS.md` con atribuciones (modelos, datasets, samples).
- [x] Confirmar licencia de CLAP: Apache-2.0.
- [ ] Confirmar licencia de cada modelo que se integre (DDSP: Apache-2.0, comprobar).
- [ ] Revisar si el servicio Pro requiere condiciones de uso y política de datos
      (sube audio del usuario: hay que decir qué se guarda y cuánto tiempo).
