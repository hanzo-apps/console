import { __test__ } from "./service-proxy";

/**
 * Tests for the embed proxy's root-absolute path rewriting. Embedded SPAs
 * (Base/PocketBase, the Vite playground) emit absolute paths like
 * `/_/assets/x.js` and `/assets/x.js` that must be re-pointed at the proxy
 * mount so they resolve through the same-origin SSO proxy instead of 404ing
 * against the console origin.
 */

const { rewriteBody, isRewritableContentType } = __test__;

describe("rewriteBody", () => {
  it("re-points Base /_/ assets at the proxy mount", () => {
    const html = `<script src="/_/assets/index-Clat2-wM.js"></script>`;
    expect(rewriteBody(html, "/api/base", ["/_/", "/api/"])).toBe(
      `<script src="/api/base/_/assets/index-Clat2-wM.js"></script>`,
    );
  });

  it("re-points Base /api/ runtime calls at the proxy mount", () => {
    const js = `fetch("/api/collections/users/records")`;
    expect(rewriteBody(js, "/api/base", ["/_/", "/api/"])).toBe(
      `fetch("/api/base/api/collections/users/records")`,
    );
  });

  it("re-points Vite /assets/ and /favicon at the proxy mount", () => {
    const html = `<link href="/favicon.svg"><script src="/assets/index-BHI4WWWd.js">`;
    expect(
      rewriteBody(html, "/api/playground-app", [
        "/assets/",
        "/favicon",
        "/api/",
      ]),
    ).toBe(
      `<link href="/api/playground-app/favicon.svg"><script src="/api/playground-app/assets/index-BHI4WWWd.js">`,
    );
  });

  it("rewrites url() references in CSS", () => {
    const css = `background:url(/_/assets/bg.png)`;
    expect(rewriteBody(css, "/api/base", ["/_/"])).toBe(
      `background:url(/api/base/_/assets/bg.png)`,
    );
  });

  it("is idempotent — does not double-prefix already-mounted paths", () => {
    const once = rewriteBody(`src="/_/x.js"`, "/api/base", ["/_/"]);
    const twice = rewriteBody(once, "/api/base", ["/_/"]);
    expect(twice).toBe(once);
    expect(twice).toBe(`src="/api/base/_/x.js"`);
  });

  it("leaves cross-origin and unrelated paths untouched", () => {
    const html = `<a href="https://fonts.googleapis.com/x"><a href="/other/y">`;
    expect(rewriteBody(html, "/api/base", ["/_/"])).toBe(html);
  });
});

describe("isRewritableContentType", () => {
  it("rewrites html/js/css/json text assets", () => {
    expect(isRewritableContentType("text/html; charset=utf-8")).toBe(true);
    expect(isRewritableContentType("application/javascript")).toBe(true);
    expect(isRewritableContentType("text/css")).toBe(true);
    expect(isRewritableContentType("application/json")).toBe(true);
  });

  it("does not touch binary assets", () => {
    expect(isRewritableContentType("image/png")).toBe(false);
    expect(isRewritableContentType("font/woff2")).toBe(false);
    expect(isRewritableContentType(null)).toBe(false);
  });
});
