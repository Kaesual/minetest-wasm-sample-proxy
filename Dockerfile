FROM denoland/deno:2.5.3 AS build

WORKDIR /app

COPY package.json .

RUN deno install

FROM denoland/deno:2.5.3 AS runtime

WORKDIR /app

COPY --from=build /app/node_modules /app/node_modules

COPY . .

USER deno

CMD ["deno", "--allow-net", "--allow-env", "src/main.ts"]