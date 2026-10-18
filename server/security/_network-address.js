const { isIP } = require("node:net");

function parseIpv6(value) {
  let address = String(value || "").toLowerCase();
  if (address.includes("%")) return null;
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const ipv4 = address.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map(Number);
    address = `${address.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right];
  if (words.length !== 8 || words.some((word) => !/^[\da-f]{1,4}$/.test(word))) return null;
  return words.reduce((result, word) => (result << 16n) | BigInt(`0x${word}`), 0n);
}

function isPublicAddress(value) {
  const address = String(value || "").toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c, d] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 168 && b === 63 && c === 129 && d === 16) return false;
    if (a === 192 && b === 88 && c === 99) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const parsed = parseIpv6(address);
    if (parsed === null) return false;
    const globalUnicastStart = 0x20000000000000000000000000000000n;
    const globalUnicastEnd = 0x40000000000000000000000000000000n;
    if (parsed < globalUnicastStart || parsed >= globalUnicastEnd) return false;
    const hasPrefix = (prefix, bits) => (parsed >> BigInt(128 - bits)) === prefix;
    if (hasPrefix(0x20010000n, 32) || hasPrefix(0x20010db8n, 32)) return false;
    if (hasPrefix(0x200100020000n, 48)) return false;
    if (hasPrefix(0x2001001n, 28) || hasPrefix(0x2001002n, 28)) return false;
    if (hasPrefix(0x2002n, 16) || hasPrefix(0x3fff0n, 20)) return false;
    return true;
  }
  return false;
}

function isSafePublicHostname(value) {
  const hostname = String(value || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname === "metadata" || hostname === "instance-data" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".test") || hostname.endsWith(".example") || hostname.endsWith(".invalid") || hostname.endsWith(".onion")) return false;
  const family = isIP(hostname);
  if (family) return isPublicAddress(hostname);
  return hostname.includes(".");
}

module.exports = { isPublicAddress, isSafePublicHostname, parseIpv6 };
