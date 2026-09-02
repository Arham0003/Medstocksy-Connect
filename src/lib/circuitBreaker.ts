/**
 * Lightweight Circuit Breaker for external network dependencies (Gemini, Meta, MyMemory, Bot).
 * Prevents cascading timeouts and thread/connection exhaustion by fast-failing
 * when a dependency is failing or too slow, with timeouts and auto-recovery.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreakerOpenError extends Error {
  readonly retryAfterMs: number;
  readonly dependency: string;

  constructor(dependency: string, retryAfterMs: number) {
    const sec = Math.ceil(retryAfterMs / 1000);
    super(`[CircuitBreaker] ${dependency} is temporarily unavailable. Fast-failing for ${sec}s.`);
    this.name = 'CircuitBreakerOpenError';
    this.dependency = dependency;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface CircuitBreakerOptions<T = unknown> {
  name: string;
  failureThreshold?: number; // Failures before tripping (default: 3)
  cooldownMs?: number;       // Time in OPEN state before probe (default: 15,000ms)
  timeoutMs?: number;        // Max request duration before aborting (default: 10,000ms)
  fallback?: () => T | Promise<T>;
}

export class CircuitBreaker<T = unknown> {
  readonly name: string;
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private nextAttempt = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;
  private readonly fallback?: () => T | Promise<T>;

  constructor(options: CircuitBreakerOptions<T>) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 15_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fallback = options.fallback;
  }

  getState(): CircuitState {
    if (this.state === 'OPEN' && Date.now() >= this.nextAttempt) {
      this.state = 'HALF_OPEN';
    }
    return this.state;
  }

  async execute<R = T>(
    fn: (signal: AbortSignal) => Promise<R>,
    customFallback?: () => R | Promise<R>
  ): Promise<R> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      const remainingMs = Math.max(0, this.nextAttempt - Date.now());
      if (customFallback) return customFallback();
      if (this.fallback) return (await this.fallback()) as R;
      throw new CircuitBreakerOpenError(this.name, remainingMs);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`[CircuitBreaker] ${this.name} request timed out after ${this.timeoutMs}ms`));
    }, this.timeoutMs);

    try {
      const result = await fn(controller.signal);
      this.onSuccess();
      return result;
    } catch (err: unknown) {
      this.onFailure();
      if (customFallback) return customFallback();
      if (this.fallback) return (await this.fallback()) as R;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failureCount += 1;
    if (this.failureCount >= this.failureThreshold || this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.cooldownMs;
    }
  }
}
