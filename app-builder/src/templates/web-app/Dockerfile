FROM denoland/deno:latest
WORKDIR /app
COPY . .
EXPOSE 8000
CMD ["deno", "run", "--allow-net", "--allow-read", "server.ts"]
