import { RelayHttpError } from "./types";

export function limitRequestBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): ReadableStream<Uint8Array> | undefined {
  if (!body) return undefined;
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(
            new RelayHttpError(
              413,
              `Relay request exceeds the ${maxBytes}-byte limit.`,
              "request_too_large",
            ),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

export function limitResponseBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("relay response exceeded size limit");
        controller.error(new Error("Relay response exceeded size limit."));
        return;
      }
      controller.enqueue(chunk.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function readBytesLimited(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!body) {
    throw new RelayHttpError(400, "Request body is required.", "body_required");
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new RelayHttpError(
          413,
          `Relay request exceeds the ${maxBytes}-byte limit.`,
          "request_too_large",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel("request body rejected").catch(() => undefined);
    throw error;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function readJsonLimited<T>(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<T> {
  const bytes = await readBytesLimited(body, maxBytes);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    throw new RelayHttpError(400, "Invalid JSON body.", "invalid_json");
  }
}

export async function readResponseJsonLimited<T>(
  response: Response,
  maxBytes: number,
): Promise<T> {
  return readJsonLimited<T>(response.body, maxBytes);
}
