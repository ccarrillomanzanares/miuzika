"""Estructura interna del .sf2 del saxo: chunks y conteos reales."""
import struct

SF2 = 'instrumentos/saxo-tenor-prueba.sf2'
data = open(SF2, 'rb').read()
print('RIFF', data[:4], data[8:12], 'tamano', len(data))

pos = 12
while pos + 8 <= len(data):
    cid = data[pos:pos + 4]
    sz = struct.unpack('<I', data[pos + 4:pos + 8])[0]
    extra = ''
    if cid == b'LIST':
        extra = data[pos + 8:pos + 12].decode('latin1')
    print('chunk', cid, 'size', sz, extra)
    if cid == b'LIST' and extra == 'pdta':
        p = pos + 12
        fin = pos + 8 + sz
        while p + 8 <= fin:
            sid = data[p:p + 4]
            ssz = struct.unpack('<I', data[p + 4:p + 8])[0]
            print('   sub', sid, 'size', ssz, 'registros(38/4/2):',
                  ssz // 38, ssz // 4, ssz // 2)
            p += 8 + ssz + (ssz & 1)
    pos += 8 + sz + (sz & 1)
