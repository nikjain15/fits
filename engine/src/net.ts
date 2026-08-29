/**
 * HTTP connection settings for every hosted call.
 *
 * THE BUG THIS EXISTS TO PREVENT, reproduced here on 2026-08-29 exactly as the
 * prior experiment documented it. The first hosted grid run reported 8 BORING
 * out of 9 on `claude-sonnet-5`, every one an opaque "fetch failed" with no HTTP
 * status. The same request succeeded every time in a fresh process, which is
 * what makes this so easy to misread as a model or payload problem.
 *
 * The cause is not the model and not the payload. Node's default dispatcher
 * keeps connections alive indefinitely. The remote closes an idle socket; undici
 * then dispatches a new request onto that half-closed socket and it dies at the
 * connection level -- so it never surfaces as a status code, never triggers a
 * status-based retry, and lands in BORING. It LOOKS like a payload-size effect
 * only because the largest skills take longest to process, leaving sockets idle
 * long enough to be reaped.
 *
 * Why it matters more than an ordinary flake: BORING is this project's smoke
 * alarm. FITS.md §11.6 settles assumption #6 on a zero-BORING count across 1,080
 * runs, and that zero was only earned by chasing faults like this one out. A
 * harness that manufactures its own BORING cannot tell you anything about a
 * skill, and a frontier cell poisoned this way costs real money to produce
 * nothing.
 *
 * Expiring our connections well before the remote does removes the race.
 */
import { Agent, setGlobalDispatcher, fetch as undiciFetch } from "undici";

let installed = false;

/**
 * USE THIS, NOT THE GLOBAL `fetch`.
 *
 * This is the second half of the fix and the half that actually matters. Node 26
 * ships its own internal copy of undici, so `globalThis.fetch` is NOT the same
 * function as the npm package's `fetch` — verified directly:
 *
 *     globalThis.fetch === undici.fetch   ->   false
 *
 * `setGlobalDispatcher` from the npm package therefore configures a client that
 * nothing in this engine was calling. Every connection setting below was being
 * written to an object no request ever touched, which is why the keep-alive fix
 * appeared to work in a short probe (few idle sockets) and did nothing across a
 * long run: 1,740 rows — a THIRD of the dataset — came back
 * ERR_HTTP2_INVALID_SESSION and were counted as BORING.
 *
 * A fix that cannot be observed to work is not a fix. Routing calls through this
 * export is what puts them on the dispatcher configured below.
 */
export const httpFetch = undiciFetch as unknown as typeof globalThis.fetch;

export function configureHttp(): void {
  if (installed) return;
  installed = true;
  setGlobalDispatcher(
    new Agent({
      // Well below any sane server-side idle timeout, so we close first.
      keepAliveTimeout: 4_000,
      keepAliveMaxTimeout: 10_000,
      // Enough for the configured cell concurrency plus headroom.
      connections: 64,
      // No pipelining. A pipelined connection that drops takes every in-flight
      // request on it down together, which turns one flake into a burst of them.
      pipelining: 1,
      headersTimeout: 180_000,
      bodyTimeout: 180_000,
      // HTTP/1.1 only. The failures were all ERR_HTTP2_INVALID_SESSION: a
      // multiplexed h2 session that drops takes every in-flight request on it
      // down together, turning one network blip into a whole cell of BORING.
      allowH2: false,
    }),
  );
}
