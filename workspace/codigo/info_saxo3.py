"""Cuenta zonas reales del .sf2 (ibag) y saca el rango de teclas de cada una."""
import struct

SF2 = 'instrumentos/saxo-tenor-prueba.sf2'
data = open(SF2, 'rb').read()

pos = 12
pdta = None
while pos + 8 <= len(data):
    cid = data[pos:pos + 4]
    sz = struct.unpack('<I', data[pos + 4:pos + 8])[0]
    if cid == b'LIST' and data[pos + 8:pos + 12] == b'pdta':
        pdta = (pos + 12, pos + 8 + sz)
        break
    pos += 8 + sz + (sz & 1)

ini, fin = pdta
p, ch = ini, {}
while p + 8 <= fin:
    cid = data[p:p + 4]
    sz = struct.unpack('<I', data[p + 4:p + 8])[0]
    ch[cid] = data[p + 8:p + 8 + sz]
    p += 8 + sz + (sz & 1)

phdr = ch[b'phdr']; inst = ch[b'inst']; ibag = ch[b'ibag']
igen = ch[b'igen']; shdr = ch[b'shdr']

n_presets = len(phdr) // 38 - 1
n_inst = len(inst) // 22 - 1
n_zonas = len(ibag) // 4 - 1
n_gen = len(igen) // 4
n_samples = len(shdr) // 46 - 1
print('presets:', n_presets, '| instrumentos:', n_inst, '| ZONAS:', n_zonas,
      '| generadores:', n_gen, '| samples:', n_samples)

# rangos de tecla por zona (generador 43 = keyRange)
bags = [struct.unpack('<HH', ibag[i * 4:i * 4 + 4]) for i in range(len(ibag) // 4)]
gens = [struct.unpack('<Hh', igen[i * 4:i * 4 + 4]) for i in range(n_gen)]
rangos = []
for z in range(n_zonas):
    a, b = bags[z][1], bags[z + 1][1]
    lo, hi = 0, 127
    for k in range(a, b):
        op, val = gens[k]
        if op == 43:
            lo, hi = (val >> 8) & 0xFF, val & 0xFF
    rangos.append((lo, hi))
print('zonas con keyRange:', sum(1 for r in rangos if r != (0, 127)))
print('rango global:', min(r[0] for r in rangos), '-', max(r[1] for r in rangos))
print('primeras 6:', rangos[:6])
print('ultimas 3:', rangos[-3:])
