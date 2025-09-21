FROM python:3.11-slim
RUN apt-get update && apt-get install -y build-essential gcc g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt
COPY src ./src
EXPOSE 8000
ENV PYTHONPATH=/app/src
CMD ["python", "-m", "backend.app_api"]
