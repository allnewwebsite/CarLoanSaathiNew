import zlib from "zlib";

const DEFAULT_THRESHOLD_BYTES = 1024;
const COMPRESSIBLE_TYPES = [
  "application/json",
  "application/javascript",
  "application/xml",
  "image/svg+xml",
  "text/",
];

function envFlag(name, defaultValue = true) {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  return String(raw).toLowerCase() === "true";
}

function acceptsGzip(req) {
  return String(req.headers["accept-encoding"] || "").includes("gzip");
}

function isCompressibleContentType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  return COMPRESSIBLE_TYPES.some((type) => normalized.includes(type));
}

function shouldSkipRequest(req, res) {
  if (!envFlag("ENABLE_GZIP_COMPRESSION", true)) return true;
  if (req.method === "HEAD") return true;
  if (!acceptsGzip(req)) return true;
  if (req.path.startsWith("/api/realtime")) return true;
  if (res.getHeader("Content-Encoding")) return true;
  return false;
}

function appendChunk(chunks, chunk, encoding) {
  if (!chunk) return;
  const bufferEncoding = typeof encoding === "string" ? encoding : undefined;
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, bufferEncoding));
}

export function gzipCompression() {
  const thresholdBytes = Math.max(
    0,
    Number.parseInt(process.env.GZIP_COMPRESSION_THRESHOLD_BYTES || `${DEFAULT_THRESHOLD_BYTES}`, 10)
      || DEFAULT_THRESHOLD_BYTES,
  );

  return function gzipCompressionMiddleware(req, res, next) {
    if (shouldSkipRequest(req, res)) {
      next();
      return;
    }

    const chunks = [];
    const originalEnd = res.end.bind(res);

    res.write = (chunk, encoding, callback) => {
      appendChunk(chunks, chunk, encoding);
      const writeCallback = typeof encoding === "function" ? encoding : callback;
      if (typeof writeCallback === "function") writeCallback();
      return true;
    };

    res.end = (chunk, encoding, callback) => {
      appendChunk(chunks, chunk, encoding);
      const endCallback = typeof encoding === "function" ? encoding : callback;

      const statusCode = res.statusCode;
      const body = chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
      const contentType = res.getHeader("Content-Type");
      const shouldCompress = statusCode !== 204
        && statusCode !== 304
        && body.length >= thresholdBytes
        && isCompressibleContentType(contentType)
        && !res.getHeader("Content-Encoding")
        && !res.headersSent;

      if (!shouldCompress) {
        return originalEnd(body, typeof encoding === "string" ? encoding : undefined, endCallback);
      }

      zlib.gzip(body, { level: zlib.constants.Z_BEST_SPEED }, (error, compressedBody) => {
        if (error) {
          originalEnd(body, typeof encoding === "string" ? encoding : undefined, endCallback);
          return;
        }

        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Vary", "Accept-Encoding");
        res.removeHeader("Content-Length");
        originalEnd(compressedBody, undefined, endCallback);
      });

      return res;
    };

    next();
  };
}
