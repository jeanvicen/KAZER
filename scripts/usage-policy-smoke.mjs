import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  calculateChatCreditCost,
  calculateWebSearchCreditCost,
} = require("../api/_usage.js");

const simpleChat = calculateChatCreditCost([{ role: "user", content: "Olá" }]);
const longChat = calculateChatCreditCost([{ role: "user", content: "a".repeat(5000) }]);
const technicalChat = calculateChatCreditCost(
  [
    { role: "user", content: "Quero corrigir o bug do meu site e fazer o deploy." },
    { role: "assistant", content: "Qual é o erro?" },
    { role: "user", content: "Também analise os arquivos anexados." },
  ],
  2,
  2,
);
const webSearch = calculateWebSearchCreditCost("como funciona o WebKazer", "all", 8);
const imageSearch = calculateWebSearchCreditCost("referências visuais", "images", 8);

assert.equal(simpleChat, 10);
assert.ok(longChat > simpleChat);
assert.ok(technicalChat > longChat);
assert.ok(webSearch >= 20 && webSearch <= 80);
assert.ok(imageSearch > webSearch);
assert.equal(calculateWebSearchCreditCost("x", "all", 0), 22);

console.log("usage-policy-smoke: OK", {
  simpleChat,
  longChat,
  technicalChat,
  webSearch,
  imageSearch,
});
