#!/usr/bin/env bash
# Makes the artist's signing key for Spike B, outside git, in ~/.miuzika/autoria (or
# $MIUZIKA_AUTORIA_DIR). Idempotent: it refuses to overwrite an existing key.
#
# Why a tiny local CA and not a self-signed certificate: c2patool 0.27.22 rejects a
# self-signed end-entity certificate with "the certificate is invalid" (measured 2-Nov-2026)
# and accepts a two-level chain (local CA -> artist). Verifiers that do not know the CA show
# "signingCredential.untrusted"; passing ca.pem as a trust anchor shows "trusted". A
# CAI-recognised CA is a later decision (CONCEPT.md, open question 5).
#
# Certificate profile (C2PA): v3, CA:FALSE, keyUsage digitalSignature, EKU emailProtection.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # git bash would turn "/CN=..." into a Windows path

DIR="${MIUZIKA_AUTORIA_DIR:-$HOME/.miuzika/autoria}"
NAME="${1:-Artist (miuzika)}"
mkdir -p "$DIR"
cd "$DIR"

if [ -f artist.key ]; then
  echo "artist.key already exists in $DIR; not overwriting." >&2
  exit 1
fi

cat > ca.cnf <<'EOF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca
[dn]
CN = miuzika local authorship CA
O = miuzika
C = ES
[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign, digitalSignature
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
EOF

cat > ee.cnf <<'EOF'
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, nonRepudiation
extendedKeyUsage = critical, emailProtection
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
EOF

openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -new -x509 -key ca.key -days 3650 -config ca.cnf -out ca.pem
openssl ecparam -name prime256v1 -genkey -noout -out artist.key
openssl req -new -key artist.key -subj "/CN=$NAME/O=miuzika/C=ES" -out artist.csr
openssl x509 -req -in artist.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 1095 -extfile ee.cnf -out artist-ee.pem
cat artist-ee.pem ca.pem > artist-chain.pem
openssl verify -CAfile ca.pem artist-ee.pem
rm -f artist.csr
chmod 600 artist.key ca.key 2>/dev/null || true

echo "keys in $DIR:"
ls -1 "$DIR"
echo "fingerprint (artist): $(openssl x509 -in artist-ee.pem -noout -fingerprint -sha256 | cut -d= -f2)"
