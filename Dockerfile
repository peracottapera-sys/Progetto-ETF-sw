FROM node:20-slim
 
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
 
WORKDIR /app
 
COPY . .
 
# Verifica struttura
RUN ls -la && ls -la etf-app/
 
# Build frontend con output esplicito
RUN cd etf-app && npm install && npm run build && ls -la dist/
 
# Installa dipendenze backend
RUN cd etf-server && npm install && npm rebuild better-sqlite3
 
EXPOSE 3001
 
CMD ["node", "etf-server/server.js"]
 
