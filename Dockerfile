FROM node:20-slim

WORKDIR /app

# Copia tutto il progetto
COPY . .

# Build frontend
RUN cd etf-app && npm install && npm run build

# Installa dipendenze backend
RUN cd etf-server && npm install

# Esponi la porta
EXPOSE 3001

# Avvia il server
CMD ["node", "etf-server/server.js"]
