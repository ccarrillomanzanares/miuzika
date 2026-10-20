FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir numpy==2.2.6

WORKDIR /app
COPY rendered /app/rendered
COPY sandbox/sound/runner.py /app/runner.py
COPY sandbox/sound/render_track.py /app/render_track.py

# Sin privilegios y sin escritura en la imagen.
USER 65534:65534

ENTRYPOINT ["python", "-I"]
CMD ["/app/runner.py"]
