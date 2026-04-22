FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public

RUN mkdir -p /app/data /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/app.db

EXPOSE 3000

CMD ["node", "server.js"]
