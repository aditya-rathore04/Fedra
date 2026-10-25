# ─── Stage 1: Build Static Go Binary ─────────────────────────────
FROM golang:1.23-alpine AS builder

WORKDIR /app

COPY go.mod ./
COPY main.go ./

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /tessera-server main.go

# ─── Stage 2: Ultra-Lean Alpine Runtime ───────────────────────────
FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /
COPY --from=builder /tessera-server /tessera-server

RUN mkdir -p /data

EXPOSE 3500

VOLUME ["/data"]

ENTRYPOINT ["/tessera-server"]
