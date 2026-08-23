FROM golang:1.26-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/crash-collector .

FROM gcr.io/distroless/static-debian13:nonroot

COPY --from=build /out/crash-collector /crash-collector
EXPOSE 8080

ENTRYPOINT ["/crash-collector"]
