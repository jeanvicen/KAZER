from pathlib import Path

p = Path('/home/ubuntu/KAZER/interface/chat.html')
s = p.read_text()

css_anchor = '      @media (min-width: 681px) { .kazer-bottom-strip {'
css = '''      .kazer-menu-backdrop { position: fixed; z-index: 70; inset: 0; background: rgba(0,0,0,.48); opacity: 0; pointer-events: none; transition: opacity 180ms var(--ease); }
      .kazer-menu-backdrop.visible { opacity: 1; pointer-events: auto; }
      .kazer-menu { position: fixed; z-index: 71; right: 50%; bottom: calc(62px + env(safe-area-inset-bottom) + 10px); display: grid; width: min(260px, calc(100vw - 32px)); padding: 7px; border: 1px solid var(--line); border-radius: 18px; background: color-mix(in srgb, var(--card) 96%, transparent); box-shadow: 0 18px 50px rgba(0,0,0,.48); opacity: 0; visibility: hidden; transform: translate(50%, 10px) scale(.97); transition: opacity 180ms var(--ease), transform 180ms var(--ease), visibility 180ms; }
      .kazer-menu.visible { opacity: 1; visibility: visible; transform: translate(50%, 0) scale(1); }
      .kazer-menu-option { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 12px; border-radius: 13px; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
      .kazer-menu-option:hover, .kazer-menu-option:focus-visible { background: rgba(255,255,255,.07); }
      .kazer-menu-option-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 10px; background: rgba(255,255,255,.07); color: var(--text-soft); }
      .kazer-menu-option-copy { display: grid; gap: 3px; }
      .kazer-menu-option-copy strong { font-size: 13px; font-weight: 650; }
      .kazer-menu-option-copy small { color: var(--text-dim); font-size: 11px; }
      .direct-screen { position: fixed; z-index: 46; inset: 0; display: flex; flex-direction: column; background: var(--page); color: var(--text); }
      .direct-screen[hidden] { display: none; }
      .direct-header { display: flex; align-items: center; gap: 12px; min-height: 74px; padding: max(16px, env(safe-area-inset-top)) 18px 0; border-bottom: 1px solid var(--line-soft); }
      .direct-back { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid var(--line); border-radius: 50%; background: transparent; color: var(--text); cursor: pointer; }
      .direct-title { margin: 0; font-size: 18px; font-weight: 650; letter-spacing: -.03em; }
      .direct-search { display: flex; align-items: center; gap: 9px; margin: 16px 18px 8px; padding: 0 13px; min-height: 44px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); }
      .direct-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font-size: 13px; }
      .direct-search input::placeholder { color: var(--text-dim); }
      .direct-list { flex: 1; overflow-y: auto; padding: 6px 18px 90px; }
      .direct-row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 70px; padding: 8px 4px; border-bottom: 1px solid var(--line-soft); background: transparent; color: var(--text); text-align: left; cursor: pointer; }
      .direct-row:hover { background: rgba(255,255,255,.035); }
      .direct-avatar { display: grid; place-items: center; width: 44px; height: 44px; flex: 0 0 auto; border-radius: 50%; background: var(--card-2); color: var(--text); font-size: 15px; font-weight: 700; }
      .direct-row-copy { min-width: 0; flex: 1; }
      .direct-row-top { display: flex; justify-content: space-between; gap: 10px; }
      .direct-row-top strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
      .direct-row-top time { color: var(--text-dim); font-size: 10px; }
      .direct-row-copy p { margin: 5px 0 0; overflow: hidden; color: var(--text-soft); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .direct-empty { padding: 48px 20px; color: var(--text-dim); font-size: 13px; line-height: 1.55; text-align: center; }
      .direct-chat { position: fixed; z-index: 47; inset: 0; display: flex; flex-direction: column; background: var(--page); }
      .direct-chat[hidden] { display: none; }
      .direct-chat-header { display: flex; align-items: center; gap: 11px; min-height: 66px; padding: max(12px, env(safe-area-inset-top)) 18px 0; border-bottom: 1px solid var(--line-soft); }
      .direct-chat-messages { flex: 1; overflow-y: auto; padding: 18px; }
      .direct-bubble { max-width: 78%; margin: 0 0 10px; padding: 10px 13px; border-radius: 16px; background: var(--card-2); color: var(--text); font-size: 13px; line-height: 1.45; }
      .direct-bubble.mine { margin-left: auto; background: var(--text); color: var(--accent-ink); }
      .direct-composer { display: flex; gap: 8px; padding: 10px 14px max(12px, env(safe-area-inset-bottom)); border-top: 1px solid var(--line-soft); }
      .direct-composer input { flex: 1; min-width: 0; min-height: 42px; padding: 0 13px; border: 1px solid var(--line); border-radius: 14px; outline: 0; background: var(--card); color: var(--text); }
      .direct-composer button { width: 42px; border-radius: 13px; background: var(--text); color: var(--accent-ink); cursor: pointer; }
'''
if css_anchor not in s:
    raise SystemExit('css anchor not found')
s = s.replace(css_anchor, css + css_anchor, 1)

markup_anchor = '      <div class="composer-dock">'
markup = '''      <div class="kazer-menu-backdrop" id="kazerMenuBackdrop"></div>
      <div class="kazer-menu" id="kazerMenu" role="menu" aria-label="Opções do K">
        <button class="kazer-menu-option" id="kazerAiOption" type="button" role="menuitem"><span class="kazer-menu-option-icon">K</span><span class="kazer-menu-option-copy"><strong>K de Kazer</strong><small>Conversar com a IA</small></span></button>
        <button class="kazer-menu-option" id="kazerDirectOption" type="button" role="menuitem"><span class="kazer-menu-option-icon">•••</span><span class="kazer-menu-option-copy"><strong>Conversas</strong><small>Conversas entre usuários</small></span></button>
      </div>
      <section class="direct-screen" id="directScreen" hidden aria-label="Conversas">
        <header class="direct-header"><button class="direct-back" id="directBack" type="button" aria-label="Voltar"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m15 5-7 7 7 7"></path></svg></button><h1 class="direct-title">Conversas</h1></header>
        <label class="direct-search"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg><input id="directSearch" type="search" placeholder="Buscar usuário para conversar..." autocomplete="off" /></label>
        <div class="direct-list" id="directList"><div class="direct-empty">Suas conversas aparecerão aqui.</div></div>
      </section>
      <section class="direct-chat" id="directChat" hidden aria-label="Chat direto"><header class="direct-chat-header"><button class="direct-back" id="directChatBack" type="button" aria-label="Voltar para conversas"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m15 5-7 7 7 7"></path></svg></button><span class="direct-avatar" id="directChatAvatar">?</span><strong id="directChatName">Conversa</strong></header><div class="direct-chat-messages" id="directChatMessages"><div class="direct-empty">Nenhuma mensagem ainda.</div></div><form class="direct-composer" id="directComposer"><input id="directMessageInput" type="text" placeholder="Mensagem..." autocomplete="off" /><button type="submit" aria-label="Enviar">↑</button></form></section>
'''
if markup_anchor not in s:
    raise SystemExit('markup anchor not found')
s = s.replace(markup_anchor, markup + markup_anchor, 1)

js_anchor = '        const kazerHistoryButton = document.getElementById("kazerHistoryButton");'
js = '''        const kazerMenu = document.getElementById("kazerMenu");
        const kazerMenuBackdrop = document.getElementById("kazerMenuBackdrop");
        const kazerAiOption = document.getElementById("kazerAiOption");
        const kazerDirectOption = document.getElementById("kazerDirectOption");
        const directScreen = document.getElementById("directScreen");
        const directChat = document.getElementById("directChat");
        const directBack = document.getElementById("directBack");
        const directChatBack = document.getElementById("directChatBack");
        const directSearch = document.getElementById("directSearch");
        const directList = document.getElementById("directList");
        const directChatName = document.getElementById("directChatName");
        const directChatAvatar = document.getElementById("directChatAvatar");
        const directChatMessages = document.getElementById("directChatMessages");
        const directComposer = document.getElementById("directComposer");
        const directMessageInput = document.getElementById("directMessageInput");
'''
if js_anchor not in s:
    raise SystemExit('js anchor not found')
s = s.replace(js_anchor, js_anchor + '\n' + js, 1)

logic_anchor = '        kazerHistoryButton?.addEventListener("click", () => setView("kazer", { push: true }));'
logic = '''        let activeDirectUser = null;
        const closeKazerMenu = () => { kazerMenu?.classList.remove("visible"); kazerMenuBackdrop?.classList.remove("visible"); };
        const openKazerMenu = () => { closeMenus(); kazerMenu?.classList.add("visible"); kazerMenuBackdrop?.classList.add("visible"); };
        const showDirectScreen = () => { closeKazerMenu(); directScreen.hidden = false; directChat.hidden = true; app.classList.add("direct-active"); directSearch?.focus(); };
        const hideDirectScreen = () => { directScreen.hidden = true; directChat.hidden = true; app.classList.remove("direct-active"); };
        const renderDirectList = () => {
          const query = String(directSearch?.value || "").trim().toLocaleLowerCase();
          const rows = [];
          if (query) rows.push('<div class="direct-empty">A busca por usuários será ativada após aplicar a migração de conversas.</div>');
          else rows.push('<div class="direct-empty">Nenhuma conversa ainda.<br>Busque um usuário acima para iniciar.</div>');
          directList.innerHTML = rows.join("");
        };
        const openDirectChat = (user) => { activeDirectUser = user; directChatName.textContent = user.name; directChatAvatar.textContent = user.name.slice(0,1).toUpperCase(); directScreen.hidden = true; directChat.hidden = false; directMessageInput.focus(); };
        kazerHistoryButton?.addEventListener("click", openKazerMenu);
        kazerAiOption?.addEventListener("click", () => { closeKazerMenu(); setView("new-chat", { push: true }); });
        kazerDirectOption?.addEventListener("click", showDirectScreen);
        kazerMenuBackdrop?.addEventListener("click", closeKazerMenu);
        directBack?.addEventListener("click", hideDirectScreen);
        directChatBack?.addEventListener("click", showDirectScreen);
        directSearch?.addEventListener("input", renderDirectList);
        directComposer?.addEventListener("submit", (event) => { event.preventDefault(); const text = directMessageInput.value.trim(); if (!text || !activeDirectUser) return; const bubble = document.createElement("div"); bubble.className = "direct-bubble mine"; bubble.textContent = text; directChatMessages.querySelector(".direct-empty")?.remove(); directChatMessages.appendChild(bubble); directMessageInput.value = ""; directChatMessages.scrollTop = directChatMessages.scrollHeight; });
        renderDirectList();
'''
if logic_anchor not in s:
    raise SystemExit('logic anchor not found')
s = s.replace(logic_anchor, logic_anchor + '\n' + logic, 1)

p.write_text(s)

migration = Path('/home/ubuntu/KAZER/database/supabase/015_direct_conversations.sql')
migration.write_text('''-- Kazer: conversas 1-a-1 entre usuários. Aplicar após 014_daily_token_policy.sql.\ncreate table if not exists public.direct_conversations (\n  id uuid primary key default gen_random_uuid(),\n  user_one uuid not null references auth.users(id) on delete cascade,\n  user_two uuid not null references auth.users(id) on delete cascade,\n  created_at timestamptz not null default now(),\n  updated_at timestamptz not null default now(),\n  check (user_one <> user_two),\n  unique (least(user_one, user_two), greatest(user_one, user_two))\n);\ncreate table if not exists public.direct_messages (\n  id uuid primary key default gen_random_uuid(),\n  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,\n  sender_id uuid not null references auth.users(id) on delete cascade,\n  body text not null check (char_length(btrim(body)) between 1 and 4000),\n  created_at timestamptz not null default now()\n);\ncreate index if not exists direct_conversations_updated_idx on public.direct_conversations(updated_at desc);\ncreate index if not exists direct_messages_conversation_idx on public.direct_messages(conversation_id, created_at);\nalter table public.direct_conversations enable row level security;\nalter table public.direct_messages enable row level security;\ngrant select, insert on public.direct_conversations to authenticated;\ngrant select, insert on public.direct_messages to authenticated;\ndrop policy if exists direct_conversations_member_read on public.direct_conversations;\ncreate policy direct_conversations_member_read on public.direct_conversations for select to authenticated using (auth.uid() in (user_one, user_two));\ndrop policy if exists direct_conversations_member_insert on public.direct_conversations;\ncreate policy direct_conversations_member_insert on public.direct_conversations for insert to authenticated with check (auth.uid() in (user_one, user_two));\ndrop policy if exists direct_messages_member_read on public.direct_messages;\ncreate policy direct_messages_member_read on public.direct_messages for select to authenticated using (exists (select 1 from public.direct_conversations c where c.id = conversation_id and auth.uid() in (c.user_one, c.user_two)));\ndrop policy if exists direct_messages_member_insert on public.direct_messages;\ncreate policy direct_messages_member_insert on public.direct_messages for insert to authenticated with check (sender_id = auth.uid() and exists (select 1 from public.direct_conversations c where c.id = conversation_id and auth.uid() in (c.user_one, c.user_two)));\n''')
print('updated UI and wrote migration')
