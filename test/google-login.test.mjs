import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const login = readFileSync(new URL("../interface/login.html", import.meta.url), "utf8");
const googleFlow = login.slice(
  login.indexOf("document.getElementById('googleLoginBtn')?.addEventListener"),
  login.indexOf("// Signup", login.indexOf("document.getElementById('googleLoginBtn')?.addEventListener")),
);

test("login screen offers Google through the existing Supabase Auth client", () => {
  assert.match(login, /id="googleLoginBtn"[^>]*aria-describedby="loginError"/);
  assert.match(login, /Continuar com Google/);
  assert.match(googleFlow, /kazerDB\.auth\.signInWithOAuth\(\{\s*provider:\s*'google'/);
  assert.match(googleFlow, /redirectTo:\s*`\$\{window\.location\.origin\}\/login\?auth=google`/);
  assert.match(googleFlow, /queryParams:\s*\{\s*prompt:\s*'select_account'\s*\}/);
});

test("existing Supabase email, signup, recovery, and password-update flows remain intact", () => {
  assert.match(login, /kazerDB\.auth\.signInWithPassword\(\{ email, password \}\)/);
  assert.match(login, /kazerDB\.auth\.signUp\(/);
  assert.match(login, /kazerDB\.auth\.resetPasswordForEmail\(/);
  assert.match(login, /kazerDB\.auth\.updateUser\(\{ password \}\)/);
});

test("Google OAuth errors do not fall back to account creation or expose provider details", () => {
  assert.doesNotMatch(googleFlow, /\.auth\.signUp\(/);
  assert.match(login, /googleAuthErrorMessage\(error\)/);
  assert.match(login, /Esta conta já está vinculada a um acesso existente/);
  assert.match(login, /O login com Google ainda não foi ativado no Supabase/);
});

test("the Google login client contains no Firebase Admin, private key, or service-role credential", () => {
  assert.doesNotMatch(login, /firebase-admin|serviceAccount|FIREBASE_PRIVATE_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(login, /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/);
});
