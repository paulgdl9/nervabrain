import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export type FeedItem = {
  id: string;
  title: string;
  link: string;
  published?: string;
  summary?: string;
};

const ITEM_RE = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function ipv4Number(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function ipv4InRange(value: number, mask: number, prefix: number) {
  return ((value & mask) >>> 0) === (prefix >>> 0);
}

export function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().split("%", 1)[0];
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPrivateAddress(mapped);
  if (isIP(normalized) === 4) {
    const value = ipv4Number(normalized);
    if (value === null) return true;
    return (
      ipv4InRange(value, 0xff000000, 0x00000000) || // unspecified/current host
      ipv4InRange(value, 0xff000000, 0x0a000000) || // 10/8
      ipv4InRange(value, 0xff000000, 0x7f000000) || // loopback
      ipv4InRange(value, 0xfff00000, 0xac100000) || // 172.16/12
      ipv4InRange(value, 0xffff0000, 0xa9fe0000) || // link-local and metadata
      ipv4InRange(value, 0xffff0000, 0xc0a80000) || // 192.168/16
      ipv4InRange(value, 0xffc00000, 0x64400000) || // carrier-grade NAT
      ipv4InRange(value, 0xffffff00, 0xc0000000) || // IETF protocol assignments
      ipv4InRange(value, 0xffffff00, 0xc0000200) || // documentation
      ipv4InRange(value, 0xfffe0000, 0xc6120000) || // benchmark
      ipv4InRange(value, 0xffffff00, 0xc6336400) || // documentation
      ipv4InRange(value, 0xffffff00, 0xcb007100) || // documentation
      ipv4InRange(value, 0xf0000000, 0xe0000000) // multicast/reserved
    );
  }
  if (isIP(normalized) === 6) {
    const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return normalized === "::" || normalized === "::1"
      || normalized.startsWith("fc") || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("ff")
      || normalized.startsWith("2001:db8:");
  }
  return true;
}

type SafeFeedTarget = { url: URL; address: string; family: 4 | 6 };

async function resolveSafeFeedUrl(value: string): Promise<SafeFeedTarget> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid feed URL");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Feed URL must be an unauthenticated HTTP(S) URL");
  }
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) {
    throw new Error("Feed URL uses a disallowed port");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Feed URL resolves to a private host");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Feed URL resolves to a private or reserved address");
  }
  const selected = addresses[0];
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

export async function assertSafeFeedUrl(value: string): Promise<URL> {
  return (await resolveSafeFeedUrl(value)).url;
}

function requestFeed(target: SafeFeedTarget, timeoutMs: number): Promise<IncomingMessage> {
  const transport = target.url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = transport(target.url, {
      headers: {
        "User-Agent": "second-brain-rss/1.0",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "Accept-Encoding": "identity",
      },
      // Happy Eyeballs (autoSelectFamily, on by default since Node 20) expects a
      // lookup callback that can return multiple addresses and breaks our
      // single-address DNS pin (anti-rebinding) with ERR_INVALID_IP_ADDRESS.
      // Disable it so the single resolved address below is used as-is.
      // Not in @types/node's http.RequestOptions (it's a net.connect option
      // Node forwards through), hence the `as` below.
      autoSelectFamily: false,
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
    } as RequestOptions & { autoSelectFamily?: boolean }, resolve);
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Feed request timed out")));
    request.on("error", reject);
    request.end();
  });
}

async function responseText(response: IncomingMessage, maxBytes: number) {
  const declared = Number(response.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Feed response is too large");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for await (const chunk of response) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      response.destroy();
      throw new Error("Feed response is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function fetchFeed(url: string, timeoutMs = 15000): Promise<FeedItem[]> {
  let current = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const target = await resolveSafeFeedUrl(current);
    const res = await requestFeed(target, timeoutMs);
    const status = res.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status)) {
      res.resume();
      if (redirects === MAX_REDIRECTS) throw new Error("Too many feed redirects");
      const location = res.headers.location;
      if (!location) throw new Error("Feed redirect has no location");
      current = new URL(location, target.url).toString();
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new Error(`HTTP ${status}`);
    }
    return parseFeed(await responseText(res, MAX_FEED_BYTES));
  }
  throw new Error("Too many feed redirects");
}

export function parseFeed(xml: string): FeedItem[] {
  const blocks = xml.match(ITEM_RE) || [];
  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = clean(tag(block, "title"));
    const link = clean(extractLink(block));
    const id = clean(tag(block, "guid") || tag(block, "id")) || link;
    const published = clean(tag(block, "pubDate") || tag(block, "published") || tag(block, "updated"));
    const summary = clean(tag(block, "description") || tag(block, "summary"));
    if (!id && !link) continue;
    items.push({
      id,
      title,
      link,
      published: published ? normalizeDate(published) : undefined,
      summary: summary ? stripHtml(summary).slice(0, 400) : undefined,
    });
  }
  return items;
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? match[1] : "";
}

function extractLink(block: string): string {
  const text = tag(block, "link").trim();
  if (text) return text;
  // Atom: <link rel="alternate" href="..."/> — prefer alternate, fall back to first href.
  const links = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const alternate = links.find((l) => /rel=["']?alternate/i.test(l)) || links.find((l) => !/rel=/i.test(l)) || links[0];
  const href = alternate?.match(/href=["']([^"']+)["']/i);
  return href ? href[1] : "";
}

function clean(value: string): string {
  return decodeEntities(stripCdata(value)).trim();
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function normalizeDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
