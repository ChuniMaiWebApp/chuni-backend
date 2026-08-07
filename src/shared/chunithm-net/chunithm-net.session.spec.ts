import { ChunithmNetSession } from './chunithm-net.session';
import { RateLimiter } from './rate-limiter';

/**
 * CHUNITHM-NET rotates its `_t` token on every response, so two requests in
 * flight on one session make the second send a stale token and SEGA answers
 * with error 100001. The session must therefore run its requests one at a
 * time, even when the caller uses `Promise.all`.
 */
describe('ChunithmNetSession request serialization', () => {
  const makeSession = () =>
    new ChunithmNetSession({
      clal: 'a'.repeat(64),
      limiter: new RateLimiter(100, 100),
    });

  it('never has two requests in flight at once', async () => {
    const session = makeSession();

    let inFlight = 0;
    let maxInFlight = 0;

    // Stand in for the HTTP layer: record concurrency, then resolve after a
    // tick so overlapping calls would be visible.
    const http = (session as unknown as { http: { request: unknown } }).http;

    http.request = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      await new Promise((resolve) => setTimeout(resolve, 5));

      inFlight -= 1;

      return { status: 200, data: '<html></html>', request: {} };
    };

    await Promise.all([
      session.getRecentScores(),
      session.getBest30(),
      session.getNew20(),
    ]);

    expect(maxInFlight).toBe(1);
  });

  it('keeps running after one request fails', async () => {
    const session = makeSession();
    const http = (session as unknown as { http: { request: unknown } }).http;

    let call = 0;

    http.request = async () => {
      call += 1;

      if (call === 1) throw new Error('boom');

      return Promise.resolve({
        status: 200,
        data: '<html></html>',
        request: {},
      });
    };

    // A rejected operation must not poison the queue for later ones.
    await expect(session.getBest30()).rejects.toThrow('boom');
    await expect(session.getNew20()).resolves.toEqual([]);
  });
});
