/*
 * KAZER Engine — editor 2D inspirado no Godot, dentro do modo Computer.
 * Cena em JSON (```kazer-scene): árvore de nós, inspetor, viewport que roda
 * ao vivo e exportação para um projeto Godot 4 (.zip com project.godot,
 * main.tscn e scripts .gd). O KAZER edita a cena pelo chat.
 */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (message) => window.kazerShowToast ? window.kazerShowToast(message) : console.info(message);
  const store = {
    get(key, fallback = null) { try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  };

  const TYPES = ["Node2D", "Sprite2D", "StaticBody2D", "CharacterBody2D", "Area2D", "Label", "Camera2D"];
  const SCRIPTS = ["none", "platformer", "topdown", "patrol", "rotate", "bounce", "collectible", "hazard", "goal", "follow_player"];
  const TYPE_ICON = { Node2D: "○", Sprite2D: "▣", StaticBody2D: "▤", CharacterBody2D: "☺", Area2D: "◌", Label: "T", Camera2D: "◎" };

  const DEMO = {
    name: "Main",
    size: [960, 540],
    background: "#11212D",
    gravity: 1200,
    nodes: [
      { name: "Chao", type: "StaticBody2D", position: [0, 500], size: [1600, 40], color: "#253745", shape: "rect", script: "none" },
      { name: "Plataforma", type: "StaticBody2D", position: [320, 380], size: [180, 20], color: "#4A5C6A", shape: "rect", script: "none" },
      { name: "Plataforma2", type: "StaticBody2D", position: [600, 280], size: [180, 20], color: "#4A5C6A", shape: "rect", script: "patrol", props: { distance: 140, speed: 80 } },
      { name: "Jogador", type: "CharacterBody2D", position: [80, 420], size: [34, 46], color: "#CCD0CF", shape: "rect", script: "platformer", props: { speed: 280, jump: 620 } },
      { name: "Moeda", type: "Area2D", position: [395, 330], size: [22, 22], color: "#8fc3d6", shape: "circle", script: "collectible" },
      { name: "Moeda2", type: "Area2D", position: [680, 230], size: [22, 22], color: "#8fc3d6", shape: "circle", script: "collectible" },
      { name: "Espinho", type: "Area2D", position: [520, 482], size: [40, 18], color: "#ef8f8f", shape: "rect", script: "hazard" },
      { name: "Bandeira", type: "Area2D", position: [1500, 420], size: [30, 80], color: "#7fd1b0", shape: "rect", script: "goal" },
      { name: "Placar", type: "Label", position: [24, 20], size: [200, 30], color: "#eef1f1", text: "Moedas: {score}", script: "none" },
      { name: "Camera", type: "Camera2D", position: [0, 0], size: [960, 540], color: "#ffffff", script: "follow_player" },
    ],
  };

  /* ── Normalização da cena (dado não confiável vindo do modelo) ────── */
  const num = (value, fallback, min = -20000, max = 20000) => { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; };
  const hex = (value, fallback) => (/^#[0-9a-f]{3,8}$/i.test(String(value || "")) ? String(value) : fallback);
  const pair = (value, fallback, min, max) => (Array.isArray(value) ? [num(value[0], fallback[0], min, max), num(value[1], fallback[1], min, max)] : fallback);

  function normalizeScene(input) {
    const raw = typeof input === "string" ? JSON.parse(input) : input;
    if (!raw || typeof raw !== "object") throw new Error("Cena inválida");
    const used = new Set();
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).slice(0, 200).map((node, index) => {
      let name = String(node?.name || `No${index}`).replace(/[^\w-]/g, "").slice(0, 40) || `No${index}`;
      while (used.has(name)) name = `${name}_${index}`;
      used.add(name);
      const props = {};
      Object.entries(node?.props && typeof node.props === "object" ? node.props : {}).slice(0, 12).forEach(([key, value]) => { if (/^\w{1,24}$/.test(key) && Number.isFinite(Number(value))) props[key] = Number(value); });
      return {
        name,
        type: TYPES.includes(node?.type) ? node.type : "Sprite2D",
        position: pair(node?.position, [0, 0], -20000, 20000),
        size: pair(node?.size, [32, 32], 1, 8000),
        color: hex(node?.color, "#CCD0CF"),
        shape: node?.shape === "circle" ? "circle" : "rect",
        text: node?.text ? String(node.text).slice(0, 120) : undefined,
        script: SCRIPTS.includes(node?.script) ? node.script : "none",
        props,
      };
    });
    return {
      name: String(raw.name || "Main").replace(/[^\w-]/g, "").slice(0, 40) || "Main",
      size: pair(raw.size, [960, 540], 160, 4096),
      background: hex(raw.background, "#11212D"),
      gravity: num(raw.gravity, 1200, 0, 5000),
      nodes,
    };
  }

  let scene = (() => { try { return normalizeScene(store.get("kazer-engine-scene", DEMO)); } catch { return normalizeScene(DEMO); } })();
  let selected = scene.nodes.find((node) => node.type === "CharacterBody2D")?.name || scene.nodes[0]?.name || null;
  const save = () => store.set("kazer-engine-scene", scene);

  window.kazerEngineSceneContext = () => {
    let compact = JSON.stringify(scene);
    if (compact.length > 3400) compact = JSON.stringify({ ...scene, nodes: scene.nodes.slice(0, 40) }).slice(0, 3400);
    return `\n\nCENA ATUAL DA KAZER ENGINE (JSON, edite e devolva completa em \`\`\`kazer-scene):\n${compact}`;
  };

  /* ── Runtime ───────────────────────────────────────────────────────── */
  function createRuntime(canvas, sceneData, { onLog = () => {}, interactive = true } = {}) {
    const ctx = canvas.getContext("2d");
    const keys = new Set();
    const touch = { left: false, right: false, jump: false, up: false, down: false };
    let world;
    let raf = 0;
    let last = 0;
    let running = false;
    const state = { score: 0, won: false, message: "" };

    const reset = () => {
      world = sceneData.nodes.map((node) => ({ ...node, x: node.position[0], y: node.position[1], w: node.size[0], h: node.size[1], vx: 0, vy: 0, rot: 0, alive: true, onFloor: false, origin: [...node.position], dir: 1, props: { ...node.props } }));
      world.filter((node) => node.script === "bounce").forEach((node) => { node.vx = node.props.speed || 160; node.vy = (node.props.speed || 160) * 0.8; });
      state.score = 0;
      state.won = false;
      state.message = "";
    };
    const solids = () => world.filter((node) => node.alive && node.type === "StaticBody2D");
    const player = () => world.find((node) => node.alive && (node.script === "platformer" || node.script === "topdown")) || world.find((node) => node.type === "CharacterBody2D");
    const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const input = () => ({
      left: keys.has("ArrowLeft") || keys.has("KeyA") || touch.left,
      right: keys.has("ArrowRight") || keys.has("KeyD") || touch.right,
      up: keys.has("ArrowUp") || keys.has("KeyW") || touch.up,
      down: keys.has("ArrowDown") || keys.has("KeyS") || touch.down,
      jump: keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW") || touch.jump,
    });

    const moveAndCollide = (body, dt) => {
      body.x += body.vx * dt;
      for (const solid of solids()) if (solid !== body && overlap(body, solid)) { body.x = body.vx > 0 ? solid.x - body.w : solid.x + solid.w; body.vx = 0; }
      body.y += body.vy * dt;
      body.onFloor = false;
      for (const solid of solids()) {
        if (solid !== body && overlap(body, solid)) {
          if (body.vy > 0) { body.y = solid.y - body.h; body.onFloor = true; body.x += (solid.dx || 0); }
          else body.y = solid.y + solid.h;
          body.vy = 0;
        }
      }
    };

    const step = (dt) => {
      const keysNow = input();
      const hero = player();
      for (const node of world) {
        if (!node.alive) continue;
        const speed = node.props.speed;
        node.dx = 0;
        switch (node.script) {
          case "platformer":
            node.vx = ((keysNow.right ? 1 : 0) - (keysNow.left ? 1 : 0)) * (speed || 260);
            node.vy += sceneData.gravity * dt;
            if (keysNow.jump && node.onFloor) node.vy = -(node.props.jump || 560);
            moveAndCollide(node, dt);
            if (node.y > Math.max(sceneData.size[1], ...world.map((item) => item.y + item.h)) + 300) { onLog("Caiu! Reiniciando."); reset(); return; }
            break;
          case "topdown":
            node.vx = ((keysNow.right ? 1 : 0) - (keysNow.left ? 1 : 0)) * (speed || 220);
            node.vy = ((keysNow.down ? 1 : 0) - (keysNow.up ? 1 : 0)) * (speed || 220);
            moveAndCollide(node, dt);
            break;
          case "patrol": {
            const before = node.x;
            node.x += node.dir * (speed || 80) * dt;
            if (Math.abs(node.x - node.origin[0]) > (node.props.distance || 120)) node.dir *= -1;
            node.dx = node.x - before;
            break;
          }
          case "rotate": node.rot += ((speed || 90) * Math.PI / 180) * dt; break;
          case "bounce":
            node.x += node.vx * dt; node.y += node.vy * dt;
            if (node.x < 0 || node.x + node.w > sceneData.size[0]) node.vx *= -1;
            if (node.y < 0 || node.y + node.h > sceneData.size[1]) node.vy *= -1;
            break;
          case "follow_player":
            if (hero && node.type !== "Camera2D") { const sp = speed || 90; node.x += Math.sign(hero.x - node.x) * sp * dt; node.y += Math.sign(hero.y - node.y) * sp * dt; }
            break;
          default: break;
        }
      }
      if (hero) {
        for (const area of world) {
          if (!area.alive || area === hero || !overlap(hero, area)) continue;
          if (area.script === "collectible") { area.alive = false; state.score += Number(area.props.value) || 1; onLog(`+1 ponto (${state.score})`); }
          if (area.script === "hazard" || (area.script === "follow_player" && area.type !== "Camera2D")) { onLog(`${area.name} pegou o jogador. Reiniciando.`); reset(); return; }
          if (area.script === "goal" && !state.won) { state.won = true; state.message = "Você venceu!"; onLog("Objetivo alcançado 🎉"); }
        }
      }
    };

    const draw = () => {
      const [vw, vh] = sceneData.size;
      const scale = Math.min(canvas.width / vw, canvas.height / vh);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#040e13";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.translate((canvas.width - vw * scale) / 2, (canvas.height - vh * scale) / 2);
      ctx.scale(scale, scale);
      ctx.beginPath(); ctx.rect(0, 0, vw, vh); ctx.clip();
      ctx.fillStyle = sceneData.background;
      ctx.fillRect(0, 0, vw, vh);
      const hero = player();
      const camera = world.find((node) => node.type === "Camera2D");
      const camX = camera && hero ? Math.max(0, hero.x + hero.w / 2 - vw / 2) : 0;
      const camY = camera && hero ? Math.min(0, hero.y + hero.h / 2 - vh / 2) : 0;
      ctx.save();
      ctx.translate(-camX, -camY);
      for (const node of world) {
        if (!node.alive || node.type === "Camera2D" || node.type === "Label" || node.type === "Node2D") continue;
        ctx.save();
        ctx.translate(node.x + node.w / 2, node.y + node.h / 2);
        ctx.rotate(node.rot);
        ctx.fillStyle = node.color;
        if (node.shape === "circle") { ctx.beginPath(); ctx.ellipse(0, 0, node.w / 2, node.h / 2, 0, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.beginPath(); ctx.roundRect?.(-node.w / 2, -node.h / 2, node.w, node.h, Math.min(6, node.w / 4, node.h / 4)) || ctx.rect(-node.w / 2, -node.h / 2, node.w, node.h); ctx.fill(); }
        if (node.type === "CharacterBody2D") { ctx.fillStyle = "#06141B"; ctx.fillRect(node.w * 0.08, -node.h * 0.22, node.w * 0.16, node.h * 0.12); ctx.fillRect(-node.w * 0.24, -node.h * 0.22, node.w * 0.16, node.h * 0.12); }
        if (!running && interactive && node.name === selected) { ctx.strokeStyle = "#8fc3d6"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(-node.w / 2 - 3, -node.h / 2 - 3, node.w + 6, node.h + 6); ctx.setLineDash([]); }
        ctx.restore();
      }
      ctx.restore();
      for (const node of world) {
        if (node.type !== "Label") continue;
        ctx.fillStyle = node.color;
        ctx.font = `600 ${Math.max(12, Math.min(48, node.h * 0.7))}px Geist, system-ui, sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(String(node.text || node.name).replace("{score}", state.score), node.x, node.y);
      }
      if (state.message) {
        ctx.fillStyle = "rgba(6,20,27,.7)"; ctx.fillRect(0, vh / 2 - 44, vw, 88);
        ctx.fillStyle = "#eef1f1"; ctx.font = "700 40px Geist, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(state.message, vw / 2, vh / 2); ctx.textAlign = "left";
      }
    };

    const loop = (time) => {
      const dt = Math.min(0.033, (time - last) / 1000 || 0);
      last = time;
      if (running) step(dt);
      draw();
      raf = requestAnimationFrame(loop);
    };
    const onKey = (event) => {
      if (!running) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(event.code)) event.preventDefault();
      if (event.type === "keydown") keys.add(event.code); else keys.delete(event.code);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    reset();
    raf = requestAnimationFrame(loop);
    return {
      play() { reset(); running = true; keys.clear(); },
      stop() { running = false; reset(); },
      get running() { return running; },
      touch,
      setScene(next) { sceneData = next; reset(); },
      destroy() { cancelAnimationFrame(raf); window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey); },
      pick(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const [vw, vh] = sceneData.size;
        const scale = Math.min(canvas.width / vw, canvas.height / vh);
        const ratio = canvas.width / rect.width;
        const x = ((clientX - rect.left) * ratio - (canvas.width - vw * scale) / 2) / scale;
        const y = ((clientY - rect.top) * ratio - (canvas.height - vh * scale) / 2) / scale;
        const hit = [...world].reverse().find((node) => node.type !== "Camera2D" && x >= node.x && x <= node.x + node.w && y >= node.y && y <= node.y + node.h);
        return hit?.name || null;
      },
    };
  }

  /* ── Exportação Godot 4 ───────────────────────────────────────────── */
  const GD = {
    platformer: `extends CharacterBody2D\n\n@export var speed := 280.0\n@export var jump := 620.0\nvar gravity: float = ProjectSettings.get_setting("physics/2d/default_gravity")\n\nfunc _ready() -> void:\n\tadd_to_group("player")\n\nfunc _physics_process(delta: float) -> void:\n\tif not is_on_floor():\n\t\tvelocity.y += gravity * delta\n\tif Input.is_action_just_pressed("ui_accept") or (Input.is_action_just_pressed("ui_up") and is_on_floor()):\n\t\tif is_on_floor():\n\t\t\tvelocity.y = -jump\n\tvelocity.x = Input.get_axis("ui_left", "ui_right") * speed\n\tmove_and_slide()\n\tif global_position.y > 3000:\n\t\tget_tree().reload_current_scene()\n`,
    topdown: `extends CharacterBody2D\n\n@export var speed := 220.0\n\nfunc _ready() -> void:\n\tadd_to_group("player")\n\nfunc _physics_process(_delta: float) -> void:\n\tvelocity = Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down") * speed\n\tmove_and_slide()\n`,
    patrol: `extends Node2D\n\n@export var distance := 120.0\n@export var speed := 80.0\nvar origin: Vector2\nvar dir := 1.0\n\nfunc _ready() -> void:\n\torigin = position\n\nfunc _physics_process(delta: float) -> void:\n\tposition.x += dir * speed * delta\n\tif abs(position.x - origin.x) > distance:\n\t\tdir = -dir\n`,
    rotate: `extends Node2D\n\n@export var speed := 90.0\n\nfunc _process(delta: float) -> void:\n\trotation_degrees += speed * delta\n`,
    bounce: `extends Node2D\n\n@export var speed := 160.0\nvar velocity := Vector2.ONE\n\nfunc _ready() -> void:\n\tvelocity = Vector2(speed, speed * 0.8)\n\nfunc _process(delta: float) -> void:\n\tposition += velocity * delta\n\tvar size := get_viewport_rect().size\n\tif position.x < 0 or position.x > size.x:\n\t\tvelocity.x = -velocity.x\n\tif position.y < 0 or position.y > size.y:\n\t\tvelocity.y = -velocity.y\n`,
    collectible: `extends Area2D\n\n@export var value := 1\n\nfunc _ready() -> void:\n\tbody_entered.connect(_on_body_entered)\n\nfunc _on_body_entered(body: Node) -> void:\n\tif body.is_in_group("player"):\n\t\tvar root := get_tree().current_scene\n\t\troot.set_meta("score", int(root.get_meta("score", 0)) + value)\n\t\tqueue_free()\n`,
    hazard: `extends Area2D\n\nfunc _ready() -> void:\n\tbody_entered.connect(_on_body_entered)\n\nfunc _on_body_entered(body: Node) -> void:\n\tif body.is_in_group("player"):\n\t\tget_tree().call_deferred("reload_current_scene")\n`,
    goal: `extends Area2D\n\nfunc _ready() -> void:\n\tbody_entered.connect(_on_body_entered)\n\nfunc _on_body_entered(body: Node) -> void:\n\tif body.is_in_group("player"):\n\t\tvar label := Label.new()\n\t\tlabel.text = "Você venceu!"\n\t\tlabel.add_theme_font_size_override("font_size", 40)\n\t\tget_tree().current_scene.add_child(label)\n\t\tlabel.global_position = global_position + Vector2(-80, -120)\n`,
    follow_player: `extends Node2D\n\n@export var speed := 90.0\n\nfunc _process(delta: float) -> void:\n\tvar player := get_tree().get_first_node_in_group("player") as Node2D\n\tif player:\n\t\tglobal_position = global_position.move_toward(player.global_position, speed * delta)\n`,
    score_label: `extends Label\n\nvar template := ""\n\nfunc _ready() -> void:\n\ttemplate = text\n\nfunc _process(_delta: float) -> void:\n\ttext = template.replace("{score}", str(get_tree().current_scene.get_meta("score", 0)))\n`,
  };

  const EXPORTS = { platformer: ["speed", "jump"], topdown: ["speed"], patrol: ["distance", "speed"], rotate: ["speed"], bounce: ["speed"], collectible: ["value"], follow_player: ["speed"] };

  const color = (value) => {
    let h = String(value).replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const [r, g, b] = [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255 || 0).toFixed(3));
    return `Color(${r}, ${g}, ${b}, 1)`;
  };

  function exportGodot(sceneData) {
    const usedScripts = new Set();
    const ext = [];
    const subs = [];
    const lines = [];
    const scriptId = (name) => {
      if (!usedScripts.has(name)) { usedScripts.add(name); ext.push(`[ext_resource type="Script" path="res://scripts/${name}.gd" id="s_${name}"]`); }
      return `ExtResource("s_${name}")`;
    };
    const hero = sceneData.nodes.find((node) => node.script === "platformer" || node.script === "topdown");
    lines.push(`[node name="${sceneData.name}" type="Node2D"]`, "");
    sceneData.nodes.forEach((node, index) => {
      const [w, h] = node.size;
      const center = `Vector2(${node.position[0] + w / 2}, ${node.position[1] + h / 2})`;
      // A câmera vira filha do jogador; é escrita no fim, depois do pai existir.
      if (node.type === "Camera2D") return;
      if (node.type === "Label") {
        lines.push(`[node name="${node.name}" type="Label" parent="."]`, `offset_left = ${node.position[0]}`, `offset_top = ${node.position[1]}`, `offset_right = ${node.position[0] + w}`, `offset_bottom = ${node.position[1] + h}`, `text = ${JSON.stringify(node.text || node.name)}`, `theme_override_colors/font_color = ${color(node.color)}`);
        if (String(node.text || "").includes("{score}")) lines.push(`script = ${scriptId("score_label")}`);
        lines.push("");
        return;
      }
      // O tipo segue o script para o Godot aceitar o "extends" de cada .gd.
      const godotType = ["collectible", "hazard", "goal"].includes(node.script) ? "Area2D" : ["platformer", "topdown"].includes(node.script) ? "CharacterBody2D" : node.type === "Sprite2D" ? "Node2D" : node.type;
      lines.push(`[node name="${node.name}" type="${godotType}" parent="."]`, `position = ${center}`);
      if (node.script !== "none") lines.push(`script = ${scriptId(node.script)}`);
      Object.entries(node.props || {}).filter(([key]) => (EXPORTS[node.script] || []).includes(key)).forEach(([key, value]) => lines.push(`${key} = ${key === "value" ? Math.round(Number(value)) : Number(value).toFixed(1)}`));
      lines.push("");
      if (node.shape === "circle") {
        subs.push(`[sub_resource type="CircleShape2D" id="shape_${index}"]\nradius = ${Math.max(w, h) / 2}\n`);
      } else {
        subs.push(`[sub_resource type="RectangleShape2D" id="shape_${index}"]\nsize = Vector2(${w}, ${h})\n`);
      }
      lines.push(`[node name="Visual" type="ColorRect" parent="${node.name}"]`, `offset_left = ${-w / 2}`, `offset_top = ${-h / 2}`, `offset_right = ${w / 2}`, `offset_bottom = ${h / 2}`, `color = ${color(node.color)}`, "");
      if (["StaticBody2D", "CharacterBody2D", "Area2D"].includes(godotType)) lines.push(`[node name="Shape" type="CollisionShape2D" parent="${node.name}"]`, `shape = SubResource("shape_${index}")`, "");
    });
    const camera = sceneData.nodes.find((node) => node.type === "Camera2D");
    if (camera && hero) lines.push(`[node name="${camera.name}" type="Camera2D" parent="${hero.name}"]`, "");
    const tscn = [`[gd_scene load_steps=${ext.length + subs.length + 1} format=3]`, "", ...ext, ext.length ? "" : null, ...subs, ...lines].filter((line) => line !== null).join("\n");
    const project = `; Projeto gerado pela KAZER Engine\nconfig_version=5\n\n[application]\nconfig/name="${sceneData.name}"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.3")\n\n[display]\nwindow/size/viewport_width=${sceneData.size[0]}\nwindow/size/viewport_height=${sceneData.size[1]}\n\n[physics]\n2d/default_gravity=${sceneData.gravity}.0\n\n[rendering]\nenvironment/defaults/default_clear_color=${color(sceneData.background)}\n`;
    const files = [
      { path: "project.godot", content: project },
      { path: "main.tscn", content: tscn },
      { path: "README.md", content: `# ${sceneData.name}\n\nProjeto Godot 4 exportado pela KAZER Engine.\n\n1. Abra o Godot 4.3+ e escolha **Importar** → selecione \`project.godot\`.\n2. Aperte F5 para jogar. Setas/WASD movem; espaço pula.\n\nA cena original (JSON da KAZER Engine) está em \`kazer-scene.json\`.\n` },
      { path: "kazer-scene.json", content: JSON.stringify(sceneData, null, 2) },
      ...[...usedScripts].map((name) => ({ path: `scripts/${name}.gd`, content: GD[name] })),
    ];
    return files;
  }
  window.kazerExportGodot = (sceneData) => {
    const files = exportGodot(sceneData);
    window.kazerDownload?.(window.kazerCreateZip(files), `${sceneData.name.toLowerCase()}-godot.zip`);
    toast("Projeto Godot 4 exportado (.zip)");
  };

  /* ── Painel do editor ──────────────────────────────────────────────── */
  let panel = null;
  let runtime = null;

  function log(message) {
    const out = panel && $(".kz-eng-log", panel);
    if (!out) return;
    const line = document.createElement("div");
    line.textContent = `› ${message}`;
    out.append(line);
    out.scrollTop = out.scrollHeight;
  }

  function renderTree() {
    const tree = $(".kz-eng-tree", panel);
    tree.innerHTML = `<button type="button" class="kz-eng-root">◇ ${escapeHtml(scene.name)}</button>${scene.nodes.map((node, index) => `<button type="button" data-node="${escapeHtml(node.name)}" class="${node.name === selected ? "is-active" : ""}" style="--kz-li:${index}"><i>${TYPE_ICON[node.type] || "○"}</i><span>${escapeHtml(node.name)}</span>${node.script !== "none" ? `<em>${escapeHtml(node.script)}</em>` : ""}</button>`).join("")}`;
  }

  function renderInspector() {
    const box = $(".kz-eng-inspector", panel);
    const node = scene.nodes.find((item) => item.name === selected);
    if (!node) { box.innerHTML = `<p class="kz-eng-empty">Selecione um nó.</p><label>Gravidade<input data-scene="gravity" type="number" value="${scene.gravity}"></label><label>Fundo<input data-scene="background" type="color" value="${scene.background.slice(0, 7)}"></label>`; return; }
    box.innerHTML = `<h4>${TYPE_ICON[node.type]} ${escapeHtml(node.type)}</h4>
      <label>Nome<input data-field="name" value="${escapeHtml(node.name)}"></label>
      <label>Tipo<select data-field="type">${TYPES.map((type) => `<option${type === node.type ? " selected" : ""}>${type}</option>`).join("")}</select></label>
      <div class="kz-eng-pair"><label>X<input data-field="x" type="number" value="${node.position[0]}"></label><label>Y<input data-field="y" type="number" value="${node.position[1]}"></label></div>
      <div class="kz-eng-pair"><label>Largura<input data-field="w" type="number" value="${node.size[0]}"></label><label>Altura<input data-field="h" type="number" value="${node.size[1]}"></label></div>
      <div class="kz-eng-pair"><label>Cor<input data-field="color" type="color" value="${node.color.slice(0, 7)}"></label><label>Forma<select data-field="shape"><option${node.shape === "rect" ? " selected" : ""} value="rect">Retângulo</option><option${node.shape === "circle" ? " selected" : ""} value="circle">Círculo</option></select></label></div>
      <label>Script<select data-field="script">${SCRIPTS.map((script) => `<option${script === node.script ? " selected" : ""}>${script}</option>`).join("")}</select></label>
      ${node.type === "Label" ? `<label>Texto<input data-field="text" value="${escapeHtml(node.text || "")}"></label>` : ""}
      <label>Props (JSON)<input data-field="props" value="${escapeHtml(JSON.stringify(node.props || {}))}"></label>
      <button class="kz-btn is-danger" type="button" data-delete>Excluir nó</button>`;
  }

  function applyScene(next, { announce = false } = {}) {
    scene = normalizeScene(next);
    if (!scene.nodes.some((node) => node.name === selected)) selected = scene.nodes[0]?.name || null;
    save();
    if (panel) { renderTree(); renderInspector(); runtime?.setScene(scene); $(".kz-eng-scene-name", panel).textContent = scene.name; }
    if (announce) log(`Cena "${scene.name}" carregada (${scene.nodes.length} nós).`);
  }
  window.kazerLoadScene = (next) => { applyScene(next, { announce: true }); openEngine(); };

  function openEngine() {
    window.kazerEngineMode = true;
    document.body.classList.add("kz-engine-open");
    document.querySelector(".kz-engine-toggle")?.setAttribute("aria-pressed", "true");
    if (panel) { panel.hidden = false; return; }
    panel = document.createElement("section");
    panel.className = "kz-engine";
    panel.setAttribute("aria-label", "KAZER Engine");
    panel.innerHTML = `<header class="kz-eng-bar"><span class="kz-eng-brand">◆ KAZER Engine</span><span class="kz-eng-scene-name">${escapeHtml(scene.name)}</span><div class="kz-eng-run"><button class="kz-btn is-primary" type="button" data-play>▶ Jogar</button><button class="kz-btn" type="button" data-stop>■ Parar</button></div><div class="kz-eng-tools"><button class="kz-btn" type="button" data-add>+ Nó</button><button class="kz-btn" type="button" data-demo>Exemplo</button><button class="kz-btn" type="button" data-export>Exportar Godot 4</button><button class="kz-btn" type="button" data-close aria-label="Fechar Engine">✕</button></div></header>
      <aside class="kz-eng-left"><h3>Cena</h3><div class="kz-eng-tree"></div></aside>
      <main class="kz-eng-center"><canvas class="kz-eng-canvas" width="1280" height="720"></canvas><div class="kz-eng-pad" aria-hidden="true"><button data-pad="left">◀</button><button data-pad="right">▶</button><button data-pad="jump">⤒</button></div></main>
      <aside class="kz-eng-right"><h3>Inspetor</h3><div class="kz-eng-inspector"></div></aside>
      <footer class="kz-eng-bottom"><div class="kz-eng-log" role="log"></div><form class="kz-eng-ask"><input placeholder="Peça ao KAZER: “adicione inimigos que patrulham”, “mude para um jogo top-down”…" aria-label="Pedir mudança na cena"><button class="kz-btn is-primary" type="submit">Enviar</button></form></footer>`;
    document.body.append(panel);
    const canvas = $("canvas", panel);
    runtime = createRuntime(canvas, scene, { onLog: log });
    renderTree();
    renderInspector();
    log("Engine pronta. Setas/WASD movem, espaço pula. Peça mudanças ao KAZER aqui embaixo.");

    panel.addEventListener("click", (event) => {
      const nodeButton = event.target.closest("[data-node]");
      if (nodeButton) { selected = nodeButton.dataset.node; renderTree(); renderInspector(); return; }
      if (event.target.closest(".kz-eng-root")) { selected = null; renderTree(); renderInspector(); return; }
      if (event.target.closest("[data-play]")) { runtime.play(); panel.classList.add("is-playing"); log("▶ Rodando"); canvas.focus(); return; }
      if (event.target.closest("[data-stop]")) { runtime.stop(); panel.classList.remove("is-playing"); log("■ Parado"); return; }
      if (event.target.closest("[data-export]")) { window.kazerExportGodot(scene); return; }
      if (event.target.closest("[data-demo]")) { applyScene(DEMO, { announce: true }); return; }
      if (event.target.closest("[data-close]")) { closeEngine(); return; }
      if (event.target.closest("[data-add]")) {
        const name = `No${scene.nodes.length + 1}`;
        scene.nodes.push({ name, type: "Sprite2D", position: [scene.size[0] / 2 - 20, scene.size[1] / 2 - 20], size: [40, 40], color: "#9BA8AB", shape: "rect", script: "none", props: {} });
        selected = name;
        applyScene(scene);
        return;
      }
      if (event.target.closest("[data-delete]")) { scene.nodes = scene.nodes.filter((node) => node.name !== selected); selected = null; applyScene(scene); }
    });
    canvas.addEventListener("pointerdown", (event) => {
      if (runtime.running) return;
      const hit = runtime.pick(event.clientX, event.clientY);
      if (hit) { selected = hit; renderTree(); renderInspector(); }
    });
    panel.addEventListener("change", (event) => {
      const field = event.target.dataset.field;
      const sceneField = event.target.dataset.scene;
      if (sceneField) { scene[sceneField] = sceneField === "gravity" ? Number(event.target.value) : event.target.value; applyScene(scene); return; }
      const node = scene.nodes.find((item) => item.name === selected);
      if (!node || !field) return;
      const value = event.target.value;
      if (field === "x") node.position[0] = Number(value);
      else if (field === "y") node.position[1] = Number(value);
      else if (field === "w") node.size[0] = Number(value);
      else if (field === "h") node.size[1] = Number(value);
      else if (field === "props") { try { node.props = JSON.parse(value || "{}"); } catch { toast("Props precisam ser JSON."); return; } }
      else if (field === "name") { node.name = value; selected = value.replace(/[^\w-]/g, "") || node.name; }
      else node[field] = value;
      applyScene(scene);
    });
    panel.querySelectorAll("[data-pad]").forEach((button) => {
      const key = button.dataset.pad;
      const set = (on) => (event) => { event.preventDefault(); runtime.touch[key] = on; };
      button.addEventListener("pointerdown", set(true));
      ["pointerup", "pointerleave", "pointercancel"].forEach((type) => button.addEventListener(type, set(false)));
    });
    $(".kz-eng-ask", panel).addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("input", event.currentTarget);
      const text = input.value.trim();
      if (!text) return;
      const message = document.getElementById("messageInput");
      if (!message) return;
      if (window.kazerChatMode !== "computer") window.kazerSetMode?.("computer");
      message.value = text;
      message.dispatchEvent(new Event("input"));
      document.getElementById("sendButton")?.click();
      input.value = "";
      log(`Você: ${text}`);
      log("KAZER está editando a cena…");
    });
  }

  function closeEngine() {
    window.kazerEngineMode = false;
    document.body.classList.remove("kz-engine-open");
    document.querySelector(".kz-engine-toggle")?.setAttribute("aria-pressed", "false");
    runtime?.stop();
    if (panel) panel.hidden = true;
  }
  window.kazerOpenEngine = openEngine;
  window.kazerCloseEngine = closeEngine;

  /* ── Botão "Engine" no composer (só no modo Computer) ──────────────── */
  // O Computer liga a Engine sozinho quando o pedido é um jogo (chat.html);
  // não há mais botão separado no campo de mensagem.
  const modes = null;
  if (modes && !document.querySelector(".kz-engine-toggle")) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "kz-engine-toggle";
    toggle.setAttribute("aria-pressed", "false");
    toggle.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><rect x="2" y="6" width="20" height="12" rx="6"/></svg><span>Engine</span>`;
    toggle.title = "KAZER Engine (estilo Godot)";
    toggle.addEventListener("click", () => (window.kazerEngineMode ? closeEngine() : openEngine()));
    modes.after(toggle);
  }

  /* ── Card de cena nas mensagens ────────────────────────────────────── */
  window.kazerRenderSceneCard = (code, { writing = false } = {}) => {
    const card = document.createElement("section");
    card.className = "kz-scene-card";
    let parsed = null;
    try { parsed = normalizeScene(code); } catch { parsed = null; }
    if (!parsed) {
      card.innerHTML = `<p>${writing ? "Montando a cena…" : "A cena recebida não é um JSON válido."}</p>`;
      return card;
    }
    card.innerHTML = `<canvas width="480" height="270"></canvas><div><strong>◆ ${escapeHtml(parsed.name)}</strong><small>${parsed.nodes.length} nós · ${parsed.size[0]}×${parsed.size[1]}</small><div class="kz-scene-actions"><button class="kz-btn is-primary" type="button" data-open>Abrir na Engine</button><button class="kz-btn" type="button" data-godot>Exportar Godot 4</button></div></div>`;
    const preview = createRuntime($("canvas", card), parsed, { interactive: false });
    window.setTimeout(() => preview.destroy(), 400);
    $("[data-open]", card).addEventListener("click", () => window.kazerLoadScene(parsed));
    $("[data-godot]", card).addEventListener("click", () => window.kazerExportGodot(parsed));
    if (!writing && window.kazerEngineMode) window.setTimeout(() => window.kazerLoadScene(parsed), 50);
    return card;
  };
})();
