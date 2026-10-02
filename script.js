/*
  7TH UNIVERSE ESPORTS — FREE FIRE
  Production-style frontend for the separate ESPORTS Supabase project.

  IMPORTANT:
  - The key below is a PUBLIC/PUBLISHABLE frontend key. Never place a
    Supabase secret/service_role key in this file.
  - The WhatsApp automation is intentionally invoked through a Supabase
    Edge Function. Meta credentials must stay server-side.
  - This frontend expects the ESPORTS SQL schema previously created in the
    separate Supabase project.
*/
(() => {
  "use strict";

  const SUPABASE_URL = "https://otrjuqcutwlwvzyruhaq.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "b_publishable_ro_4z-4OdgFCda9pT8Z3Pg_UEnY4aTE";
  const LOGO_BUCKET = "team-logos";
  const WHATSAPP_FUNCTION = "post-whatsapp";
  const MAX_LOGO_MB = 3;

  const app = document.getElementById("app");
  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const modalClose = document.getElementById("modalClose");
  const toast = document.getElementById("toast");

  const sb = window.supabase?.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  let currentUser = null;
  let currentProfile = null;
  let currentTeam = null;
  let isAdmin = false;
  let page = "home";
  let adminSection = "registrations";
  let booting = true;

  const cache = { challenges: [], recruitment: [], profiles: [], teams: [] };

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[c]));

  const dateTime = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
  };

  const cleanPhone = (value) => {
    let v = String(value || "").trim().replace(/[^\d+]/g, "");
    if (v.startsWith("00")) v = "+" + v.slice(2);
    if (v.startsWith("03")) return "+92" + v.slice(1);
    if (v.startsWith("92")) return "+" + v;
    return v;
  };

  function notify(message, type = "success") {
    toast.textContent = message;
    toast.className = `toast-show ${type === "error" ? "toast-error" : "toast-success"}`;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => { toast.className = ""; }, 4300);
  }

  function openModal(title, html) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });

  function loading(text = "Loading...") {
    return `<div class="empty"><strong>⏳ ${esc(text)}</strong><span>Please wait.</span></div>`;
  }

  function pageError(message) {
    return `<div class="empty"><strong>⚠ ${esc(message)}</strong><span>Check the Supabase project, database policies and Edge Function configuration.</span></div>`;
  }

  function render() {
    if (!currentUser) renderLoginGate();
    else renderMemberApp();
  }

  function renderLoginGate() {
    const registrationRoute = new URLSearchParams(location.search).get("register") === "1";
    app.innerHTML = `
      <div class="landing-shell">
        <div class="landing">
          <div class="landing-top">
            <div class="brand-mini"><span>7TH UNIVERSE</span> ESPORTS</div>
            <div class="member-status"><span class="dot"></span> MEMBER ACCESS</div>
          </div>

          <div class="landing-body">
            <section class="hero">
              <div class="eyebrow">FREE FIRE ESPORTS PLATFORM</div>
              <h1>7TH <em>UNIVERSE</em></h1>
              <h2>ESPORTS PRACTICE • RECRUITMENT</h2>
              <p>
                A dedicated Free Fire esports workspace for approved teams and members.
                Practice challenges and recruitment tools remain inside the authenticated member area.
              </p>
              <div class="tags">
                <span class="tag">FREE FIRE</span><span class="tag">CLASH SQUAD</span>
                <span class="tag">PRACTICE</span><span class="tag">RECRUITMENT</span>
                <span class="tag">MEMBERS ONLY</span>
              </div>
              <div class="secure-note">
                <b>SECURE MEMBER AREA</b><br>
                Login first. Practice, recruitment, team posts and administration become available only after authentication.
              </div>
            </section>
            <section class="auth-wrap">
              <div class="auth-box">${registrationRoute ? registrationForm() : loginForm()}</div>
            </section>
          </div>
        </div>
      </div>
    `;

    if (registrationRoute) {
      document.getElementById("backLogin")?.addEventListener("click", () => {
        const u = new URL(location.href); u.searchParams.delete("register"); history.replaceState({}, "", u);
        renderLoginGate();
      });
      document.getElementById("registerForm")?.addEventListener("submit", registerAccount);
    } else {
      document.getElementById("loginForm")?.addEventListener("submit", loginAccount);
    }
  }

  function loginForm() {
    return `
      <div class="login-badge">AUTHORIZED MEMBERS</div>
      <h3>Member Login</h3>
      <p class="auth-sub">Use your registered email or mobile number and password.</p>
      <form id="loginForm">
        <div class="form-group"><label for="loginId">EMAIL / MOBILE NUMBER</label><input class="input" id="loginId" autocomplete="username" placeholder="you@email.com or 03XXXXXXXXX" required></div>
        <div class="form-group"><label for="loginPassword">PASSWORD</label><input class="input" id="loginPassword" type="password" autocomplete="current-password" placeholder="Your password" required></div>
        <button class="btn btn-primary btn-block" type="submit">LOGIN TO 7TH UNIVERSE</button>
        <div class="auth-foot">Practice & Recruitment tools are available <b>after login</b>.</div>
      </form>
    `;
  }

  function registrationForm() {
    return `
      <div class="login-badge">CONTROLLED REGISTRATION</div>
      <h3>Register New Account</h3>
      <p class="auth-sub">Team Leader/IGL and Sub-Leader registrations are subject to admin approval.</p>
      <button class="btn btn-dark btn-small" id="backLogin" type="button">← BACK TO LOGIN</button>
      <form id="registerForm" style="margin-top:16px">
        <div class="grid2">
          <div class="form-group"><label>TEAM NAME *</label><input class="input" id="regTeam" maxlength="50" placeholder="Your esports team name" required></div>
          <div class="form-group"><label>MEMBER ROLE *</label><select class="select" id="regRole" required><option value="leader">Team Leader / IGL</option><option value="sub_leader">Sub-Leader</option></select></div>
        </div>
        <div class="grid2">
          <div class="form-group"><label>IGL / MEMBER NAME *</label><input class="input" id="regName" maxlength="60" placeholder="Name / preferred identity" required></div>
          <div class="form-group"><label>CONTACT NUMBER *</label><input class="input" id="regPhone" maxlength="20" inputmode="tel" placeholder="03XXXXXXXXX" required></div>
        </div>
        <div class="form-group"><label>EMAIL *</label><input class="input" id="regEmail" type="email" maxlength="120" placeholder="team@example.com" required></div>
        <div class="grid2">
          <div class="form-group"><label>PASSWORD *</label><input class="input" id="regPass" minlength="8" type="password" placeholder="Minimum 8 characters" required></div>
          <div class="form-group"><label>CONFIRM PASSWORD *</label><input class="input" id="regPass2" minlength="8" type="password" placeholder="Repeat password" required></div>
        </div>
        <div class="form-group"><label>TEAM LOGO — OPTIONAL</label><input class="input" id="regLogo" type="file" accept="image/png,image/jpeg,image/webp"><div class="hint">PNG/JPG/WEBP • Max ${MAX_LOGO_MB} MB</div></div>
        <div class="secure-note" style="margin-bottom:14px"><b>TEAM LIMIT: 2 WEBSITE MEMBERS</b><br>Maximum two active/pending registrations per team: Leader/IGL + Sub-Leader.</div>
        <button class="btn btn-primary btn-block" type="submit">SUBMIT REGISTRATION</button>
      </form>
    `;
  }

  async function loginAccount(e) {
    e.preventDefault();
    try {
      const identifier = document.getElementById("loginId").value.trim();
      const password = document.getElementById("loginPassword").value;
      if (!identifier || !password) throw new Error("Enter your login details.");
      let auth;
      if (identifier.includes("@")) auth = { email: identifier.toLowerCase(), password };
      else auth = { phone: cleanPhone(identifier), password };
      const { data, error } = await sb.auth.signInWithPassword(auth);
      if (error) throw error;
      if (!data.user) throw new Error("Login did not return a user.");
      await loadIdentity(data.user.id);
      if (!isAdmin && currentProfile?.status !== "approved") {
        await sb.auth.signOut();
        throw new Error("Your account is still pending admin approval.");
      }
      page = "home";
      render();
      notify("Welcome to 7TH UNIVERSE ESPORTS.");
    } catch (err) {
      console.error(err);
      notify(err.message || "Login failed.", "error");
    }
  }

  async function registerAccount(e) {
    e.preventDefault();
    try {
      const teamName = document.getElementById("regTeam").value.trim();
      const role = document.getElementById("regRole").value;
      const name = document.getElementById("regName").value.trim();
      const phone = cleanPhone(document.getElementById("regPhone").value);
      const email = document.getElementById("regEmail").value.trim().toLowerCase();
      const password = document.getElementById("regPass").value;
      const password2 = document.getElementById("regPass2").value;
      const logo = document.getElementById("regLogo").files?.[0] || null;

      if (!teamName || !name || !phone || !email) throw new Error("Complete all required fields.");
      if (!/^\+92\d{10}$/.test(phone)) throw new Error("Use a valid Pakistan mobile number, e.g. 03XXXXXXXXX.");
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");
      if (password !== password2) throw new Error("Passwords do not match.");
      if (logo && (logo.size > MAX_LOGO_MB * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(logo.type))) throw new Error(`Logo must be PNG/JPG/WEBP and ${MAX_LOGO_MB} MB or smaller.`);

      // Client-side precheck; database RPC performs the final 2-member enforcement.
      const { data: existing, error: exErr } = await sb.from("teams").select("id,name,status").ilike("name", teamName).maybeSingle();
      if (exErr) throw exErr;
      if (existing?.status === "banned") throw new Error("This team is blocked from registration.");
      if (existing) {
        const { count, error } = await sb.from("team_members").select("id", { count: "exact", head: true }).eq("team_id", existing.id).in("status", ["pending","approved"]);
        if (error) throw error;
        if ((count || 0) >= 2) throw new Error("This team already has the maximum 2 website members.");
      }

      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { display_name: name, phone, team_name: teamName, requested_role: role } }
      });
      if (error) throw error;
      if (!data.user) throw new Error("Registration did not create an account.");

      // If email confirmation is enabled and no session is returned, the RPC cannot yet run.
      if (!data.session) {
        notify("Account created. Confirm the email, then use the controlled registration link again to complete your team profile.", "success");
        return;
      }

      let logoUrl = null;
      if (logo) logoUrl = await uploadLogo(data.user.id, logo);
      const { error: rpcError } = await sb.rpc("register_team_member", {
        p_user_id: data.user.id,
        p_team_name: teamName,
        p_member_name: name,
        p_phone: phone,
        p_role: role,
        p_logo_url: logoUrl
      });
      if (rpcError) throw rpcError;
      await sb.auth.signOut();
      notify("Registration submitted. Wait for admin approval.", "success");
      const u = new URL(location.href); u.searchParams.delete("register"); history.replaceState({}, "", u);
      renderLoginGate();
    } catch (err) {
      console.error(err);
      notify(err.message || "Registration failed.", "error");
    }
  }

  async function uploadLogo(userId, file) {
    const extension = file.name.split(".").pop().toLowerCase();
    const path = `${userId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await sb.storage.from(LOGO_BUCKET).upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type
    });
    if (error) throw error;
    return sb.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function loadIdentity(userId) {
    currentUser = { id: userId };
    const { data: profile, error: pError } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (pError) throw pError;
    if (!profile) throw new Error("Profile not found. Ask the admin to complete your registration.");
    currentProfile = profile;
    isAdmin = profile.role === "admin" && profile.status === "approved";

    const { data: member, error: mError } = await sb.from("team_members").select("team_id,role,status,teams(id,name,logo_url,status)").eq("user_id", userId).maybeSingle();
    if (mError) throw mError;
    currentTeam = member?.teams || null;
  }

  function renderMemberApp() {
    app.innerHTML = `
      <header class="topbar"><div class="container topbar-inner">
        <div class="brand">7TH <b>UNIVERSE</b> ESPORTS</div>
        <nav class="nav">
          ${navButton("home","HOME")}${navButton("practice","PRACTICE")}${navButton("recruit","RECRUIT")}${navButton("my-posts","MY POSTS")}${isAdmin ? navButton("admin","ADMIN") : ""}
          <button class="nav-btn" id="logout">LOGOUT</button>
        </nav>
        <div class="user">
          ${currentTeam?.logo_url ? `<img class="avatar" src="${esc(currentTeam.logo_url)}" alt="Team logo">` : `<div class="avatar avatar-fallback">7U</div>`}
          <div class="user-meta"><b>${esc(currentTeam?.name || currentProfile?.display_name || "Member")}</b><span>${esc(isAdmin ? "Administrator" : currentProfile?.role || "Member")}</span></div>
        </div>
      </div></header>
      <main id="pageRoot" class="page">${loading("Opening your esports workspace...")}</main>
    `;
    document.querySelectorAll("[data-page]").forEach(btn => btn.addEventListener("click", () => { page = btn.dataset.page; renderMemberApp(); loadPage(); }));
    document.getElementById("logout")?.addEventListener("click", async () => { await sb.auth.signOut(); });
    loadPage();
  }

  function navButton(id, label) { return `<button class="nav-btn ${page === id ? "active" : ""}" data-page="${id}">${label}</button>`; }

  async function loadPage() {
    const root = document.getElementById("pageRoot"); if (!root) return;
    try {
      if (page === "home") root.innerHTML = await homePage();
      else if (page === "practice") { root.innerHTML = await practicePage(); bindPractice(); }
      else if (page === "recruit") { root.innerHTML = recruitPage(); bindRecruit(); }
      else if (page === "my-posts") { root.innerHTML = await myPostsPage(); bindCards(); }
      else if (page === "admin" && isAdmin) { root.innerHTML = await adminPage(); bindAdmin(); }
      else { page = "home"; renderMemberApp(); return; }
      bindCards();
    } catch (err) {
      console.error(err); root.innerHTML = pageError(err.message || "Page could not be loaded.");
    }
  }

  async function getChallenges(openOnly = true) {
    let q = sb.from("practice_challenges").select("*").order("match_time", { ascending: true }).limit(100);
    if (openOnly) q = q.eq("status", "open");
    const { data, error } = await q; if (error) throw error; cache.challenges = data || []; return cache.challenges;
  }

  async function getRecruitment(openOnly = true) {
    let q = sb.from("recruitment_posts").select("*").order("created_at", { ascending: false }).limit(100);
    if (openOnly) q = q.eq("status", "open");
    const { data, error } = await q; if (error) throw error; cache.recruitment = data || []; return cache.recruitment;
  }

  async function homePage() {
    const [challenges, recruitment] = await Promise.all([getChallenges(), getRecruitment()]);
    return `<div class="container">
      <section class="hero-card"><div class="eyebrow">FREE FIRE ESPORTS</div><h2>Welcome to 7TH UNIVERSE ESPORTS</h2><p>Your organized member workspace for Clash Squad practice challenges and Free Fire team/player recruitment.</p><div class="action-row"><button class="btn btn-primary" data-go="practice">⚔ CREATE PRACTICE CHALLENGE</button><button class="btn btn-blue" data-go="recruit">👥 CREATE RECRUITMENT</button></div></section>
      <section class="section"><div class="title-row"><div class="title"><h2>⚔ Open Practice Challenges</h2><p>Every challenge here is for <b>EVERYONE</b> — there is no specific opponent field.</p></div></div><div class="cards">${challenges.slice(0,4).map(challengeCard).join("") || empty("No open practice challenges right now.")}</div></section>
      <section class="section"><div class="title-row"><div class="title"><h2>👥 Recruitment</h2><p>Competitive Free Fire team and player requirements.</p></div></div><div class="cards">${recruitment.slice(0,4).map(recruitCard).join("") || empty("No active recruitment posts right now.")}</div></section>
    </div>`;
  }

  function empty(text) { return `<div class="empty" style="grid-column:1/-1"><strong>${esc(text)}</strong><span>New posts will appear here.</span></div>`; }

  function challengeCard(c) {
    const time = dateTime(c.match_time);
    return `<article class="card"><div class="card-head">${c.team_logo_url ? `<img class="team-logo" src="${esc(c.team_logo_url)}" alt="Team logo">` : `<div class="team-logo logo-fallback">7U</div>`}<div><h3>${esc(c.team_name)}</h3><div class="muted">FREE FIRE • CLASH SQUAD • EVERYONE</div></div></div>
      <div class="badges"><span class="badge red">${esc(c.match_type)}</span><span class="badge blue">${esc(c.format)}</span><span class="badge green">OPEN</span><span class="badge">EVERYONE</span></div>
      <div class="info-grid"><div class="info"><small>Match Time</small><strong>${esc(time)}</strong></div><div class="info"><small>Contact</small><strong>${esc(c.contact || "—")}</strong></div></div>
      ${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ""}<div class="card-actions"><button class="btn btn-primary btn-small" data-wa="${esc(c.contact || "")}">WHATSAPP</button><button class="btn btn-dark btn-small" data-detail='${esc(JSON.stringify(c))}'>DETAILS</button></div>
    </article>`;
  }

  function recruitCard(r) {
    const looking = Array.isArray(r.looking_for) ? r.looking_for.join(" • ") : String(r.looking_for || "—");
    return `<article class="card"><div class="card-head">${r.team_logo_url ? `<img class="team-logo" src="${esc(r.team_logo_url)}" alt="Logo">` : `<div class="team-logo logo-fallback">7U</div>`}<div><h3>${esc(r.team_name || r.player_ign || "Recruitment")}</h3><div class="muted">FREE FIRE • ${esc(String(r.listing_type || "").replaceAll("_"," "))}</div></div></div>
      <div class="badges"><span class="badge red">${esc(looking)}</span>${r.players_needed ? `<span class="badge blue">${esc(r.players_needed)} NEEDED</span>` : ""}<span class="badge green">OPEN</span></div>
      <div class="info-grid"><div class="info"><small>Availability</small><strong>${esc(r.availability || "—")}</strong></div><div class="info"><small>Age</small><strong>${esc(r.age_requirement || "—")}</strong></div>${r.player_ign ? `<div class="info"><small>Player IGN</small><strong>${esc(r.player_ign)}</strong></div>` : ""}${r.player_uid ? `<div class="info"><small>UID</small><strong>${esc(r.player_uid)}</strong></div>` : ""}</div>
      ${r.notes ? `<p class="notes">${esc(r.notes)}</p>` : ""}<div class="card-actions"><button class="btn btn-blue btn-small" data-wa="${esc(r.contact || "")}">CONTACT</button><button class="btn btn-dark btn-small" data-detail='${esc(JSON.stringify(r))}'>DETAILS</button></div>
    </article>`;
  }

  async function practicePage() {
    const challenges = await getChallenges();
    return `<div class="container"><div class="title-row"><div class="title"><h2>⚔ FREE FIRE PRACTICE</h2><p>CLASH SQUAD challenges are published for <b>EVERYONE</b>.</p></div></div>
      <div class="card"><h3 style="margin-top:0">CREATE OPEN CHALLENGE</h3><p class="muted" style="margin:5px 0 18px">Your team details are pulled from the approved team account.</p>
        <form id="practiceForm">
          <div class="grid3"><div class="form-group"><label>GAME</label><input class="input" value="FREE FIRE" disabled></div><div class="form-group"><label>MODE</label><input class="input" value="CLASH SQUAD" disabled></div><div class="form-group"><label>CHALLENGE AUDIENCE</label><input class="input" value="EVERYONE" disabled></div></div>
          <div class="grid3"><div class="form-group"><label>MATCH TYPE *</label><select class="select" id="matchType" required><option value="SINGLE">SINGLE MATCH</option><option value="BEST OF 3">BEST OF 3</option></select></div><div class="form-group"><label>FORMAT *</label><select class="select" id="matchFormat" required><option value="SQUAD">SQUAD</option><option value="TRIO">TRIO</option><option value="DUO">DUO</option><option value="SOLO">SOLO</option></select></div><div class="form-group"><label>DATE & TIME *</label><input class="input" id="matchTime" type="datetime-local" required></div></div>
          <div class="grid2"><div class="form-group"><label>CONTACT / WHATSAPP *</label><input class="input" id="matchContact" value="${esc(currentProfile?.phone || "")}" placeholder="03XXXXXXXXX" required></div><div class="form-group"><label>ADDITIONAL NOTES</label><input class="input" id="matchNotes" maxlength="250" placeholder="Serious competitive teams only."></div></div>
          <div class="secure-note"><b>EVERYONE CHALLENGE</b><br>This post will not ask you to select an opposing team.</div>
          <button class="btn btn-primary" type="submit" style="margin-top:14px">POST OPEN CHALLENGE</button>
        </form></div>
      <section class="section"><div class="title"><h2>Open Challenges</h2><p>Fresh challenges from approved teams.</p></div><div class="cards" style="margin-top:14px">${challenges.map(challengeCard).join("") || empty("No open challenges.")}</div></section>
    </div>`;
  }

  function bindPractice() { document.getElementById("practiceForm")?.addEventListener("submit", submitPractice); }

  async function submitPractice(e) {
    e.preventDefault();
    try {
      if (!currentTeam) throw new Error("Approved team profile not found.");
      const dt = new Date(document.getElementById("matchTime").value);
      if (Number.isNaN(dt.getTime())) throw new Error("Choose a valid date and time.");
      const contact = cleanPhone(document.getElementById("matchContact").value);
      if (!/^\+92\d{10}$/.test(contact)) throw new Error("Use a valid Pakistan mobile number.");
      const { data: id, error } = await sb.rpc("create_practice_challenge", {
        p_team_id: currentTeam.id,
        p_team_name: currentTeam.name,
        p_team_logo_url: currentTeam.logo_url || null,
        p_match_type: document.getElementById("matchType").value,
        p_match_time: dt.toISOString(),
        p_format: document.getElementById("matchFormat").value,
        p_contact: contact,
        p_notes: document.getElementById("matchNotes").value.trim() || null
      });
      if (error) throw error;
      notify("Practice challenge posted for EVERYONE.");
      await notifyWhatsApp("practice_challenge", id);
      e.target.reset(); document.getElementById("matchContact").value = currentProfile?.phone || "";
      await loadPage();
    } catch (err) { console.error(err); notify(err.message || "Could not post challenge.", "error"); }
  }

  function recruitPage() {
    return `<div class="container"><div class="title-row"><div class="title"><h2>👥 FREE FIRE RECRUITMENT</h2><p>Post a professional team requirement or a player profile.</p></div></div>
      <div class="card"><h3 style="margin-top:0">CREATE RECRUITMENT POST</h3>
        <form id="recruitForm">
          <div class="form-group"><label>LISTING TYPE *</label><select class="select" id="listingType"><option value="TEAM_RECRUITMENT">TEAM RECRUITMENT — Looking for players</option><option value="PLAYER_RECRUITMENT">PLAYER RECRUITMENT — Looking for a team</option></select></div>
          <div id="teamFields"><div class="grid2"><div class="form-group"><label>TEAM NAME</label><input class="input" value="${esc(currentTeam?.name || "")}" disabled></div><div class="form-group"><label>PLAYERS NEEDED</label><select class="select" id="playersNeeded"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></div></div>
            <div class="form-group"><label>LOOKING FOR *</label><select class="select" id="lookingFor" multiple size="5" required><option value="Rusher">Rusher</option><option value="Sniper">Sniper</option><option value="Support">Support</option><option value="Entry Fragger">Entry Fragger</option><option value="All-Rounder">All-Rounder</option></select><div class="hint">Select one or more roles.</div></div></div>
          <div id="playerFields" class="hidden"><div class="grid2"><div class="form-group"><label>PLAYER IGN *</label><input class="input" id="playerIgn" maxlength="40" placeholder="Free Fire name"></div><div class="form-group"><label>FREE FIRE UID *</label><input class="input" id="playerUid" maxlength="20" placeholder="Player UID"></div></div><div class="form-group"><label>PREFERRED ROLE *</label><select class="select" id="playerRole"><option value="Rusher">Rusher</option><option value="Sniper">Sniper</option><option value="Support">Support</option><option value="Entry Fragger">Entry Fragger</option><option value="All-Rounder">All-Rounder</option></select></div></div>
          <div class="grid3"><div class="form-group"><label>AVAILABILITY *</label><input class="input" id="availability" placeholder="5 PM – 11 PM" required></div><div class="form-group"><label>AGE / AGE REQUIREMENT *</label><input class="input" id="ageRequirement" placeholder="16+ or 18" required></div><div class="form-group"><label>CONTACT / WHATSAPP *</label><input class="input" id="recruitContact" value="${esc(currentProfile?.phone || "")}" placeholder="03XXXXXXXXX" required></div></div>
          <div class="grid2"><div class="form-group"><label>EXPERIENCE</label><input class="input" id="experience" maxlength="160" placeholder="Competitive experience, years, etc."></div><div class="form-group"><label>EXTRA DETAILS</label><textarea class="textarea" id="recruitNotes" maxlength="500" placeholder="Trials, requirements, preferred timings, etc."></textarea></div></div>
          <button class="btn btn-blue" type="submit">POST RECRUITMENT</button>
        </form></div>
    </div>`;
  }

  function bindRecruit() {
    document.getElementById("listingType")?.addEventListener("change", toggleRecruitType);
    document.getElementById("recruitForm")?.addEventListener("submit", submitRecruitment);
    toggleRecruitType();
  }

  function toggleRecruitType() {
    const team = document.getElementById("listingType")?.value === "TEAM_RECRUITMENT";
    document.getElementById("teamFields")?.classList.toggle("hidden", !team);
    document.getElementById("playerFields")?.classList.toggle("hidden", team);
    if (document.getElementById("lookingFor")) document.getElementById("lookingFor").required = team;
    if (document.getElementById("playerIgn")) document.getElementById("playerIgn").required = !team;
    if (document.getElementById("playerUid")) document.getElementById("playerUid").required = !team;
  }

  async function submitRecruitment(e) {
    e.preventDefault();
    try {
      const teamMode = document.getElementById("listingType").value === "TEAM_RECRUITMENT";
      if (teamMode && !currentTeam) throw new Error("Approved team profile not found.");
      const contact = cleanPhone(document.getElementById("recruitContact").value);
      if (!/^\+92\d{10}$/.test(contact)) throw new Error("Use a valid Pakistan mobile number.");
      let looking = [];
      let playerIgn = null, playerUid = null;
      if (teamMode) {
        looking = [...document.getElementById("lookingFor").selectedOptions].map(o => o.value);
        if (!looking.length) throw new Error("Select at least one role.");
      } else {
        playerIgn = document.getElementById("playerIgn").value.trim();
        playerUid = document.getElementById("playerUid").value.trim();
        looking = [document.getElementById("playerRole").value];
        if (!playerIgn || !playerUid) throw new Error("Player IGN and UID are required.");
      }
      const { data: id, error } = await sb.rpc("create_recruitment_post", {
        p_team_id: currentTeam?.id || null,
        p_team_name: currentTeam?.name || playerIgn,
        p_team_logo_url: currentTeam?.logo_url || null,
        p_listing_type: teamMode ? "TEAM_RECRUITMENT" : "PLAYER_RECRUITMENT",
        p_looking_for: looking,
        p_players_needed: teamMode ? Number(document.getElementById("playersNeeded").value) : 1,
        p_availability: document.getElementById("availability").value.trim(),
        p_age_requirement: document.getElementById("ageRequirement").value.trim(),
        p_contact: contact,
        p_experience: document.getElementById("experience").value.trim() || null,
        p_player_ign: playerIgn,
        p_player_uid: playerUid,
        p_notes: document.getElementById("recruitNotes").value.trim() || null
      });
      if (error) throw error;
      notify("Recruitment post created.");
      await notifyWhatsApp("recruitment", id);
      e.target.reset(); document.getElementById("recruitContact").value = currentProfile?.phone || ""; toggleRecruitType();
    } catch (err) { console.error(err); notify(err.message || "Could not create recruitment post.", "error"); }
  }

  async function myPostsPage() {
    if (!currentTeam) return `<div class="container">${empty("Your approved team is not linked yet.")}</div>`;
    const [ch, rr] = await Promise.all([
      sb.from("practice_challenges").select("*").eq("team_id", currentTeam.id).order("created_at", { ascending:false }),
      sb.from("recruitment_posts").select("*").eq("team_id", currentTeam.id).order("created_at", { ascending:false })
    ]);
    if (ch.error) throw ch.error; if (rr.error) throw rr.error;
    return `<div class="container"><div class="title-row"><div class="title"><h2>MY POSTS</h2><p>Posts created by your team.</p></div></div>
      <section><div class="title"><h3>Practice Challenges</h3></div><div class="cards" style="margin-top:12px">${(ch.data||[]).map(challengeCard).join("") || empty("No practice posts yet.")}</div></section>
      <section class="section"><div class="title"><h3>Recruitment</h3></div><div class="cards" style="margin-top:12px">${(rr.data||[]).map(recruitCard).join("") || empty("No recruitment posts yet.")}</div></section>
    </div>`;
  }

  async function adminPage() {
    const [profiles, teams, challenges, recruitment] = await Promise.all([
      sb.from("profiles").select("*").neq("role","admin").order("created_at",{ascending:false}).limit(300),
      sb.from("teams").select("*").order("created_at",{ascending:false}).limit(300),
      sb.from("practice_challenges").select("*").order("created_at",{ascending:false}).limit(300),
      sb.from("recruitment_posts").select("*").order("created_at",{ascending:false}).limit(300)
    ]);
    if (profiles.error) throw profiles.error;if (teams.error) throw teams.error;if (challenges.error) throw challenges.error;if (recruitment.error) throw recruitment.error;
    cache.profiles=profiles.data||[];cache.teams=teams.data||[];cache.challenges=challenges.data||[];cache.recruitment=recruitment.data||[];
    return `<div class="container"><div class="title-row"><div class="title"><h2>ADMIN CONTROL CENTER</h2><p>Manage registrations, teams, practice challenges and recruitment posts.</p></div></div>
      <div class="stats"><div class="stat"><small>PENDING REGISTRATIONS</small><strong>${cache.profiles.filter(p=>p.status==="pending").length}</strong></div><div class="stat"><small>TEAMS</small><strong>${cache.teams.length}</strong></div><div class="stat"><small>PRACTICE POSTS</small><strong>${cache.challenges.length}</strong></div><div class="stat"><small>RECRUITMENT POSTS</small><strong>${cache.recruitment.length}</strong></div></div>
      <div class="admin-layout section"><aside class="admin-nav">${adminNav("registrations","Registrations")}${adminNav("teams","Teams")}${adminNav("practice","Practice")}${adminNav("recruitment","Recruitment")}</aside><section class="admin-main">${adminSectionHtml()}</section></div>
    </div>`;
  }

  function adminNav(id,label){return `<button class="${adminSection===id?"active":""}" data-admin-section="${id}">${label}</button>`;}

  function adminSectionHtml(){
    if(adminSection==="teams") return `<div class="card"><h3>Teams</h3>${teamsTable()}</div>`;
    if(adminSection==="practice") return `<div class="card"><h3>Practice Challenges</h3>${practiceTable()}</div>`;
    if(adminSection==="recruitment") return `<div class="card"><h3>Recruitment Posts</h3>${recruitTable()}</div>`;
    return `<div class="card"><h3>Member Registrations</h3>${registrationsTable()}</div>`;
  }

  function registrationsTable(){return `<div class="table-wrap"><table><thead><tr><th>Member</th><th>Team</th><th>Role</th><th>Contact</th><th>Status</th><th>Actions</th></tr></thead><tbody>${cache.profiles.map(p=>`<tr><td>${esc(p.display_name)}</td><td>${esc(p.team_name||"—")}</td><td>${esc(p.role)}</td><td>${esc(p.phone||"—")}</td><td><span class="badge ${p.status==="approved"?"green":"red"}">${esc(p.status)}</span></td><td>${p.status==="pending"?`<button class="btn btn-green btn-small" data-profile-status="${esc(p.id)}" data-next="approved">APPROVE</button> <button class="btn btn-danger btn-small" data-profile-status="${esc(p.id)}" data-next="rejected">REJECT</button>`:`<button class="btn btn-dark btn-small" data-profile-status="${esc(p.id)}" data-next="${p.status==="banned"?"approved":"banned"}">${p.status==="banned"?"UNBAN":"BAN"}</button>`}</td></tr>`).join("") || `<tr><td colspan="6">No records.</td></tr>`}</tbody></table></div>`;}
  function teamsTable(){return `<div class="table-wrap"><table><thead><tr><th>Team</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${cache.teams.map(t=>`<tr><td><div style="display:flex;align-items:center;gap:9px">${t.logo_url?`<img class="mini-logo" src="${esc(t.logo_url)}">`:`<div class="mini-logo logo-fallback">7U</div>`}<b>${esc(t.name)}</b></div></td><td><span class="badge ${t.status==="active"?"green":"red"}">${esc(t.status)}</span></td><td>${esc(dateTime(t.created_at))}</td><td><button class="btn btn-dark btn-small" data-team-status="${esc(t.id)}" data-next="${t.status==="banned"?"active":"banned"}">${t.status==="banned"?"UNBAN":"BAN"}</button></td></tr>`).join("") || `<tr><td colspan="4">No teams.</td></tr>`}</tbody></table></div>`;}
  function practiceTable(){return `<div class="table-wrap"><table><thead><tr><th>Team</th><th>Match</th><th>Format</th><th>Time</th><th>Status</th><th>Actions</th></tr></thead><tbody>${cache.challenges.map(c=>`<tr><td>${esc(c.team_name)}</td><td>${esc(c.match_type)}</td><td>${esc(c.format)}</td><td>${esc(dateTime(c.match_time))}</td><td><span class="badge ${c.status==="open"?"green":"red"}">${esc(c.status)}</span></td><td><button class="btn btn-dark btn-small" data-challenge-status="${esc(c.id)}" data-next="${c.status==="open"?"closed":"open"}">${c.status==="open"?"CLOSE":"REOPEN"}</button></td></tr>`).join("") || `<tr><td colspan="6">No practice posts.</td></tr>`}</tbody></table></div>`;}
  function recruitTable(){return `<div class="table-wrap"><table><thead><tr><th>Listing</th><th>Type</th><th>Roles</th><th>Availability</th><th>Status</th><th>Actions</th></tr></thead><tbody>${cache.recruitment.map(r=>`<tr><td>${esc(r.team_name||r.player_ign||"—")}</td><td>${esc(r.listing_type)}</td><td>${esc(Array.isArray(r.looking_for)?r.looking_for.join(", "):r.looking_for||"—")}</td><td>${esc(r.availability||"—")}</td><td><span class="badge ${r.status==="open"?"green":"red"}">${esc(r.status)}</span></td><td><button class="btn btn-dark btn-small" data-recruit-status="${esc(r.id)}" data-next="${r.status==="open"?"closed":"open"}">${r.status==="open"?"CLOSE":"REOPEN"}</button></td></tr>`).join("") || `<tr><td colspan="6">No recruitment posts.</td></tr>`}</tbody></table></div>`;}

  function bindAdmin(){
    document.querySelectorAll("[data-admin-section]").forEach(b=>b.addEventListener("click",()=>{adminSection=b.dataset.adminSection;renderMemberApp();}));
    document.querySelectorAll("[data-profile-status]").forEach(b=>b.addEventListener("click",()=>updateProfileStatus(b.dataset.profileStatus,b.dataset.next)));
    document.querySelectorAll("[data-team-status]").forEach(b=>b.addEventListener("click",()=>updateTeamStatus(b.dataset.teamStatus,b.dataset.next)));
    document.querySelectorAll("[data-challenge-status]").forEach(b=>b.addEventListener("click",()=>updateChallengeStatus(b.dataset.challengeStatus,b.dataset.next)));
    document.querySelectorAll("[data-recruit-status]").forEach(b=>b.addEventListener("click",()=>updateRecruitStatus(b.dataset.recruitStatus,b.dataset.next)));
  }

  async function updateProfileStatus(id,status){try{const{error}=await sb.from("profiles").update({status}).eq("id",id);if(error)throw error;notify(`Member status: ${status}`);renderMemberApp();}catch(e){console.error(e);notify(e.message||"Update failed","error");}}
  async function updateTeamStatus(id,status){try{const{error}=await sb.from("teams").update({status}).eq("id",id);if(error)throw error;notify(`Team status: ${status}`);renderMemberApp();}catch(e){console.error(e);notify(e.message||"Update failed","error");}}
  async function updateChallengeStatus(id,status){try{const{error}=await sb.from("practice_challenges").update({status}).eq("id",id);if(error)throw error;notify(`Challenge status: ${status}`);renderMemberApp();}catch(e){console.error(e);notify(e.message||"Update failed","error");}}
  async function updateRecruitStatus(id,status){try{const{error}=await sb.from("recruitment_posts").update({status}).eq("id",id);if(error)throw error;notify(`Recruitment status: ${status}`);renderMemberApp();}catch(e){console.error(e);notify(e.message||"Update failed","error");}}

  async function notifyWhatsApp(type, recordId){
    try{
      const { error } = await sb.functions.invoke(WHATSAPP_FUNCTION,{body:{type,record_id:recordId}});
      if(error){console.warn("WhatsApp notification failed",error);notify("Post saved, but WhatsApp delivery is not configured/available yet.","error");}
    }catch(e){console.warn(e);notify("Post saved, but WhatsApp delivery is not configured/available yet.","error");}
  }

  function bindCards(){
    document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>{page=b.dataset.go;renderMemberApp();}));
    document.querySelectorAll("[data-wa]").forEach(b=>b.addEventListener("click",()=>{const p=cleanPhone(b.dataset.wa||"");if(!p)return notify("Contact number unavailable.","error");window.open(`https://wa.me/${p.replace("+","")}`,"_blank","noopener,noreferrer");}));
    document.querySelectorAll("[data-detail]").forEach(b=>b.addEventListener("click",()=>{let data;try{data=JSON.parse(b.dataset.detail)}catch{data={}};const rows=Object.entries(data).filter(([k,v])=>!['id','team_id','team_logo_url'].includes(k)&&v!==null&&v!=="").map(([k,v])=>`<div class="info"><small>${esc(k.replaceAll('_',' '))}</small><strong>${esc(Array.isArray(v)?v.join(' • '):String(v))}</strong></div>`).join('');openModal("Post Details",`<div class="info-grid">${rows||'<div class="empty">No details.</div>'}</div>`);}));
  }

  sb.auth.onAuthStateChange(async (_event, session) => {
    // Avoid loading identity twice on the initial boot; session changes remain reactive after that.
    if (_event === "SIGNED_OUT") {
      currentUser = null; currentProfile = null; currentTeam = null; isAdmin = false; page = "home"; render(); return;
    }
    if (_event !== "SIGNED_OUT" && session?.user && session.user.id !== currentUser?.id) {
      try { await loadIdentity(session.user.id); render(); } catch(e) { console.error(e); }
    }
  });

  (async function boot(){
    try{
      const { data: { session }, error } = await sb.auth.getSession();
      if(error) throw error;
      if(session?.user){
        await loadIdentity(session.user.id);
        if(!isAdmin && currentProfile?.status !== "approved"){
          await sb.auth.signOut();
          notify("Your account is pending admin approval.","error");
        }
      }
    }catch(e){console.error(e);notify(e.message||"Supabase connection failed.","error");}
    booting=false;render();
  })();
})();
