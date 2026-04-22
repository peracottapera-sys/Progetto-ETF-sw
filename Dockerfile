FROM node:20-slim
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG CACHEBUST=4
COPY . .
RUN rm -rf etf-app/build etf-app/node_modules
RUN cd etf-app && npm install && CI=false npm run build
RUN cd etf-server && npm install
EXPOSE 8080
CMD ["node", "etf-server/server.js"]
