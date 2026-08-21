import assert from "node:assert/strict";
import test from "node:test";
import { isPrivateAddress, parseFeed } from "../src/lib/rss";

test("RSS SSRF guard rejects private, metadata, mapped, and reserved addresses", () => {
  for (const address of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:192.168.1.1", "::ffff:c0a8:101",
  ]) assert.equal(isPrivateAddress(address), true, address);
  assert.equal(isPrivateAddress("1.1.1.1"), false);
  assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
});

test("RSS parser still handles Atom links after transport hardening", () => {
  const items = parseFeed(`<?xml version="1.0"?><feed><entry><id>one</id><title>Hello</title><link rel="alternate" href="https://example.com/one"/><summary>Useful</summary></entry></feed>`);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, "https://example.com/one");
});
