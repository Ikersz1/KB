# Imagen oficial con browsers Playwright 1.49 ya preinstalados
FROM mcr.microsoft.com/playwright/python:v1.49.0-jammy

WORKDIR /app

# Instalar dependencias Python
COPY services/requirements.txt /app/services/requirements.txt
RUN pip install --no-cache-dir -r /app/services/requirements.txt

# (Opcional) reafirma que chromium está instalado (ya viene en la base)
RUN playwright install --with-deps chromium

# Copia el código
COPY . /app

ENV PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 10000

# Arranque del servicio FastAPI (usa $PORT de Render)
CMD ["bash","-lc","python -m uvicorn services.crawl4ai_service:app --host 0.0.0.0 --port ${PORT:-10000}"]
