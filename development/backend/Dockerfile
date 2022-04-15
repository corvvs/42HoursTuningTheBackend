FROM node:12-alpine
WORKDIR /backend
COPY src/ ./src
COPY package.json package-lock.json ./
RUN npm i compression

RUN mkdir file
RUN mkdir file/static
RUN npm ci
ENV NODE_ENV=production

ENTRYPOINT ["node", "src/index.js"]
