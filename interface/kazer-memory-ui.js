/* UI binding for the encrypted, device-only KAZER memory module. */
(() => {
  "use strict";
  const core = window.KazerMemoryCore;
  if (!core) return;
  let store = null;
  let activeUserId = "";
  const byId = (id) => document.getElementById(id);
  const categoryNames = { profile: "Perfil", preference: "Preferência", decision: "Decisão", task: "Tarefa", conversation: "Conversa", fact: "Fato" };
  const list = byId("memoryList");
  const search = byId("memorySearch");
  const categoryFilter = byId("memoryCategoryFilter");
  const status = byId("memoryStatus");
  const privateSwitch = byId("memoryPrivateSwitch");
  const shareSwitch = byId("memoryShareSwitch");
  const importInput = byId("memoryImportFile");

  const setStatus = (message, isError = false) => {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = isError ? "error" : "ready";
  };
  const setSwitch = (element, value, disabled = false) => {
    if (!element) return;
    element.classList.toggle("on", Boolean(value));
    element.setAttribute("aria-pressed", String(Boolean(value)));
    element.disabled = Boolean(disabled);
  };
  const formatDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Data indisponível" : new Intl.DateTimeFormat(document.documentElement.lang || "pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
  };

  async function refresh() {
    if (!store || !list) return;
    try {
      const prefs = await store.getPreferences();
      const entries = await store.list({ query: search?.value || "", category: categoryFilter?.value || "all" });
      const count = await store.list();
      list.replaceChildren();
      if (!entries.length) {
        const empty = document.createElement("p");
        empty.className = "memory-empty";
        empty.textContent = search?.value || categoryFilter?.value !== "all" ? "Nenhuma memória corresponde a esse filtro." : "Ainda não há memórias neste dispositivo.";
        list.append(empty);
      }
      for (const entry of entries) list.append(renderEntry(entry, prefs.privateMode));
      byId("memoryCount").textContent = `${count.length} ${count.length === 1 ? "memória salva" : "memórias salvas"}`;
      setSwitch(privateSwitch, prefs.privateMode);
      setSwitch(shareSwitch, prefs.shareContext, prefs.privateMode);
      setStatus(`Memórias criptografadas neste dispositivo · ${count.length} salvas${prefs.privateMode ? " · modo privado ativo" : ""}`);
    } catch {
      list.replaceChildren();
      setStatus("Não foi possível abrir a memória local. Confira o suporte de armazenamento do navegador.", true);
    }
  }

  function renderEntry(entry, privateMode) {
    const article = document.createElement("article");
    article.className = "memory-entry";
    article.dataset.memoryId = entry.id;
    const head = document.createElement("div");
    head.className = "memory-entry-head";
    const badge = document.createElement("span");
    badge.className = "memory-category-badge";
    badge.textContent = categoryNames[entry.category] || "Fato";
    const date = document.createElement("time");
    date.dateTime = entry.updatedAt;
    date.textContent = formatDate(entry.updatedAt);
    head.append(badge, date);
    const content = document.createElement("p");
    content.className = "memory-entry-content";
    content.textContent = entry.content;
    const actions = document.createElement("div");
    actions.className = "memory-entry-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "memory-secondary-button";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => {
      if (privateMode) { setStatus("Desative o modo privado para editar memórias.", true); return; }
      const editor = document.createElement("textarea");
      editor.className = "memory-edit-field";
      editor.maxLength = 4000;
      editor.value = entry.content;
      editor.setAttribute("aria-label", "Editar memória");
      const save = document.createElement("button");
      save.type = "button";
      save.className = "memory-secondary-button is-primary";
      save.textContent = "Salvar";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "memory-secondary-button";
      cancel.textContent = "Cancelar";
      save.addEventListener("click", async () => {
        const text = editor.value.trim();
        if (!text) { setStatus("A memória não pode ficar vazia.", true); return; }
        try { await store.save({ ...entry, content: text, id: entry.id }); await refresh(); }
        catch { setStatus("Não foi possível editar esta memória.", true); }
      });
      cancel.addEventListener("click", () => void refresh());
      content.replaceWith(editor);
      actions.replaceChildren(save, cancel);
      editor.focus();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "memory-secondary-button is-danger";
    remove.textContent = "Apagar";
    remove.addEventListener("click", async () => {
      if (!window.confirm("Apagar esta memória deste dispositivo? Essa ação não pode ser desfeita.")) return;
      try { await store.remove(entry.id); await refresh(); }
      catch { setStatus("Não foi possível apagar esta memória.", true); }
    });
    actions.append(edit, remove);
    article.append(head, content, actions);
    return article;
  }

  async function initialize(userId) {
    const id = String(userId || "");
    if (!id) return false;
    if (store && activeUserId === id) { await refresh(); return true; }
    store?.close();
    activeUserId = id;
    store = null;
    setStatus("Preparando a memória criptografada deste dispositivo…");
    try {
      store = new core.KazerMemory(id);
      await store.ready();
      await refresh();
      return true;
    } catch {
      store = null;
      setStatus("Memória local indisponível neste navegador. Nenhuma memória foi enviada ao servidor.", true);
      return false;
    }
  }

  function download(filename, type, contents) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  privateSwitch?.addEventListener("click", async () => {
    if (!store) return setStatus("Entre na sua conta para usar a memória local.", true);
    try {
      const prefs = await store.getPreferences();
      await store.setPreferences({ privateMode: !prefs.privateMode });
      await refresh();
    } catch { setStatus("Não foi possível alterar o modo privado.", true); }
  });
  shareSwitch?.addEventListener("click", async () => {
    if (!store) return setStatus("Entre na sua conta para usar a memória local.", true);
    try {
      const prefs = await store.getPreferences();
      if (prefs.privateMode) return;
      await store.setPreferences({ shareContext: !prefs.shareContext });
      await refresh();
    } catch { setStatus("Não foi possível atualizar sua autorização.", true); }
  });
  search?.addEventListener("input", () => void refresh());
  categoryFilter?.addEventListener("change", () => void refresh());
  byId("memoryExportJson")?.addEventListener("click", async () => {
    if (!store) return setStatus("Entre na sua conta para exportar a memória.", true);
    try { download("kazer-memoria.json", "application/json;charset=utf-8", await store.exportJSON()); setStatus("Arquivo JSON exportado. Guarde-o em local seguro."); }
    catch { setStatus("Não foi possível exportar a memória.", true); }
  });
  byId("memoryExportMarkdown")?.addEventListener("click", async () => {
    if (!store) return setStatus("Entre na sua conta para exportar a memória.", true);
    try { download("kazer-memoria.md", "text/markdown;charset=utf-8", await store.exportMarkdown()); setStatus("Arquivo Markdown exportado. Guarde-o em local seguro."); }
    catch { setStatus("Não foi possível exportar a memória.", true); }
  });
  byId("memoryImportButton")?.addEventListener("click", () => importInput?.click());
  importInput?.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file || !store) return;
    try {
      const count = await store.importData(await file.text());
      setStatus(`${count} ${count === 1 ? "memória restaurada" : "memórias restauradas"} neste dispositivo.`);
      importInput.value = "";
      await refresh();
    } catch (error) {
      setStatus(error?.message || "Não foi possível importar este arquivo.", true);
      importInput.value = "";
    }
  });
  byId("memoryClearAll")?.addEventListener("click", async () => {
    if (!store) return setStatus("Entre na sua conta para apagar a memória.", true);
    if (!window.confirm("Apagar toda a memória criptografada deste dispositivo? Isso remove as memórias e a chave local, e não pode ser desfeito.")) return;
    try { await store.clear(); await refresh(); setStatus("Toda a memória local e sua chave de criptografia foram apagadas."); }
    catch { setStatus("Não foi possível apagar toda a memória.", true); }
  });

  window.KazerMemoryUI = {
    initialize,
    getStore: () => store,
    refresh,
    close() { store?.close(); store = null; activeUserId = ""; },
  };
})();
