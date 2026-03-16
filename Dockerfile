FROM node:20-slim
 
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
 
WORKDIR /app
 
COPY . .
 
# Build frontend — CI=false evita che i warning blocchino la build
RUN cd etf-app && npm install && CI=false npm run build
 
# Installa dipendenze backend
RUN cd etf-server && npm install && npm rebuild better-sqlite3
 
EXPOSE 3001
 
CMD ["node", "etf-server/server.js"]
 
