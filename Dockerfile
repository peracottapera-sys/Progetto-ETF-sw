FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

# Build frontend (CRA produce la cartella 'build')
RUN cd etf-server && npm install
```

**3. Push:**
```
git add .
git commit -m "migrate: SQLite → PostgreSQL"
git push origin main

# Rinomina 'build' in 'dist' per compatibilità con server.js
RUN mv etf-app/build etf-app/dist

# Installa dipendenze backend
RUN cd etf-server && npm install && npm rebuild better-sqlite3

EXPOSE 8080

CMD ["node", "etf-server/server.js"]

