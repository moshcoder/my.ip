# my.ip on c0mpute Apps (no dependencies: plain node:24 + server.mjs)
FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
COPY bin ./bin
ENV PORT=8080 BIND=0.0.0.0
USER 65534:65534
EXPOSE 8080
CMD ["node", "server.mjs"]
