FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

# Build frontend
RUN cd etf-app && npm install && npm run build

# Verifica che dist esista
RUN ls -la etf-app/dist || echo "DIST NON TROVATO"

# Installa dipendenze backend e ricompila i moduli nativi per Linux
RUN cd etf-server && npm install && npm rebuild better-sqlite3

EXPOSE 3001

CMD ["node", "etf-server/server.js"]
