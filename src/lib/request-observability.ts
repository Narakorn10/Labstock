import crypto from "crypto";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

export function getRequestId(request: Request): string {
  const incoming = request.headers.get("x-request-id")?.trim();
  return incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
}

export function withRequestId<T extends Response>(response: T, requestId: string): T {
  response.headers.set("x-request-id", requestId);
  return response;
}

export function logApiEvent(
  event: string,
  details: Record<string, string | number | boolean | null | undefined>,
) {
  console.info(JSON.stringify({ event, ...details }));
}
