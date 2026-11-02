# Spike B — sign, stamp and verify a miuzika export (measured 2-Nov-2026)

Goal from the handoff (`fable.md` §6.3): take a WAV exported by miuzika, embed a signed
C2PA manifest with a consent assertion and a lineage record, timestamp its hash with
OpenTimestamps, verify both, and record what survives re-encoding. Done on the laptop,
no GPU, with the `stahl` project's `salida/stahl_sint.wav` (2:20, 24-bit 44.1 kHz stereo,
37.2 MB).

## Setup

```
# once: tools
winget install Gyan.FFmpeg                      # ffmpeg 9.0.2 (re-encoding tests)
# audiowmark: no Windows build; in WSL Ubuntu: apt install build-essential autoconf automake
#   libtool pkg-config libfftw3-dev libsndfile1-dev libgcrypt20-dev libzita-resampler-dev
#   libmpg123-dev; git clone github.com/swesterfeld/audiowmark; ./autogen.sh && make
# c2patool 0.27.22 (c2pa-rs 0.90.22): zip from github.com/contentauth/c2pa-rs/releases,
# filter "c2patool", x86_64-pc-windows-msvc, copy c2patool.exe to ~/.local/bin
cd autoria/spike-b && npm install               # opentimestamps 0.4.9 (LGPL)
bash make-keys.sh "Your Name"                   # keys in ~/.miuzika/autoria (outside git)

# use
node sign.ts sign   stahl stahl_sint.wav [--ai-assisted] [--allow-training]
node sign.ts verify ../../workspace/proyectos/stahl/salida/stahl_sint.signed.wav
node sign.ts upgrade ../../workspace/proyectos/stahl/salida/stahl_sint.signed.wav.ots   # hours later
```

`sign` writes next to the input: `<name>.signed.wav` (embedded manifest), `.c2pa`
(sidecar, same claim), `.ots` (timestamp proof) and `.provenance.json` (summary).

The Python `opentimestamps-client` (0.8.0) does not start on Windows: `python-bitcoinlib`
calls `ctypes.CDLL(None)` when it cannot find libssl. The npm client works; that is one
more reason the layer runs in Node.

## What was measured

| | result |
|---|---|
| Sign 37.2 MB WAV with `c2patool` (ES256, DigiCert TSA) | 0.65 s |
| Manifest size, embedded | 13.8 KB with the minimal lineage, 15.8 KB with the full one (0.04 % of file) |
| Decoded PCM, original vs signed (`ffmpeg -f md5`) | identical: `2b710e5b…8928` both |
| Signed file still a valid WAV (`ffprobe`) | yes, same duration and format |
| OpenTimestamps stamp (4 calendars: alice, bob, finney, catallaxy) | 1.8 s, proof 840 bytes, pending Bitcoin attestation |
| `verify` with our CA as trust anchor | `signingCredential.trusted`, `claimSignature.validated`, `assertion.dataHash.match`, `timeStamp.validated` |
| `verify` without the CA | same, but `signingCredential.untrusted` (what any third-party verifier will show until a CAI-recognised CA is used) |
| Flip one byte of audio in a copy | C2PA: `assertion.dataHash.mismatch`. OTS: hash mismatch. Both catch it |
| Self-signed end-entity certificate | **rejected** by c2patool ("the certificate is invalid"). A two-level chain (local CA → artist) is accepted. `make-keys.sh` does that |
| Absolute Windows paths for `--trust_anchors` | rejected ("URL scheme is not allowed": `C:` is read as a scheme). Relative path works; `sign.ts` runs c2patool from the key folder |

## What survives re-encoding (ffmpeg 9.0.2)

| step | manifest after |
|---|---|
| signed.wav → wav, `-c:a copy -map_metadata 0` | **stripped** ("No claim found") |
| signed.wav → mp3 192k, `-map_metadata 0` | **stripped** |
| mp3 signed directly by c2patool (ID3v2 GEOB) | present, all validations pass |
| signed.mp3 → flac, `-map_metadata 0` | **stripped** |
| flac signed directly by c2patool | present, all validations pass |
| signed.mp3 → mp3, `-c:a copy -map_metadata 0` | **stripped** (ffmpeg does not carry GEOB frames) |
| signed.flac → flac, `-c:a copy -map_metadata 0` | **stripped** |
| sidecar `.c2pa` checked against the re-encoded mp3 | `assertion.dataHash.mismatch` (expected: the bytes changed) |

Conclusion: the embedded manifest survives nothing that touches the container, not even
a lossless stream copy. So each delivered format (WAV, MP3, FLAC) must be signed on its
own, the sidecar and the `.ots` proof travel with the file, and the only thing that can
follow the *sound* through re-encoding is a watermark. That is the research track.

## audiowmark 0.6.5 (GPLv3 baseline watermark), measured 2-Nov-2026 in WSL

No Windows build exists and Ubuntu 26.04 has no package; built from source in WSL
(`~/src/audiowmark/src/audiowmark`, deps via apt: fftw3, sndfile, gcrypt, zita-resampler,
mpg123). Test signal: a mix of the 10 `stahl` stems (`amix`, peak −12 dBFS, RMS −27.8,
2:35, 16-bit) and the `stahl_sint` stem alone. Message: 128 bits, default key, default
strength 10. Reading rule: `audiowmark get` prints the **best** match first and then weak
candidates; read the first line (an earlier pass of this spike read the last line with
`tail` and wrongly recorded failures).

| | result |
|---|---|
| `add` on the 2:35 mix | 2.9 s |
| Watermark level vs source | difference peak −37.9 dBFS, RMS −58.9 dBFS; **SNR 31.1 dB**. Not listened to: Carlos has to judge audibility |
| `get` on the marked WAV | OK, score 1.41 (unmarked source: best candidate 0.14, wrong message) |
| Watermark then C2PA sign | OK, 1.41; the manifest chunk does not disturb detection |
| C2PA sign then watermark | OK too, but the signature no longer matches the audio: always **watermark first, sign last** |
| Quiet synth stem alone (band 1.5–5 kHz at −35 dBFS RMS) | OK, 1.36 |
| Clipped mix (peak 0 dBFS, flat factor 0.95) | OK, 1.39; also after MP3 128k, 1.33 |

Survives (score ≥ 1.19 ≫ noise floor 0.14): MP3 320/128/64k, Opus 96k, AAC 128k (after
decoding to WAV: audiowmark does not open `.m4a`), FLAC, cuts of 30 s / 10 s / 5 s,
resample to 48 kHz + MP3, mono fold + MP3, −12 dB gain, loudnorm to −14 LUFS, low-pass 8
kHz and 4 kHz, EQ ±6 dB, 4:1 compression, echo/reverb, and a remix with an unmarked stem
added at 0 dB. Weaker but detected: white noise at −30 dBFS (0.52), reverb (0.83).

Does **not** survive: speed +4 % (pitch and tempo together, `asetrate`), even with
`--detect-speed`; tempo +8 % at constant pitch (rubberband); pitch +1 semitone at
constant tempo (rubberband). Best candidates there are noise (0.14–0.16, wrong message).

So audiowmark is a sound day-one baseline for "did this file come from miuzika"
against codecs, cuts and mixing, and it is defeated by any time or pitch change, which
is exactly what a cover, a remix at another tempo or a DJ set does. That is the gap the
research track (music-specific watermark, SoK attack pipeline) has to measure and close.

## Honest limits

- `timeStamp.untrusted` appears next to `timeStamp.validated`: the DigiCert TSA chain is
  not in c2patool's default trust list; the time is validated but its authority is not
  trusted. To be read before claiming "trusted time".
- The OTS proof is **pending** until a calendar commits to Bitcoin (typically hours).
  `upgrade` fetches the attestation; until then the proof says only "four calendars saw
  this hash at this moment".
- `org.miuzika.lineage` is our label; nobody else reads it yet. It is JSON inside the
  manifest, hashed and signed with the rest.
- The lineage lists the stems in `proyecto.json` at signing time. It does not prove they
  are the only sources of the audio.
- Nothing here was *listened to*. The PCM is byte-identical to the input, so there is
  nothing new to hear; the input itself is on Carlos's list of pending checks.
