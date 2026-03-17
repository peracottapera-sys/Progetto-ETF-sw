FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN cd etf-app && npm install && CI=false npm run build
RUN mv etf-app/build etf-app/dist
RUN cd etf-server && npm install

ENV PG_URL=postgresql://postgres:JZKhCmNKgtZZfdDfQSPmgwORwBgxuAHO@crossover.proxy.rlwy.net:20706/railway

EXPOSE 8080

CMD ["node", "etf-server/server.js"]
