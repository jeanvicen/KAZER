/*
 * TEMPORARY STUB — chat.js was corrupted during visual upgrade restore.
 * Restore the working compressed loader with:
 *   git checkout 4c11eddb53fde5c137dff0aff080346f24485573 -- api/chat.js
 *   git commit -m "fix: restore full api/chat.js from 4c11edd"
 *   git push
 * Visual SVG studio prompts in _kazer-instructions.js and docs/visual-system.md are intact.
 */
module.exports = async function handler(req, res) {
  res.statusCode = 503;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    error: "chat.js needs restore",
    fix: "git checkout 4c11eddb53fde5c137dff0aff080346f24485573 -- api/chat.js && git commit -m 'fix: restore chat.js' && git push",
    note: "SVG studio instructions remain in api/_kazer-instructions.js and docs/visual-system.md"
  }));
};
