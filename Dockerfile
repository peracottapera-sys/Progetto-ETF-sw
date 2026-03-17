FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

# Build frontend (CRA produce la cartella 'build')
RUN cd etf-app && npm install && CI=false npm run build

# Rinomina 'build' in 'dist' per compatibilità con server.js
RUN mv etf-app/build etf-app/dist

# Installa dipendenze backend
RUN cd etf-server && npm install

EXPOSE 8080

CMD ["sh", "-c", "echo PG_URL=$PG_URL && echo DATABASE_URL=$DATABASE_URL && node etf-server/server.js"]
