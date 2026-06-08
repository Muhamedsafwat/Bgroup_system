export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { pagination: PaginationMeta | null };
}

interface ApiError {
  success: false;
  error: string;
}

/**
 * Error thrown by `request` so callers can branch on HTTP status
 * (401 → re-auth, 422 → render form errors, 5xx → toast generic).
 * Previously the helper crashed on empty/HTML responses (502 from
 * an upstream proxy returning HTML triggered JSON.parse SyntaxError)
 * and lost the status code by throwing a bare Error.
 */
export class PartnersApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "PartnersApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/partners${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (e) {
    // Network failure (offline, DNS, aborted) — fetch throws, not
    // res.ok. Convert to a PartnersApiError with status=0 so the
    // caller can branch consistently.
    throw new PartnersApiError(
      e instanceof Error ? e.message : "Network error",
      0,
      null,
    );
  }

  // Tolerate non-JSON responses (empty 204, HTML from an upstream
  // proxy 502, text/plain debugger output). Fall back to res.text()
  // so an unexpected upstream doesn't crash the client.
  let body: unknown = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    body = await res.json().catch(() => null);
  } else {
    const text = await res.text().catch(() => "");
    body = text ? { error: text } : null;
  }

  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${res.status})`);
    throw new PartnersApiError(message, res.status, body);
  }

  return body as ApiResponse<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
