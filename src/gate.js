// Zugangscode-Sperre (nur Schranke im Browser, kein echter Serverschutz).
// Das Skript im data-app-Attribut wird erst nach korrektem Code geladen.
(function () {
  const me = document.currentScript, app = me.dataset.app;
  const G = window.GATE, KEY = "zentrale-unlock";
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  async function derive(code) {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveBits"]);
    const salt = new Uint8Array(G.salt.match(/../g).map((h) => parseInt(h, 16)));
    return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: G.iter, hash: "SHA-256" }, k, 256));
  }
  const start = () => { document.documentElement.classList.remove("locked"); const s = document.createElement("script"); s.src = app; document.body.appendChild(s); };
  const ok = () => localStorage.getItem(KEY) === G.hash;
  if (!crypto.subtle) { document.body.innerHTML = "<p style='padding:20px'>Bitte die Seite über https öffnen.</p>"; return; }
  if (ok()) return start();
  document.documentElement.classList.add("locked");
  const box = document.createElement("div");
  box.id = "gate";
  box.innerHTML = `<form><h2>🔒 Zugangscode</h2><input id="gc" type="password" autocomplete="off" autocapitalize="characters" placeholder="Code eingeben" autofocus><button>Öffnen</button><p id="ge"></p></form>`;
  document.body.appendChild(box);
  box.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const h = await derive(box.querySelector("#gc").value.trim().toUpperCase());
    if (h === G.hash) { localStorage.setItem(KEY, h); box.remove(); start(); }
    else box.querySelector("#ge").textContent = "Falscher Code";
  };
})();
