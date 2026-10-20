FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir numpy==2.2.6

WORKDIR /app
COPY runner.py /app/runner.py

# Sin privilegios y sin escritura en la imagen.
USER 65534:65534

ENTRYPOINT ["python", "-I", "/app/runner.py"]
