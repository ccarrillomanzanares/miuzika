import os, sys

base = os.getcwd()
print("CWD:", base)
for raiz in ("salida", os.path.join("proyectos", "stahl", "salida")):
    p = os.path.join(base, raiz)
    print("\n==", raiz, "->", p, "existe:", os.path.isdir(p))
    if os.path.isdir(p):
        for f in sorted(os.listdir(p)):
            fp = os.path.join(p, f)
            if os.path.isfile(fp):
                print("   %-45s %10d B" % (f, os.path.getsize(fp)))
