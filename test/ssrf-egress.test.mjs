import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import test from "node:test";

const require = createRequire(import.meta.url);
const { isPublicAddress } = require("../api/_research-search-utils.js");
const { createPinnedLookup, parsePublicUrl, requestPublicUrl, resolvePublicAddress } = require("../api/_ssrf.js");
const { fetchResearchPage } = require("../api/_research-orchestrator.js");

function fakeTransport(replies, captures = []) {
  return {
    request(options, onResponse) {
      const request = new EventEmitter();
      request.setTimeout = () => {};
      request.destroy = (error) => {
        if (error) queueMicrotask(() => request.emit("error", error));
        return request;
      };
      request.end = (body) => {
        const capture = { options, body: body ? Buffer.from(body).toString("utf8") : "" };
        captures.push(capture);
        options.lookup(options.hostname, { all: true }, (error, addresses) => {
          if (error) { request.emit("error", error); return; }
          capture.pinned = addresses;
          const reply = replies.shift();
          const response = Readable.from([Buffer.from(reply?.body || "")]);
          response.statusCode = reply?.status || 200;
          response.headers = reply?.headers || { "content-type": "text/plain" };
          onResponse(response);
        });
      };
      return request;
    },
  };
}

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

test("public address policy rejects private, reserved, mapped and documentation ranges", () => {
  for (const address of [
    "0.1.2.3", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "192.168.1.1", "192.0.2.8", "198.51.100.9",
    "203.0.113.9", "224.0.0.1", "::1", "fc00::1", "fe80::1",
    "::ffff:127.0.0.1", "2001:db8::1",
  ]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2001:4860:4860::8888"), true);
});

test("URL policy preserves public custom-port MCP endpoints but restricts page fetches", () => {
  assert.equal(parsePublicUrl("https://mcp.example.com:8443/mcp", { protocols: ["https:"], allowCustomPort: true }).port, "8443");
  assert.throws(() => parsePublicUrl("https://mcp.example.com:8443/mcp"), /unsafe_public_port/);
  assert.throws(() => parsePublicUrl("https://127.0.0.1/admin", { protocols: ["https:"], allowCustomPort: true }), /unsafe_public_url/);
  assert.throws(() => parsePublicUrl("https://user:pass@example.com/mcp", { protocols: ["https:"], allowCustomPort: true }), /unsafe_public_url/);
});

test("DNS policy rejects mixed public/private answers and pins the selected public address", async () => {
  await assert.rejects(
    resolvePublicAddress("mixed.example.com", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.4", family: 4 },
    ]),
    /unsafe_public_destination/,
  );
  await assert.rejects(
    resolvePublicAddress("mismatched.example.com", async () => [{ address: "93.184.216.34", family: 6 }]),
    /unsafe_public_destination/,
  );
  const lookup = createPinnedLookup({ address: "93.184.216.34", family: 4 });
  const all = await new Promise((resolve, reject) => lookup("rebinding.example.com", { all: true }, (error, value) => error ? reject(error) : resolve(value)));
  assert.deepEqual(all, [{ address: "93.184.216.34", family: 4 }]);
});

test("public request connects to the DNS answer it validated", async () => {
  const captures = [];
  const response = await requestPublicUrl("https://public.example.com/page", {
    protocols: ["https:"],
    requestImplementation: fakeTransport([{ status: 200, body: "ok" }], captures),
    resolver: publicResolver,
    maxBytes: 32,
  });
  assert.equal(await response.text(), "ok");
  assert.equal(captures.length, 1);
  assert.equal(captures[0].options.hostname, "public.example.com");
  assert.equal(captures[0].options.servername, "public.example.com");
  assert.deepEqual(captures[0].pinned, [{ address: "93.184.216.34", family: 4 }]);
});

test("public response limits cover both wire bytes and decompressed bytes", async () => {
  await assert.rejects(requestPublicUrl("https://public.example.com/large", {
    protocols: ["https:"], resolver: publicResolver, maxBytes: 64,
    requestImplementation: fakeTransport([{ status: 200, body: "x".repeat(100) }]),
  }), /upstream_response_too_large/);

  await assert.rejects(requestPublicUrl("https://public.example.com/compressed", {
    protocols: ["https:"], resolver: publicResolver, maxBytes: 64,
    requestImplementation: fakeTransport([{ status: 200, headers: { "content-encoding": "gzip" }, body: gzipSync(Buffer.from("x".repeat(1000))) }]),
  }), /upstream_response_too_large/);
});

test("research fallback follows validated public redirects and rejects private destinations", async () => {
  const calls = [];
  const resolver = async (hostname) => {
    calls.push(hostname);
    return [{ address: hostname === "first.example.com" ? "93.184.216.34" : "1.1.1.1", family: 4 }];
  };
  const captures = [];
  const response = await fetchResearchPage("https://first.example.com/article", 1000, {
    resolver,
    requestImplementation: fakeTransport([
      { status: 302, headers: { location: "https://second.example.net/final" }, body: "redirect" },
      { status: 200, headers: { "content-type": "text/html" }, body: "A public page was read successfully." },
    ], captures),
  });
  assert.equal(await response.text(), "A public page was read successfully.");
  assert.deepEqual(calls, ["first.example.com", "second.example.net"]);
  assert.equal(captures.length, 2);
  assert.deepEqual(captures.map((item) => item.pinned[0].address), ["93.184.216.34", "1.1.1.1"]);

  const privateCaptures = [];
  const privateCalls = [];
  await assert.rejects(fetchResearchPage("https://first.example.com/article", 1000, {
    resolver: async (hostname) => { privateCalls.push(hostname); return [{ address: "93.184.216.34", family: 4 }]; },
    requestImplementation: fakeTransport([
      { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" }, body: "redirect" },
    ], privateCaptures),
  }), /unsafe_research_redirect/);
  assert.deepEqual(privateCalls, ["first.example.com"]);
  assert.equal(privateCaptures.length, 1, "the private destination must never be requested");
});
