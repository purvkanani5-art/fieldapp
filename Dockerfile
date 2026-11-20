# Kshetralekha live server: FastAPI app + its web pages, one process, data in /data.
# The database is copied continuously to Azure Blob storage by Litestream and restored on start, because the disk of an
# Azure Container Apps replica is temporary. Photos and documents go to SharePoint (KL_STORAGE=sharepoint).
FROM python:3.12-slim

ARG LITESTREAM_VERSION=0.3.13
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tesseract-ocr \
 && curl -fsSL -o /tmp/litestream.deb "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.deb" \
 && dpkg -i /tmp/litestream.deb \
 && rm -f /tmp/litestream.deb \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY frontend frontend
COPY deploy/litestream.yml /etc/litestream.yml
COPY deploy/start.sh /start.sh
RUN chmod +x /start.sh && useradd --create-home --uid 10001 kl && mkdir -p /data && chown kl /data

ENV KL_DATA_DIR=/data \
    KL_DEMO=0 \
    PYTHONUNBUFFERED=1 \
    PORT=8000
USER kl
EXPOSE 8000
CMD ["/start.sh"]
