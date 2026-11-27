import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createD1, sessionUser, request } from "./d1-fixture.mjs";
import { onRequest } from "../functions/api/_middleware.js";
import { hashPassword, verifyPassword, parseCookies } from "../functions/api/_lib.js";
import * as upload from "../functions/api/upload.js";
import * as image from "../functions/api/image.js";

test("middleware blocks untrusted cross-origin writes and attaches security headers", async () => {
  const blocked = await onRequest({
    env: { ADMIN_ORIGIN: "https://admin.example.test" },
    request: new Request("https://blog.example.test/api/comments", {
      method: "POST",
      headers: { Origin: "https://evil.example.test" },
    }),
    next: async () => new Response("{}", { status: 200 }),
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(blocked.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");

  const allowed = await onRequest({
    env: { ADMIN_ORIGIN: "https://admin.example.test" },
    request: new Request("https://blog.example.test/api/comments", {
      method: "POST",
      headers: { Origin: "https://admin.example.test" },
    }),
    next: async () => new Response('{"ok":true}', { status: 200 }),
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(allowed.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), "https://admin.example.test");
});

test("verifyPassword uses constant-time check and parseCookies tolerates malformed encoding", async () => {
  const stored = await hashPassword("correct-horse-battery");
  assert.equal(await verifyPassword("correct-horse-battery", stored), true);
  assert.equal(await verifyPassword("wrong-pass", stored), false);
  assert.equal(await verifyPassword("x", "invalid-format"), false);
  assert.equal(await verifyPassword("x", "zz:1234"), false);

  const cookies = parseCookies(
    new Request("https://blog.example.test/api/auth", {
      headers: { Cookie: "a=hello%20world; bad=%E0%A4%A; empty=" },
    })
  );
  assert.equal(cookies.a, "hello world");
  assert.equal(cookies.bad, "%E0%A4%A");
  assert.equal(cookies.empty, "");
});

test("upload rejects SVG active content payloads", async () => {
  const DB = createD1();
  DB.sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const cookie = sessionUser(DB, "user", "blog_session");
  const svgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
  const res = await upload.onRequestPost({
    env: { DB },
    request: request("/api/upload", cookie, "POST", {
      filename: "xss.svg",
      dataUrl: `data:image/svg+xml;base64,${svgBase64}`,
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /仅支持/);
});

test("image endpoint adds nosniff and sandbox CSP for legacy SVG objects", async () => {
  const fakePng = new Uint8Array([137, 80, 78, 71]);
  const fakeSvg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const env = {
    IMAGES: {
      async get(key) {
        if (key === "images/test.png") {
          return { body: fakePng, httpMetadata: { contentType: "image/png" }, httpEtag: '"png1"' };
        }
        if (key === "images/legacy.svg") {
          return { body: fakeSvg, httpMetadata: { contentType: "image/svg+xml" }, httpEtag: '"svg1"' };
        }
        return null;
      },
    },
  };

  const pngRes = await image.onRequestGet({
    env,
    request: new Request("https://blog.example.test/api/image?key=images%2Ftest.png"),
  });
  assert.equal(pngRes.status, 200);
  assert.equal(pngRes.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(pngRes.headers.get("Content-Security-Policy"), null);

  const svgRes = await image.onRequestGet({
    env,
    request: new Request("https://blog.example.test/api/image?key=images%2Flegacy.svg"),
  });
  assert.equal(svgRes.status, 200);
  assert.equal(svgRes.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(svgRes.headers.get("Content-Security-Policy"), "default-src 'none'; sandbox");
});
