FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY api/ ./
COPY tools/ ./tools/

EXPOSE 9000

CMD ["python", "web_ui.py", "--port", "9000", "--host", "0.0.0.0"]
