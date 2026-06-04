export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API Error: ${status}`);
    this.name = 'ApiError';
  }
}

const DEFAULT_TIMEOUT = 10_000;

export async function apiFetch<T>(
  url: string,
  options?: RequestInit & { timeout?: number },
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, signal: externalSignal, ...fetchOptions } = options ?? {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // 如果外部也传了 signal，任一触发都应该中止
  let onExternalAbort: (() => void) | undefined;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      controller.abort();
    } else {
      onExternalAbort = () => controller.abort();
      externalSignal.addEventListener('abort', onExternalAbort);
    }
  }

  try {
    const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
    const body = await res.json();

    if (!res.ok) {
      throw new ApiError(res.status, body);
    }

    return body as T;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal && onExternalAbort) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}
