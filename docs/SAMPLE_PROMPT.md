# Prompt del Sample Lab

Este documento refleja el prompt actual del Sample Lab.

## System prompt

```text
Eres un compositor y productor de música.
```

Solo contiene el rol creativo. No hay instrucciones de estilo, presets, ejemplos ni reglas
de arreglo.

## Mensaje de usuario

El esquema JSON viaja en el mensaje de usuario como **contrato técnico**; sin él la app no
puede validar la receta ni renderizarla.

```text
Petición: {{prompt}}
Tipo: {{formato}}.
Proyecto: {{bpm}} BPM, {{tonic}} {{mode}}.
Devuelve SOLO un JSON que cumpla exactamente este esquema:
{{schema_minificado}}
No expliques nada: solo el JSON.
```

Si el primer intento falla la validación, se añade el error y se reintenta una vez con
temperatura 0.4. El primer intento usa temperatura 0.8.

### Esquema JSON (formateado para revisión)

```json
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "const": "one_shot"
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 60
        },
        "duration": {
          "type": "number",
          "minimum": 0.05,
          "maximum": 8
        },
        "layers": {
          "minItems": 1,
          "maxItems": 4,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "osc": {
                "type": "string",
                "enum": [
                  "sine",
                  "saw",
                  "square",
                  "triangle",
                  "noise"
                ]
              },
              "freq": {
                "description": "Frecuencia inicial en Hz",
                "type": "number",
                "minimum": 20,
                "maximum": 20000
              },
              "glideTo": {
                "type": "number",
                "minimum": 20,
                "maximum": 20000
              },
              "glide": {
                "type": "number",
                "minimum": 0,
                "maximum": 2
              },
              "detune": {
                "type": "number",
                "minimum": -100,
                "maximum": 100
              },
              "voices": {
                "default": 1,
                "type": "integer",
                "minimum": 1,
                "maximum": 4
              },
              "spread": {
                "description": "Desafinación del unísono en cents",
                "type": "number",
                "minimum": 0,
                "maximum": 100
              },
              "pan": {
                "type": "number",
                "minimum": -1,
                "maximum": 1
              },
              "fm": {
                "description": "FM inarmónica para campanas, plucks metálicos, bajos growl",
                "type": "object",
                "properties": {
                  "ratio": {
                    "default": 1,
                    "description": "Frecuencia del modulador / portadora",
                    "type": "number",
                    "minimum": 0.1,
                    "maximum": 12
                  },
                  "index": {
                    "default": 2,
                    "description": "Profundidad FM (× frecuencia)",
                    "type": "number",
                    "minimum": 0,
                    "maximum": 20
                  },
                  "decay": {
                    "default": 0.2,
                    "description": "Caída del índice FM",
                    "type": "number",
                    "minimum": 0.01,
                    "maximum": 2
                  }
                },
                "required": [
                  "ratio",
                  "index",
                  "decay"
                ],
                "additionalProperties": false
              },
              "filter": {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "lowpass",
                      "highpass",
                      "bandpass"
                    ]
                  },
                  "freq": {
                    "type": "number",
                    "minimum": 20,
                    "maximum": 20000
                  },
                  "q": {
                    "default": 1,
                    "type": "number",
                    "minimum": 0.1,
                    "maximum": 20
                  }
                },
                "required": [
                  "type",
                  "freq",
                  "q"
                ],
                "additionalProperties": false
              },
              "filterEnv": {
                "description": "Envolvente del filtro para kicks, plucks, risers",
                "type": "object",
                "properties": {
                  "amount": {
                    "default": 4000,
                    "description": "Recorrido del cutoff en Hz",
                    "type": "number",
                    "minimum": -12000,
                    "maximum": 12000
                  },
                  "attack": {
                    "default": 0.005,
                    "type": "number",
                    "minimum": 0,
                    "maximum": 2
                  },
                  "decay": {
                    "default": 0.2,
                    "type": "number",
                    "minimum": 0.01,
                    "maximum": 2
                  },
                  "sustain": {
                    "default": 0,
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1
                  }
                },
                "required": [
                  "amount",
                  "attack",
                  "decay",
                  "sustain"
                ],
                "additionalProperties": false
              },
              "env": {
                "type": "object",
                "properties": {
                  "attack": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 2
                  },
                  "decay": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 2
                  },
                  "sustain": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1
                  },
                  "release": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 2
                  }
                },
                "required": [
                  "attack",
                  "decay",
                  "sustain",
                  "release"
                ],
                "additionalProperties": false
              },
              "gain": {
                "default": 0.7,
                "type": "number",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "osc",
              "voices",
              "env",
              "gain"
            ],
            "additionalProperties": false
          }
        },
        "fx": {
          "type": "object",
          "properties": {
            "drive": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "bitcrush": {
              "description": "Cuantización lo-fi; levels bajos = más sucio",
              "type": "object",
              "properties": {
                "levels": {
                  "default": 32,
                  "type": "number",
                  "minimum": 4,
                  "maximum": 256
                }
              },
              "required": [
                "levels"
              ],
              "additionalProperties": false
            },
            "eq": {
              "type": "object",
              "properties": {
                "low": {
                  "type": "number",
                  "minimum": -18,
                  "maximum": 18
                },
                "mid": {
                  "type": "number",
                  "minimum": -18,
                  "maximum": 18
                },
                "high": {
                  "type": "number",
                  "minimum": -18,
                  "maximum": 18
                }
              },
              "required": [
                "low",
                "mid",
                "high"
              ],
              "additionalProperties": false
            },
            "delay": {
              "type": "object",
              "properties": {
                "time": {
                  "type": "number",
                  "minimum": 0.02,
                  "maximum": 1.5
                },
                "feedback": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 0.9
                },
                "wet": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1
                }
              },
              "required": [
                "time",
                "feedback",
                "wet"
              ],
              "additionalProperties": false
            },
            "reverb": {
              "type": "object",
              "properties": {
                "wet": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1
                },
                "decay": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1
                }
              },
              "required": [
                "wet",
                "decay"
              ],
              "additionalProperties": false
            }
          },
          "additionalProperties": false
        },
        "gainDb": {
          "default": 0,
          "type": "number",
          "minimum": -24,
          "maximum": 6
        }
      },
      "required": [
        "kind",
        "name",
        "duration",
        "layers",
        "gainDb"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "const": "loop"
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 60
        },
        "bars": {
          "type": "integer",
          "minimum": 1,
          "maximum": 8
        },
        "bpm": {
          "type": "number",
          "minimum": 40,
          "maximum": 200
        },
        "key": {
          "type": "object",
          "properties": {
            "tonic": {
              "type": "string",
              "minLength": 1,
              "maxLength": 4
            },
            "mode": {
              "type": "string",
              "enum": [
                "major",
                "minor",
                "dorian",
                "phrygian",
                "lydian",
                "mixolydian",
                "harmonicMinor",
                "pentatonicMinor"
              ]
            }
          },
          "required": [
            "tonic",
            "mode"
          ],
          "additionalProperties": false
        },
        "role": {
          "type": "string",
          "enum": [
            "drums",
            "bass",
            "chords",
            "lead",
            "arp",
            "pad"
          ]
        },
        "style": {
          "type": "string",
          "minLength": 1,
          "maxLength": 32
        },
        "density": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "octave": {
          "type": "integer",
          "minimum": 0,
          "maximum": 8
        },
        "chords": {
          "maxItems": 16,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 16
          }
        },
        "energy": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "seed": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "fx": {
          "type": "object",
          "properties": {
            "drive": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "bitcrush": {
              "description": "Cuantización lo-fi; levels bajos = más sucio",
              "type": "object",
              "properties": {
                "levels": {
                  "default": 32,
                  "type": "number",
                  "minimum": 4,
                  "maximum": 256
                }
              },
              "required": [
                "levels"
              ],
              "additionalProperties": false
            },
            "eq": {
              "type": "object",
              "properties": {
                "low": {
                  "type": "number",
                  "minimum": -18,
                  "maximum": 18
                },
                "mid": {
                  "type": "number",
                  "minimum": -18,
                  "maximum": 18
                },
                "high": {
                  "type": "number",
                  "minimum": -18,
                  "maximum": 18
                }
              },
              "required": [
                "low",
                "mid",
                "high"
              ],
              "additionalProperties": false
            },
            "delay": {
              "type": "object",
              "properties": {
                "time": {
                  "type": "number",
                  "minimum": 0.02,
                  "maximum": 1.5
                },
                "feedback": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 0.9
                },
                "wet": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1
                }
              },
              "required": [
                "time",
                "feedback",
                "wet"
              ],
              "additionalProperties": false
            },
            "reverb": {
              "type": "object",
              "properties": {
                "wet": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1
                },
                "decay": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1
                }
              },
              "required": [
                "wet",
                "decay"
              ],
              "additionalProperties": false
            }
          },
          "additionalProperties": false
        },
        "gainDb": {
          "default": 0,
          "type": "number",
          "minimum": -24,
          "maximum": 6
        }
      },
      "required": [
        "kind",
        "name",
        "bars",
        "bpm",
        "key",
        "role",
        "style",
        "gainDb"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "const": "industrial"
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 60
        },
        "duration": {
          "default": 2.4,
          "type": "number",
          "minimum": 0.2,
          "maximum": 8
        },
        "params": {
          "type": "object",
          "properties": {
            "rootHz": {
              "default": 82.41,
              "description": "Frecuencia base en Hz (E2 = 82.41)",
              "type": "number",
              "minimum": 20,
              "maximum": 2000
            },
            "pitchDrop": {
              "default": 12,
              "description": "Caída de tono inicial en semitonos",
              "type": "number",
              "minimum": 0,
              "maximum": 24
            },
            "pitchTau": {
              "default": 0.035,
              "description": "Rapidez de la caída de tono",
              "type": "number",
              "minimum": 0.005,
              "maximum": 1
            },
            "decay": {
              "default": 0.9,
              "description": "Decaimiento del cuerpo",
              "type": "number",
              "minimum": 0.05,
              "maximum": 4
            },
            "drive": {
              "default": 3.4,
              "description": "Saturación tanh",
              "type": "number",
              "minimum": 0,
              "maximum": 10
            },
            "crushHz": {
              "default": 11000,
              "description": "Frecuencia del bitcrush",
              "type": "number",
              "minimum": 200,
              "maximum": 22050
            },
            "crushLevels": {
              "default": 96,
              "description": "Niveles de cuantización",
              "type": "number",
              "minimum": 4,
              "maximum": 1024
            },
            "cutoffStart": {
              "default": 8800,
              "description": "Cutoff inicial del barrido",
              "type": "number",
              "minimum": 200,
              "maximum": 20000
            },
            "cutoffEnd": {
              "default": 190,
              "description": "Cutoff final del barrido",
              "type": "number",
              "minimum": 40,
              "maximum": 8000
            },
            "cutoffTau": {
              "default": 0.55,
              "description": "Velocidad del barrido",
              "type": "number",
              "minimum": 0.02,
              "maximum": 3
            },
            "resonance": {
              "default": 3.6,
              "description": "Resonancia del filtro",
              "type": "number",
              "minimum": 0.5,
              "maximum": 12
            },
            "metalHz": {
              "default": 131,
              "description": "Portadora de la capa metálica",
              "type": "number",
              "minimum": 20,
              "maximum": 2000
            },
            "metalRatio": {
              "default": 1.4142,
              "description": "Ratio FM inarmónico",
              "type": "number",
              "minimum": 0.1,
              "maximum": 8
            },
            "metalIndex": {
              "default": 14,
              "description": "Índice FM inicial",
              "type": "number",
              "minimum": 0,
              "maximum": 30
            },
            "noise": {
              "default": 0.3,
              "description": "Nivel del transitorio de ruido",
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "width": {
              "default": 1,
              "description": "Anchura estéreo (Haas/detune)",
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "delayWet": {
              "default": 0.55,
              "description": "Nivel de la cola espacial",
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "seed": {
              "default": 20261020,
              "description": "Semilla del ruido",
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            }
          },
          "required": [
            "rootHz",
            "pitchDrop",
            "pitchTau",
            "decay",
            "drive",
            "crushHz",
            "crushLevels",
            "cutoffStart",
            "cutoffEnd",
            "cutoffTau",
            "resonance",
            "metalHz",
            "metalRatio",
            "metalIndex",
            "noise",
            "width",
            "delayWet",
            "seed"
          ],
          "additionalProperties": false
        },
        "gainDb": {
          "default": 0,
          "type": "number",
          "minimum": -24,
          "maximum": 6
        }
      },
      "required": [
        "kind",
        "name",
        "duration",
        "gainDb"
      ],
      "additionalProperties": false
    }
  ]
}
```

## Ejemplo real

```text
Petición: crea un wav sample sintetizador industrial
Tipo: one-shot.
Proyecto: 100 BPM, D minor.
```

En la llamada real, `{{schema_minificado}}` es el mismo esquema en una sola línea para
ahorrar tokens.

## Dónde se edita

- Rol: `src/agent/sample-designer.ts` → `SAMPLE_DESIGNER_SYSTEM`
- Contrato: `src/core/sample.ts` → `SampleSpecSchema`
- Mensaje de usuario y reintentos: `src/agent/sample-designer.ts` → `designSample`
- Temperatura: `0.8` primer intento, `0.4` reintento
- `maxTokens`: `2000`
