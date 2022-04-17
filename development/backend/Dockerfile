FROM node:12-alpine
WORKDIR /backend
COPY src/ ./src
COPY package.json package-lock.json ./

RUN mkdir file
RUN mkdir file/static
RUN npm ci
RUN npm i fastify
ENV NODE_ENV=production

ENTRYPOINT ["node", "src/index.js"]
