import fs from "node:fs";
const html = fs.readFileSync("interface/chat.html", "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (!scripts.length) throw new Error("Nenhum script encontrado");
for (const script of scripts) new Function(script);
console.log(`interface JS syntax: OK (${scripts.length} script) `);
