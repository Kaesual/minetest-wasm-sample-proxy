FROM denoland/deno:2.5.3 AS build

WORKDIR /app

COPY . .

RUN deno install

USER deno

CMD ["deno", "--allow-net", "--allow-env", "src/main.ts"]