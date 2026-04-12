/**
 * history-panel.js — EONS Studio
 * ─────────────────────────────────────────────────────────────────────────────
 * Adds a conversation history panel to studio-ai.html.
 *
 * Add this script AFTER all other scripts in studio-ai.html, before </body>.
 *
 * What it does:
 *  1. Adds a History button to desktop sidebar and mobile bottom nav
 *  2. Slide-in history drawer showing all past sessions
 *  3. Each session shows AI-generated summary, date, brand name
 *  4. Clicking a session fully restores: messages, DNA, phase, brand context
 *  5. Saves conversations to KV with full state on every send
 */

(function () {
  "use strict";

  const WORKER = "https://eons-api-proxy.ryanruichen03.workers.dev";

  // ── User token (allows user to read only their own conversations) ─────────
  async function getUserToken(email) {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("eons_user_2025" + email.toLowerCase().trim())
    );
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // ── Generate session summary from first user message ─────────────────────
  function generateSummary(messages, dna) {
    if (dna && dna.brandName) {
      const type = messages.find(m => {
        const c = typeof m.content === "string" ? m.content : (m.content?.[0]?.text || "");
        return m.role === "user" && c.length > 10;
      });
      const firstMsg = type ? (typeof type.content === "string" ? type.content : (type.content?.[0]?.text || "")) : "";
      return (dna.brandName + " — " + firstMsg.slice(0, 60)).trim();
    }
    const first = messages.find(m => m.role === "user");
    if (!first) return "New conversation";
    const text = typeof first.content === "string" ? first.content : (first.content?.[0]?.text || "");
    return text.slice(0, 80) || "New conversation";
  }

  // ── Save full conversation to KV ─────────────────────────────────────────
  async function saveConvToKV() {
    const S = window.S;
    if (!S || !S.user || !S.messages || S.messages.length === 0) return;

    const transcript = S.messages
      .map(m => m.role.toUpperCase() + ": " + (typeof m.content === "string" ? m.content : (m.content?.[0]?.text || "")))
      .join("\n\n");

    const summary = generateSummary(S.messages, S.dna);

    try {
      await fetch(`${WORKER}/conv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sid:        S.sessionId,
          name:       S.user.name,
          email:      S.user.email,
          brand:      S.dna?.brandName || S.user.company || "",
          type:       "explore",
          summary,
          transcript,
          messages:   S.messages,   // full message array for restoration
          dna:        S.dna,        // full DNA snapshot
          phase:      S.phase,
          sections:   S.sections,
        }),
      });
    } catch (err) {
      console.warn("[History] KV save failed:", err.message);
    }
  }

  // ── Load user's conversation list from KV ─────────────────────────────────
  async function loadUserHistory(email) {
    const token = await getUserToken(email);
    try {
      const res  = await fetch(`${WORKER}/user-convs/${encodeURIComponent(email)}`, {
        headers: { "X-User-Token": token },
      });
      const json = await res.json();
      return json.data || [];
    } catch (err) {
      console.warn("[History] Load failed:", err.message);
      return [];
    }
  }

  // ── Load a single full conversation from KV ───────────────────────────────
  async function loadConvFromKV(id, email) {
    const token = await getUserToken(email);
    try {
      const res  = await fetch(`${WORKER}/conv/${id}`, {
        headers: { "X-User-Token": token },
      });
      const json = await res.json();
      return json.data || null;
    } catch (err) {
      console.warn("[History] Conv load failed:", err.message);
      return null;
    }
  }

  // ── Format date ───────────────────────────────────────────────────────────
  function fmtDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    const diff = Math.floor((now - d) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7)  return diff + " days ago";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // ── Restore a conversation into the chat ──────────────────────────────────
  async function restoreConversation(convId) {
    const S = window.S;
    if (!S || !S.user) return;

    // Show loading state
    const panel = document.getElementById("historyPanel");
    const loadingEl = document.getElementById("historyLoading");
    if (loadingEl) loadingEl.style.display = "flex";

    const conv = await loadConvFromKV(convId, S.user.email);

    if (loadingEl) loadingEl.style.display = "none";

    if (!conv) {
      alert("Couldn't load this conversation. It may have expired.");
      return;
    }

    // Close history panel
    closeHistory();

    // Save current conversation first
    await saveConvToKV();

    // Restore state
    S.messages  = conv.messages || [];
    S.dna       = { ...S.dna, ...(conv.dna || {}) };
    S.phase     = conv.phase || 1;
    S.sections  = conv.sections || 0;
    S.sessionId = conv.id;
    S.turn      = S.messages.length;

    // Clear and re-render chat
    const chatMsgs = document.getElementById("chatMessages");
    if (chatMsgs) chatMsgs.innerHTML = "";

    // Re-render all messages
    S.messages.forEach(m => {
      const text = typeof m.content === "string" ? m.content : (m.content?.[0]?.text || "");
      const clean = text.replace(/<DNA>[\s\S]*?<\/DNA>/g, "").trim();
      if (clean && typeof window.addMsg === "function") {
        window.addMsg(m.role, clean);
      }
    });

    // Restore DNA and passport
    if (conv.dna && typeof window.restorePassport === "function") {
      window.restorePassport();
    }

    // Restore session label
    const sessionEl = document.getElementById("cvhSession");
    if (sessionEl) sessionEl.textContent = (conv.brand || "Restored Session") + " — Continued";

    // Restore context buttons
    if (typeof window.renderCtxButtons === "function") {
      window.renderCtxButtons();
    }

    // Restore output panel if there was a generated doc
    document.getElementById("outputPanel")?.classList.remove("open");
    document.getElementById("conceptPanel")?.classList.remove("open");

    // Scroll to bottom
    setTimeout(() => {
      if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
    }, 100);

    // Show toast
    if (typeof window.toast === "function") {
      window.toast("Session Restored ✓", "Continue where you left off.");
    }
  }

  // ── Build the history panel HTML ──────────────────────────────────────────
  function buildHistoryPanel() {
    if (document.getElementById("historyPanel")) return;

    const panel = document.createElement("div");
    panel.id = "historyPanel";
    panel.style.cssText = `
      position: fixed;
      top: 0; right: 0; bottom: 0;
      width: 340px;
      max-width: 100vw;
      background: var(--sidebar-bg, rgba(5,4,14,.97));
      border-left: 1px solid var(--border);
      z-index: 1500;
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform .35s cubic-bezier(.4,0,.2,1);
      box-shadow: -8px 0 40px rgba(0,0,0,.4);
    `;

    panel.innerHTML = `
      <div style="padding:16px 18px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--v);margin-bottom:2px;">Chat History</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:.06em;">Past Sessions</div>
        </div>
        <button onclick="window.EONS_HISTORY.close()" style="width:28px;height:28px;border:1px solid var(--border);border-radius:7px;background:transparent;color:var(--dim);font-size:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;" onmouseover="this.style.color='var(--white)'" onmouseout="this.style.color='var(--dim)'">✕</button>
      </div>

      <div id="historyLoading" style="display:none;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:var(--dim);">
        <div style="width:24px;height:24px;border:2px solid var(--border);border-top-color:var(--v);border-radius:50%;animation:spin .8s linear infinite;"></div>
        <div style="font-size:12px;letter-spacing:.06em;">Loading session...</div>
      </div>

      <div id="historyList" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;scrollbar-width:thin;scrollbar-color:var(--border) transparent;">
        <div id="historyEmpty" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:.3;text-align:center;padding:40px 20px;">
          <div style="font-size:28px;">💬</div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;letter-spacing:.07em;color:var(--dim);line-height:1.7;">No past sessions yet.<br>Start a conversation<br>and it'll appear here.</div>
        </div>
      </div>

      <div style="padding:12px;border-top:1px solid var(--border);flex-shrink:0;">
        <button onclick="window.EONS_HISTORY.newSession()" style="width:100%;padding:10px;background:var(--mg, rgba(155,111,212,.12));border:1px solid var(--border2, rgba(180,160,240,.24));border-radius:8px;color:var(--white);font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;transition:all .2s;" onmouseover="this.style.background='var(--mgs)'" onmouseout="this.style.background='var(--mg)'">+ New Session</button>
      </div>
    `;

    document.body.appendChild(panel);

    // Overlay backdrop
    const backdrop = document.createElement("div");
    backdrop.id = "historyBackdrop";
    backdrop.style.cssText = `
      position: fixed; inset: 0;
      background: rgba(5,4,14,.6);
      backdrop-filter: blur(4px);
      z-index: 1499;
      display: none;
      opacity: 0;
      transition: opacity .3s ease;
    `;
    backdrop.onclick = () => window.EONS_HISTORY.close();
    document.body.appendChild(backdrop);

    // Add spin keyframe
    if (!document.getElementById("historySpinStyle")) {
      const style = document.createElement("style");
      style.id = "historySpinStyle";
      style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
      document.head.appendChild(style);
    }
  }

  // ── Render session cards ──────────────────────────────────────────────────
  function renderHistoryCards(sessions) {
    const list   = document.getElementById("historyList");
    const empty  = document.getElementById("historyEmpty");
    if (!list) return;

    if (!sessions || sessions.length === 0) {
      if (empty) empty.style.display = "flex";
      return;
    }

    if (empty) empty.style.display = "none";

    // Remove old cards (keep empty state)
    list.querySelectorAll(".hist-card").forEach(c => c.remove());

    sessions.forEach(s => {
      const card = document.createElement("div");
      card.className = "hist-card";
      card.style.cssText = `
        background: var(--surface, rgba(155,111,212,.07));
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px 14px;
        cursor: pointer;
        transition: all .2s;
        display: flex;
        flex-direction: column;
        gap: 6px;
      `;

      const summary = s.summary || "Conversation";
      const brand   = s.brand   ? `<span style="color:var(--v);font-size:10px;letter-spacing:.08em;">${s.brand}</span>` : "";
      const date    = fmtDate(s.timestamp);
      const count   = s.messageCount ? `${s.messageCount} messages` : "";

      card.innerHTML = `
        <div style="font-size:13px;font-weight:500;color:var(--white);line-height:1.4;">${summary}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${brand}
          <span style="font-size:10px;color:var(--dim2);">${date}</span>
          ${count ? `<span style="font-size:10px;color:var(--dim2);">· ${count}</span>` : ""}
        </div>
        <div style="display:flex;gap:6px;margin-top:2px;">
          <button onclick="event.stopPropagation();window.EONS_HISTORY.restore('${s.id}')" style="flex:1;padding:6px 0;background:var(--mg);border:1px solid var(--border2);border-radius:6px;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:.1em;color:var(--v);cursor:pointer;transition:all .2s;" onmouseover="this.style.background='var(--mgs)'" onmouseout="this.style.background='var(--mg)'">Continue →</button>
        </div>
      `;

      card.addEventListener("mouseenter", () => {
        card.style.borderColor = "rgba(155,111,212,.4)";
        card.style.background  = "rgba(155,111,212,.1)";
      });
      card.addEventListener("mouseleave", () => {
        card.style.borderColor = "var(--border)";
        card.style.background  = "var(--surface)";
      });

      list.appendChild(card);
    });
  }

  // ── Open history panel ────────────────────────────────────────────────────
  async function openHistory() {
    buildHistoryPanel();
    const panel    = document.getElementById("historyPanel");
    const backdrop = document.getElementById("historyBackdrop");
    const list     = document.getElementById("historyList");

    if (!panel) return;

    // Show panel
    backdrop.style.display = "block";
    setTimeout(() => { backdrop.style.opacity = "1"; }, 10);
    setTimeout(() => { panel.style.transform = "translateX(0)"; }, 10);

    // Show loading skeleton
    if (list) {
      list.querySelectorAll(".hist-card").forEach(c => c.remove());
      const skeleton = document.createElement("div");
      skeleton.id = "histSkeleton";
      skeleton.style.cssText = "display:flex;flex-direction:column;gap:8px;";
      skeleton.innerHTML = [1,2,3].map(() => `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;opacity:.5;">
          <div style="height:13px;background:rgba(155,111,212,.15);border-radius:4px;margin-bottom:8px;width:80%;"></div>
          <div style="height:10px;background:rgba(155,111,212,.08);border-radius:4px;width:40%;"></div>
        </div>
      `).join("");
      list.appendChild(skeleton);
    }

    // Load sessions
    const S = window.S;
    if (!S || !S.user) {
      document.getElementById("histSkeleton")?.remove();
      return;
    }

    // Merge KV sessions + localStorage sessions
    const kvSessions = await loadUserHistory(S.user.email);

    // Also grab from localStorage as fallback
    let localSessions = [];
    try {
      const convs = JSON.parse(localStorage.getItem("eons_ai_convs") || "[]");
      localSessions = convs
        .filter(c => c.email === S.user.email)
        .map(c => ({
          id:           String(c.sid || c.id || Date.now()),
          timestamp:    new Date(c.date || Date.now()).toISOString(),
          brand:        c.chips?.[0] || "",
          summary:      c.preview || "Conversation",
          messageCount: c.messages?.length || 0,
          _local:       true,
          _data:        c,
        }));
    } catch {}

    // Deduplicate: KV wins
    const kvIds = new Set(kvSessions.map(s => String(s.id)));
    const merged = [...kvSessions, ...localSessions.filter(s => !kvIds.has(String(s.id)))];

    document.getElementById("histSkeleton")?.remove();
    renderHistoryCards(merged);

    // Store local sessions for offline restore
    window._eons_local_sessions = localSessions;
  }

  // ── Close history panel ───────────────────────────────────────────────────
  function closeHistory() {
    const panel    = document.getElementById("historyPanel");
    const backdrop = document.getElementById("historyBackdrop");
    if (panel)    panel.style.transform = "translateX(100%)";
    if (backdrop) {
      backdrop.style.opacity = "0";
      setTimeout(() => { backdrop.style.display = "none"; }, 300);
    }
  }

  // ── Restore with localStorage fallback ───────────────────────────────────
  async function restoreWithFallback(convId) {
    const S = window.S;
    if (!S || !S.user) return;

    // Try KV first
    const conv = await loadConvFromKV(convId, S.user.email);
    if (conv) {
      // KV restore
      closeHistory();
      await _doRestore(conv);
      return;
    }

    // Fall back to localStorage
    const local = (window._eons_local_sessions || []).find(s => String(s.id) === String(convId));
    if (local && local._data) {
      closeHistory();
      const lData = local._data;
      await _doRestore({
        id:       String(lData.sid || lData.id),
        messages: lData.messages || [],
        dna:      null,
        phase:    1,
        sections: 0,
        brand:    lData.chips?.[0] || "",
      });
      return;
    }

    if (typeof window.toast === "function") {
      window.toast("Session unavailable", "This conversation could not be loaded.");
    }
  }

  async function _doRestore(conv) {
    const S = window.S;

    // Save current session before switching
    if (S.messages.length > 0) {
      await saveConvToKV();
    }

    // Restore all state
    S.messages  = conv.messages || [];
    S.phase     = conv.phase    || 1;
    S.sections  = conv.sections || 0;
    S.sessionId = conv.id;
    S.turn      = S.messages.length;

    // Restore DNA carefully — merge, don't overwrite fields that are already set
    if (conv.dna) {
      S.dna = { ...S.dna, ...conv.dna };
    }

    // Clear chat
    const chatMsgs = document.getElementById("chatMessages");
    if (chatMsgs) chatMsgs.innerHTML = "";

    // Close any open panels
    document.getElementById("outputPanel")?.classList.remove("open");
    document.getElementById("conceptPanel")?.classList.remove("open");

    // Re-render messages with typewriter disabled (instant render for history)
    S.messages.forEach(m => {
      const text  = typeof m.content === "string" ? m.content : (m.content?.[0]?.text || "");
      const clean = text.replace(/<DNA>[\s\S]*?<\/DNA>/g, "").trim();
      if (!clean) return;

      const c   = chatMsgs;
      const div = document.createElement("div");
      div.className = "ch-msg " + m.role;

      const av      = document.createElement("div"); av.className = "ch-av";
      av.textContent = m.role === "user" ? (S.user?.initials || S.user?.name?.[0] || "U") : "✦";

      const content   = document.createElement("div"); content.className = "ch-content";
      const sender    = document.createElement("div"); sender.className  = "ch-sender";
      sender.textContent = m.role === "user" ? (S.user?.name || "You") : "EONS AI";

      const textDiv = document.createElement("div"); textDiv.className = "ch-text";

      // Instant render (no typewriter for history replay)
      textDiv.innerHTML = clean
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/`(.*?)`/g, "<code>$1</code>");

      if (m.role === "assistant") {
        const btn = document.createElement("button");
        btn.className = "msg-copy-btn";
        btn.innerHTML = "⎘ Copy";
        btn.onclick = () => {
          navigator.clipboard.writeText(clean).then(() => {
            btn.innerHTML = "✓ Copied"; btn.classList.add("copied");
            setTimeout(() => { btn.innerHTML = "⎘ Copy"; btn.classList.remove("copied"); }, 2000);
          });
        };
        content.appendChild(sender); content.appendChild(textDiv); content.appendChild(btn);
      } else {
        content.appendChild(sender); content.appendChild(textDiv);
      }

      div.appendChild(av); div.appendChild(content);
      c.appendChild(div);
    });

    // Restore passport
    if (typeof window.restorePassport === "function") {
      window.restorePassport();
    }

    // Restore session label
    const sessionEl = document.getElementById("cvhSession");
    if (sessionEl) {
      sessionEl.textContent = (conv.brand || S.dna?.brandName || "Restored") + " — Continued";
    }

    // Restore context buttons
    if (typeof window.renderCtxButtons === "function") {
      window.renderCtxButtons();
    }

    // Scroll to bottom
    setTimeout(() => {
      if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
    }, 150);

    if (typeof window.toast === "function") {
      window.toast("Session Restored ✓", "Continue exactly where you left off.");
    }
  }

  // ── Add history button to sidebar + mobile nav ────────────────────────────
  function injectNavButtons() {
    // Desktop sidebar — insert before the spacer
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) {
      const spacer = sidebar.querySelector(".sidebar-spacer");
      const btn = document.createElement("button");
      btn.className = "nav-item";
      btn.id = "histNavBtn";
      btn.onclick = () => window.EONS_HISTORY.open();
      btn.innerHTML = `<span class="nav-icon">🕐</span><span class="nav-lbl">History</span>`;
      if (spacer) sidebar.insertBefore(btn, spacer);
      else sidebar.appendChild(btn);
    }

    // Mobile bottom nav — insert before last item
    const mobNav = document.querySelector(".mob-nav");
    if (mobNav) {
      const btn = document.createElement("button");
      btn.className = "mob-nav-btn";
      btn.id = "histMobBtn";
      btn.onclick = () => window.EONS_HISTORY.open();
      btn.innerHTML = `<span class="mob-nav-icon">🕐</span><span class="mob-nav-lbl">History</span>`;
      mobNav.appendChild(btn);
    }

    // Also add to landing nav right side
    const landNavRight = document.querySelector(".land-nav-right");
    if (landNavRight) {
      const btn = document.createElement("button");
      btn.className = "land-nav-btn";
      btn.onclick = () => window.EONS_HISTORY.open();
      btn.textContent = "🕐 History";
      landNavRight.insertBefore(btn, landNavRight.firstChild);
    }
  }

  // ── Patch saveConversation to also push to KV ─────────────────────────────
  function patchSaveConversation() {
    const _orig = window.saveConversation;
    if (typeof _orig === "function") {
      window.saveConversation = function () {
        _orig.call(this);        // original: saves to localStorage + IndexedDB
        saveConvToKV();          // also push to KV
      };
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  window.addEventListener("load", function () {
    injectNavButtons();
    patchSaveConversation();

    // Remove conversation history from docs view (it now lives in the panel)
    const historyList = document.getElementById("historyList");
    const docsHistory = document.querySelector("#view-docs #historyList");
    // Note: the docs view has its own historyList — don't remove the panel's
    // Instead remove only the docs-view section label + list
    const docsView = document.getElementById("view-docs");
    if (docsView) {
      const sectionLabels = docsView.querySelectorAll(".section-lbl");
      sectionLabels.forEach(label => {
        if (label.textContent.includes("Conversation History")) {
          const next = label.nextElementSibling;
          if (next) next.remove();
          label.remove();
        }
      });
    }
  });

  // ── Public API ────────────────────────────────────────────────────────────
  window.EONS_HISTORY = {
    open:       openHistory,
    close:      closeHistory,
    restore:    restoreWithFallback,
    save:       saveConvToKV,
    newSession: function () {
      closeHistory();
      if (typeof window.newConvo === "function") window.newConvo();
    },
  };

})();
