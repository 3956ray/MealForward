import { makePilotHandler } from "../auth/core.mjs";
import * as siwe from "../auth/siwe.mjs";
import { makeExecutionPublicRpc } from "../t1f-execution-rpc.mjs";
import { pgAuthStore } from "./auth-store.mjs";
import { makeService } from "./service.mjs";
import { POLICY, MEAL, AMOUNT } from "./chain.mjs";
import { hash, token, check } from "./store.mjs";
const namespace = {
  prefix: "/v1/mvp",
  sessionCookie: "__Host-mf_mvp_session",
  preCookie: "__Host-mf_mvp_pre",
  csrfHeader: "x-mvp-csrf",
  bootstrapHeader: "x-mvp-bootstrap",
};
const cookie = (name, value, age) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
const cookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim().split(/=(.*)/s).slice(0, 2))
      .filter((x) => x.length === 2),
  );
const exact = (body, keys) =>
  body &&
  typeof body === "object" &&
  !Array.isArray(body) &&
  Object.keys(body).sort().join(",") === [...keys].sort().join(",");
const routes = {
  "/setup/token/prepare": "token",
  "/setup/escrow/prepare": "escrow",
  "/donor/approve/prepare": "approve",
  "/donor/fund/prepare": "fund",
  "/issuer/issue/prepare": "issue",
  "/merchant/redeem/prepare": "redeem",
  "/merchant/settle/prepare": "settle",
};
export function makeMvpHttp(options) {
  return makeHttp({ ...options, policy: POLICY, siwe });
}
export function makeLocalMvpHttp(options) {
  check(
    /^http:\/\/127\.0\.0\.1:\d+$/.test(options.origin) &&
      options.policy?.chainId === 31337,
    "LOCAL_HARNESS_REQUIRED",
    503,
  );
  return makeHttp(options);
}
function makeHttp({
  pool,
  origin,
  pepper,
  enabled = false,
  writesEnabled = false,
  rpc = makeExecutionPublicRpc(),
  policy,
  siwe: siweProvider = siwe,
  clock = () => Math.floor(Date.now() / 1000),
}) {
  check(
    /^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin) ||
      /^http:\/\/127\.0\.0\.1:\d+$/.test(origin),
    "PINNED_ORIGIN_REQUIRED",
    503,
  );
  const service = makeService({ pool, rpc, pepper, policy, clock }),
    store = service.store,
    authStore = pgAuthStore(pool);
  const auth = makePilotHandler({
    store: authStore,
    siwe: {
      ...siweProvider,
      makeChallenge(args) {
        check(service.role(args.wallet), "ROLE_DENIED", 403);
        return siweProvider.makeChallenge(args);
      },
    },
    origin,
    clock,
    namespace,
  });
  const send = (res, status, value, headers = {}) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    });
    res.end(JSON.stringify(value));
  };
  const sameOrigin = (req) =>
    check(
      (!req.headers.origin || req.headers.origin === origin) &&
        (!req.headers["sec-fetch-site"] ||
          req.headers["sec-fetch-site"] === "same-origin"),
      "ORIGIN_DENIED",
      403,
    );
  async function bodyOf(req) {
    check(
      (req.headers["content-type"] || "").split(";")[0].trim() ===
        "application/json",
      "JSON_REQUIRED",
      415,
    );
    let size = 0,
      buf = [];
    for await (const b of req) {
      size += b.length;
      check(size <= 8192, "BODY_TOO_LARGE", 413);
      buf.push(b);
    }
    try {
      return JSON.parse(Buffer.concat(buf).toString());
    } catch {
      check(false, "INVALID_JSON", 400);
    }
  }
  async function handle(req, res) {
    try {
      const u = new URL(req.url, origin),
        path = u.pathname.slice("/v1/mvp".length);
      check(
        req.headers.host === new URL(origin).host &&
          !u.search &&
          !u.username &&
          !u.password &&
          u.pathname.startsWith("/v1/mvp/"),
        "ORIGIN_DENIED",
        403,
      );
      sameOrigin(req);
      check(["GET", "POST"].includes(req.method), "METHOD_NOT_ALLOWED", 405);
      if (req.method === "POST")
        check(req.headers.origin === origin, "ORIGIN_DENIED", 403);
      if (path === "/status" && req.method === "GET")
        return send(res, 200, {
          enabled,
          writesEnabled: enabled && writesEnabled,
          chainId: policy.chainId,
          testOnly: true,
          roles: {
            owner: policy.owner,
            donor: policy.donor,
            issuer: policy.issuer,
          },
          meal: MEAL,
          amount: AMOUNT.toString(),
        });
      check(enabled, "MVP_DISABLED", 503);
      if (
        [
          "/auth/pre-session",
          "/identity/wallet/challenge",
          "/identity/wallet/login",
          "/auth/logout",
        ].includes(path)
      ) {
        await store.rate(
          "auth:" + hash(req.socket?.remoteAddress || "unknown"),
          clock(),
          40,
        );
        return auth(req, res);
      }
      const body = req.method === "POST" ? await bodyOf(req) : null;
      const recovery = /^\/operations\/[0-9a-f-]+\/(hash|reconcile)$/.test(
        path,
      );
      if (req.method === "POST" && !recovery)
        check(writesEnabled, "WRITES_DISABLED", 503);
      const ck = cookies(req),
        sessionRaw = ck[namespace.sessionCookie],
        recipientRaw = ck["__Host-mf_mvp_recipient"];
      if (path === "/recipient/exchange" && req.method === "POST") {
        check(
          exact(body, ["token"]) && req.headers["x-mvp-bootstrap"] === "1",
          "INVALID_REQUEST",
          422,
        );
        const { session, ...result } = await service.exchange(body.token);
        return send(res, 200, result, {
          "Set-Cookie": cookie(
            "__Host-mf_mvp_recipient",
            session,
            result.expiresAt - clock(),
          ),
        });
      }
      if (path.startsWith("/recipient/")) {
        check(
          typeof recipientRaw === "string" && recipientRaw.length === 43,
          "RECIPIENT_UNAUTHENTICATED",
          401,
        );
        const sh = hash(recipientRaw);
        if (path === "/recipient/voucher" && req.method === "GET")
          return send(res, 200, await service.recipientView(sh));
        if (path === "/recipient/display" && req.method === "POST") {
          check(
            exact(body, []) && typeof req.headers["x-mvp-csrf"] === "string",
            "CSRF",
            403,
          );
          return send(
            res,
            200,
            await service.display(sh, hash(req.headers["x-mvp-csrf"])),
          );
        }
        check(false, "NOT_FOUND", 404);
      }
      check(
        typeof sessionRaw === "string" && sessionRaw.length === 43,
        "UNAUTHENTICATED",
        401,
      );
      const sh = hash(sessionRaw);
      let session;
      if (req.method === "POST") {
        check(
          typeof req.headers["x-mvp-csrf"] === "string" &&
            req.headers["x-mvp-csrf"].length === 43,
          "CSRF",
          403,
        );
        session = await authStore.getSessionWithCsrf(
          sh,
          hash(req.headers["x-mvp-csrf"]),
          clock(),
        );
      } else session = await authStore.getSession(sh, clock());
      check(session && service.role(session.wallet), "UNAUTHENTICATED", 401);
      const wallet = session.wallet;
      if (path === "/me" && req.method === "GET") {
        const csrf = token();
        await pool.query(
          "UPDATE mf_mvp.sessions SET csrf_hash=$2 WHERE token_hash=$1",
          [sh, hash(csrf)],
        );
        return send(res, 200, { wallet, role: service.role(wallet), csrf });
      }
      if (path === "/setup" && req.method === "GET")
        return send(res, 200, await service.setup(wallet));
      if (path === "/quote" && req.method === "GET")
        return send(res, 200, await service.quote(wallet));
      if (path === "/quote" && req.method === "POST") {
        check(exact(body, []), "INVALID_REQUEST", 422);
        return send(res, 200, await service.quote(wallet, true));
      }
      if (path === "/quote/verify" && req.method === "POST") {
        check(exact(body, ["signature"]), "INVALID_REQUEST", 422);
        return send(res, 200, await service.signQuote(wallet, body.signature));
      }
      if (routes[path] && req.method === "POST") {
        check(
          exact(body, routes[path] === "redeem" ? ["checkToken"] : []) &&
            (routes[path] !== "redeem" ||
              (typeof body.checkToken === "string" &&
                body.checkToken.length === 43)),
          "INVALID_REQUEST",
          422,
        );
        return send(
          res,
          200,
          await service.prepare(routes[path], wallet, sh, body),
        );
      }
      const match = path.match(
        /^\/operations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(attempt|hash|reconcile))?$/,
      );
      if (match) {
        const [, id, action] = match;
        if (!action && req.method === "GET")
          return send(res, 200, await service.operation(id, wallet));
        if (req.method === "POST") {
          check(
            exact(body, action === "hash" ? ["txHash"] : []),
            "INVALID_REQUEST",
            422,
          );
          check(
            ["attempt", "hash", "reconcile"].includes(action),
            "NOT_FOUND",
            404,
          );
          return send(
            res,
            200,
            await service[action === "hash" ? "bind" : action](
              id,
              wallet,
              body.txHash,
            ),
          );
        }
      }
      if (path === "/issuer/invite" && req.method === "POST") {
        check(
          exact(body, []) || (exact(body, ["rotate"]) && body.rotate === true),
          "INVALID_REQUEST",
          422,
        );
        return send(
          res,
          200,
          await service.invite(wallet, body.rotate === true),
        );
      }
      if (path === "/merchant/check" && req.method === "POST") {
        check(
          (exact(body, ["code"]) &&
            typeof body.code === "string" &&
            /^\d{6}$/.test(body.code)) ||
            (exact(body, ["qrToken"]) &&
              typeof body.qrToken === "string" &&
              body.qrToken.length === 43),
          "INVALID_REQUEST",
          422,
        );
        return send(res, 200, await service.merchantCheck(wallet, sh, body));
      }
      check(false, "NOT_FOUND", 404);
    } catch (e) {
      return send(res, Number.isInteger(e.status) ? e.status : 503, {
        error:
          typeof e.code === "string" && /^[A-Z_]{3,64}$/.test(e.code)
            ? e.code
            : "SERVICE_UNAVAILABLE",
      });
    }
  }
  return { handle, close: async () => {}, service, store };
}
