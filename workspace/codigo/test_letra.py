import sys
sys.path.insert(0, 'codigo')
import numpy as np
import cancion as C

for k in ['L1', 'L2', 'L3', 'C1', 'C4', 'L11']:
    print(k, '|', C.LETRA[k])
    print('   ', C.desglosar(C.LETRA[k]))

v = C.silabas_voz()
print('silabas totales:', len(v))
print('primera:', v[0])
print('ultima:', v[-1])
print('fin de la ultima silaba (s):', round(max(s[0] + s[1] for s in v), 2))
print('duracion tema:', round(C.DUR, 2), 's')
