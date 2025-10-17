FROM node:lts-alpine as build

WORKDIR /app

COPY package.json .

RUN npm install

FROM denoland/deno:2.5.3 as runtime

WORKDIR /app

COPY --from=build /app/node_modules /app/node_modules

COPY . .

USER deno

CMD ["deno", "--allow-net", "--allow-env", "main.js"]