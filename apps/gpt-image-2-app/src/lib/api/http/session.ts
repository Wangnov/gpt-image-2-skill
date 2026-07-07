import { apiResourceUrl } from "./client";

export interface SessionStatus {
  authRequired: boolean;
  authorized: boolean;
}

/**
 * Ask the server whether the HTTP API is behind an access token and whether
 * this browser (via its session cookie) is already authorized. Any failure is
 * treated as "no auth required" so a plain local server keeps working.
 */
export async function getSessionStatus(): Promise<SessionStatus> {
  try {
    const response = await fetch(apiResourceUrl("/session"), {
      credentials: "same-origin",
    });
    if (!response.ok) return { authRequired: false, authorized: true };
    const body = (await response.json()) as {
      auth_required?: boolean;
      authorized?: boolean;
    };
    return {
      authRequired: Boolean(body.auth_required),
      authorized: Boolean(body.authorized),
    };
  } catch {
    return { authRequired: false, authorized: true };
  }
}

/**
 * Exchange the shared token for an HttpOnly session cookie. Resolves true on
 * success so subsequent same-origin requests (fetch and `<img>`) authenticate.
 */
export async function login(token: string): Promise<boolean> {
  const response = await fetch(apiResourceUrl("/session"), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return response.status === 204;
}
