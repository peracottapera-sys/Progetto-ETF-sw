FROM node:20-slim

# Installa dipendenze di sistema necessarie per better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia tutto il progetto
COPY . .

# Build frontend
RUN cd etf-app && npm install && npm run build

# Installa dipendenze backend e ricompila i moduli nativi per Linux
RUN cd etf-server && npm install && npm rebuild better-sqlite3

# Esponi la porta
EXPOSE 3001

# Avvia il server
CMD ["node", "etf-server/server.js"]
