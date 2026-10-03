/*
  7TH UNIVERSE ESPORTS — FINAL
  Simple frontend: index.html + script.js + logo only.
  Backend: Supabase Auth/DB/Storage + Railway/Baileys bridge.

  Security rules:
  - Publishable Supabase key only. Never place service_role/secret keys here.
  - Public writes are RPC-only; admin actions are verified by SECURITY DEFINER RPCs.
  - Registration creates the profile/team membership from the auth.users trigger.
  - Maximum 2 website members per team: Team Leader/IGL + Sub-Leader.
  - Permanent ranking: WIN +3 / LOSS -3. Only approved results count.
*/
(() => {
  "use strict";

  const SUPABASE_URL = "https://otrjuqcutwlwvzyruhaq.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ro_4z-4OdgFCda9pT8Z3Pg_UEnY4aTE";
  const LOGO_BUCKET = "team-logos";
  const RESULT_BUCKET = "result-proofs";
  const MAX_IMAGE_MB = 3;

  if (!window.supabase?.createClient) {
    throw new Error("Supabase client SDK is unavailable. Refresh the page and check CDN access.");
  }

  const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
  );

  const app = document.getElementById("app");
  const modal = document.getElementById("modalBackdrop");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const modalClose = document.getElementById("modalClose");
  const toast = document.getElementById("toast");

  const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

  const state = {
    user: null,
    profile: null,
    membership: null,
    team: null,
    isAdmin: false,
    screen: "login",
    section: "dashboard",
    adminSection: "registrations",
    challenges: [],
    recruitment: [],
    results: [],
    rankings: [],
    registrations: [],
    teams: []
  };

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[m]));

  function cleanPhone(value) {
    let v = String(value || "").trim().replace(/[^\d+]/g, "");
    if (v.startsWith("00")) v = `+${v.slice(2)}`;
    if (v.startsWith("03")) v = `+92${v.slice(1)}`;
    if (v.startsWith("92")) v = `+${v}`;
    return v;
  }

  const formatDate = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? "—"
      : d.toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
  };

  const roleName = (role) => ({
    admin: "Administrator",
    leader: "Team Leader / IGL",
    sub_leader: "Sub-Leader",
    member: "Member"
  }[role] || role || "Member");

  const logo = (url, label = "7U", cls = "mini-logo") => url
    ? `<img class="${cls}" src="${esc(url)}" alt="${esc(label)} logo">`
    : `<div class="${cls} mini-placeholder">${esc(String(label).slice(0, 3).toUpperCase())}</div>`;

  function showToast(message, type = "ok") {
    if (!toast) return;
    toast.textContent = String(message || "");
    toast.className = `show ${type}`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.className = ""; }, 5000);
  }

  function showModal(title, body) {
    if (!modal || !modalTitle || !modalBody) return;
    modalTitle.textContent = title;
    modalBody.innerHTML = body;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  modalClose?.addEventListener("click", closeModal);
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  function friendlyError(error, fallback = "Request failed.") {
    const message = String(error?.message || error?.details || error || fallback);
    const code = String(error?.code || "");

    if (code === "42501" || /permission denied|not permitted|administrator access required/i.test(message)) {
      return "Database denied this action. Run the latest ESPORTS SQL Parts 1–12 and make sure your admin profile is role=admin and status=approved.";
    }
    if (code === "23505" || /duplicate key|already exists/i.test(message)) {
      return "This value already exists. Check the team name, email, or selected role.";
    }
    if (code === "23514" || /check constraint|violates check constraint/i.test(message)) {
      return "Database validation rejected the data. Run all latest ESPORTS SQL parts in order.";
    }
    if (code === "23503" || /foreign key/i.test(message)) {
      return "A related team/member record is missing. Run the latest ESPORTS SQL parts in order.";
    }
    if (/Invalid login credentials/i.test(message)) return "Email/phone or password is incorrect.";
    if (/Email not confirmed/i.test(message)) return "Please confirm your email first, then login again.";
    return message || fallback;
  }

  async function getProfile(uid) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getMembership(uid) {
    const { data, error } = await supabase
      .from("team_members")
      .select("id,team_id,user_id,role,status,created_at,teams(id,name,logo_url,igl_name,status,created_at,updated_at)")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function hydrateSession() {
    const { data: { session } } = await supabase.auth.getSession();
    state.user = session?.user || null;

    if (!state.user) {
      state.profile = null;
      state.membership = null;
      state.team = null;
      state.isAdmin = false;
      state.screen = new URLSearchParams(location.search).get("register") === "1" ? "register" : "login";
      render();
      return;
    }

    try {
      state.profile = await getProfile(state.user.id);
      if (!state.profile) {
        await supabase.auth.signOut();
        state.screen = "login";
        render();
        showToast("Registration record not found. Contact the administrator.", "error");
        return;
      }

      state.isAdmin = state.profile.role === "admin" && state.profile.status === "approved";

      if (!state.isAdmin && state.profile.status !== "approved") {
        const currentStatus = state.profile.status;
        await supabase.auth.signOut();
        state.screen = "login";
        render();
        showToast(
          currentStatus === "banned" ? "Your account is banned." : "Your registration is pending administrator approval.",
          "error"
        );
        return;
      }

      state.membership = await getMembership(state.user.id);
      state.team = state.membership?.teams || null;

      if (!state.isAdmin && (!state.membership || state.membership.status !== "approved" || state.team?.status !== "active")) {
        await supabase.auth.signOut();
        state.screen = "login";
        render();
        showToast("Your team is not confirmed yet. Please wait for admin approval.", "error");
        return;
      }

      state.screen = "member";
      render();
    } catch (error) {
      console.error(error);
      await supabase.auth.signOut();
      state.screen = "login";
      render();
      showToast(friendlyError(error, "Could not load account."), "error");
    }
  }

  supabase.auth.onAuthStateChange(async (event) => {
    if (["SIGNED_OUT", "TOKEN_REFRESHED"].includes(event)) {
      try { await hydrateSession(); } catch (e) { console.error(e); }
    }
  });

  /* ========================= PUBLIC AUTH ========================= */

  function authHeader() {
    return `
      <div class="public-header">
        <div class="public-nav">
          <div class="nav-left">
            <button class="nav-action admin" id="publicAdminBtn" type="button">ADMINS</button>
          </div>
          <div class="brand-center">
            <img class="brand-logo" src="./7th-universe-esports-logo.png" alt="7TH UNIVERSE ESPORTS">
            <div>
              <div class="brand-title">7TH <span>UNIVERSE</span></div>
              <div class="brand-sub">FREE FIRE • ESPORTS PLATFORM</div>
            </div>
          </div>
          <div class="nav-right"></div>
        </div>
      </div>`;
  }

  function renderAuth() {
    const registering = state.screen === "register";
    app.innerHTML = `
      ${authHeader()}
      <main class="public-page">
        <div class="auth-layout">
          <section class="card auth-hero">
            <div class="kicker">FREE FIRE ESPORTS PLATFORM</div>
            <h1><span class="w">7TH</span> <span class="b">UNIVERSE</span> <span class="c">ESPORTS</span></h1>
            <h2>Practice. Recruit. Compete.</h2>
            <div class="desc">A dedicated Free Fire esports workspace for Clash Squad practice, recruitment, match results and permanent all-time rankings.</div>
            <div class="feature-grid">
              <div class="feature"><b>CLASH SQUAD PRACTICE</b><span>Open challenges are automatically visible to EVERYONE.</span></div>
              <div class="feature"><b>TEAM / PLAYER RECRUITMENT</b><span>Roles, availability, requirements, contact and player details.</span></div>
              <div class="feature"><b>PERMANENT RANKING</b><span>Approved WIN +3 and LOSS −3 records never reset.</span></div>
              <div class="feature"><b>2 MEMBERS / TEAM</b><span>One Team Leader/IGL + one Sub-Leader only.</span></div>
            </div>
            <div class="access-note"><b>APPROVAL FLOW:</b> Registration → Pending → Admin Review → Approved → Login.</div>
          </section>

          <section class="card auth-card">
            <div class="auth-inner">
              <div class="auth-logo-row">
                <img src="./7th-universe-esports-logo.png" alt="7U">
                <div><strong>${registering ? "NEW TEAM REGISTRATION" : "MEMBER LOGIN"}</strong><span>7TH UNIVERSE ESPORTS</span></div>
              </div>
              ${registering ? registrationForm() : loginForm()}
            </div>
          </section>
        </div>
      </main>`;
    bindAuth();
  }

  function loginForm() {
    return `
      <div class="auth-title">
        <div class="kicker">AUTHORIZED MEMBERS</div>
        <h1 class="title">LOGIN</h1>
        <p>Use your registered email or mobile number and password.</p>
      </div>
      <form id="loginForm" style="margin-top:16px">
        <div class="field-grid">
          <label class="full">EMAIL / MOBILE NUMBER *<input id="loginIdentifier" autocomplete="username" placeholder="leader@example.com or 03XXXXXXXXX" required></label>
          <label class="full">PASSWORD *<input id="loginPassword" type="password" autocomplete="current-password" placeholder="Your password" required></label>
        </div>
        <div class="auth-actions">
          <button class="btn btn-primary" type="submit">LOGIN TO ESPORTS</button>
          <button class="btn btn-secondary" id="loginRegisterBtn" type="button">NEW TEAM REGISTRATION</button>
        </div>
        <div class="status info show" style="margin-top:12px">Your team must be approved before the member area becomes active.</div>
      </form>`;
  }

  function registrationForm() {
    return `
      <div class="auth-title">
        <div class="kicker">CONTROLLED REGISTRATION</div>
        <h1 class="title">NEW TEAM REGISTRATION</h1>
        <p>Choose one of the two website roles for your team.</p>
      </div>
      <form id="registerForm" style="margin-top:16px">
        <div class="field-grid">
          <label>TEAM NAME *<input id="regTeamName" maxlength="50" placeholder="Your esports team" required></label>
          <label>MEMBER ROLE *<select id="regRole"><option value="leader">Team Leader / IGL</option><option value="sub_leader">Sub-Leader</option></select></label>
          <label>MEMBER / IGL NAME *<input id="regName" maxlength="60" placeholder="Name" required></label>
          <label>CONTACT NUMBER *<input id="regPhone" maxlength="20" placeholder="03XXXXXXXXX" required></label>
          <label class="full">EMAIL *<input id="regEmail" type="email" maxlength="120" placeholder="leader@example.com" required></label>
          <label>PASSWORD *<input id="regPassword" type="password" minlength="8" placeholder="Minimum 8 characters" required></label>
          <label>CONFIRM PASSWORD *<input id="regPassword2" type="password" minlength="8" placeholder="Repeat password" required></label>
          <label class="full">TEAM LOGO — OPTIONAL<input id="regLogo" type="file" accept="image/png,image/jpeg,image/webp"></label>
        </div>
        <div class="hint">Logo can be uploaded later from TEAM PROFILE after approval. PNG/JPG/WEBP • Maximum ${MAX_IMAGE_MB} MB.</div>
        <div class="access-note" style="margin-top:13px"><b>IMPORTANT:</b> Email confirmation may be required by Supabase. Your registration record is created server-side even when no session is returned.</div>
        <div class="auth-actions">
          <button class="btn btn-primary" type="submit">SUBMIT REGISTRATION</button>
          <button class="btn btn-secondary" id="registerBackBtn" type="button">BACK TO LOGIN</button>
        </div>
      </form>`;
  }

  function bindAuth() {
    document.getElementById("publicAdminBtn")?.addEventListener("click", () => {
      state.screen = "admin-login";
      render();
    });
    document.getElementById("loginRegisterBtn")?.addEventListener("click", goRegister);
    document.getElementById("registerBackBtn")?.addEventListener("click", goLogin);
    document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
    document.getElementById("registerForm")?.addEventListener("submit", handleRegister);
  }

  function goLogin() {
    const u = new URL(location.href);
    u.searchParams.delete("register");
    history.replaceState({}, "", u);
    state.screen = "login";
    render();
  }

  function goRegister() {
    const u = new URL(location.href);
    u.searchParams.set("register", "1");
    history.replaceState({}, "", u);
    state.screen = "register";
    render();
  }

  async function handleLogin(event) {
    event.preventDefault();
    const id = document.getElementById("loginIdentifier")?.value.trim() || "";
    const password = document.getElementById("loginPassword")?.value || "";

    try {
      if (!id || !password) throw new Error("Enter your login details.");
      const credentials = id.includes("@")
        ? { email: id.toLowerCase(), password }
        : { phone: cleanPhone(id), password };
      const { error } = await supabase.auth.signInWithPassword(credentials);
      if (error) throw error;
      await hydrateSession();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Login failed."), "error");
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    const teamName = document.getElementById("regTeamName")?.value.trim() || "";
    const role = document.getElementById("regRole")?.value || "";
    const name = document.getElementById("regName")?.value.trim() || "";
    const phone = cleanPhone(document.getElementById("regPhone")?.value || "");
    const email = (document.getElementById("regEmail")?.value.trim() || "").toLowerCase();
    const password = document.getElementById("regPassword")?.value || "";
    const password2 = document.getElementById("regPassword2")?.value || "";
    const file = document.getElementById("regLogo")?.files?.[0] || null;

    try {
      if (!teamName || !name || !email || !phone) throw new Error("Complete all required fields.");
      if (!/^\+92\d{10}$/.test(phone)) throw new Error("Enter a valid Pakistan mobile number.");
      if (!['leader', 'sub_leader'].includes(role)) throw new Error("Invalid website member role.");
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");
      if (password !== password2) throw new Error("Passwords do not match.");
      if (file && (file.size > MAX_IMAGE_MB * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type))) {
        throw new Error(`Logo must be PNG/JPG/WEBP and ${MAX_IMAGE_MB} MB or smaller.`);
      }

      // Do NOT upload the logo during signup. When email confirmation is enabled,
      // Supabase can return a user with no active session, so the browser cannot
      // safely upload to an authenticated storage path yet. Upload it later from Team Profile.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            team_name: teamName,
            display_name: name,
            phone,
            requested_role: role
          }
        }
      });

      if (error) throw error;
      if (!data?.user) throw new Error("Registration could not be created.");
      if (data.session) await supabase.auth.signOut();

      goLogin();
      showToast("Registration submitted. Status: PENDING for administrator approval.");
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Registration failed."), "error");
    }
  }

  async function uploadFile(bucket, uid, file) {
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const path = `${uid}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });
    if (error) throw error;
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  /* ========================= ADMIN LOGIN ========================= */

  function renderAdminLogin() {
    app.innerHTML = `
      ${authHeader()}
      <main class="public-page">
        <div class="auth-layout" style="grid-template-columns:.9fr 1.1fr;max-width:900px">
          <section class="card auth-hero" style="min-height:0">
            <div class="kicker">RESTRICTED CONTROL</div>
            <h1>ADMIN <span style="color:var(--blue2)">CENTER</span></h1>
            <h2>7TH UNIVERSE ESPORTS</h2>
            <div class="desc">Approve registrations, edit team information, manage members, ban/unban, remove/restore teams, verify results and moderate posts.</div>
            <div class="access-note"><b>PRIVATE:</b> Only an approved administrator can enter.</div>
          </section>
          <section class="card auth-card">
            <div class="auth-inner">
              <div class="auth-logo-row"><img src="./7th-universe-esports-logo.png" alt="7U"><div><strong>ADMIN LOGIN</strong><span>CONTROL CENTER</span></div></div>
              <form id="adminLoginForm">
                <div class="field-grid">
                  <label class="full">ADMIN EMAIL / MOBILE *<input id="adminId" autocomplete="username" required></label>
                  <label class="full">PASSWORD *<input id="adminPw" type="password" autocomplete="current-password" required></label>
                </div>
                <div class="auth-actions"><button class="btn btn-primary" type="submit">LOGIN AS ADMIN</button><button class="btn btn-dark" type="button" id="adminBack">BACK</button></div>
              </form>
            </div>
          </section>
        </div>
      </main>`;

    document.getElementById("adminLoginForm")?.addEventListener("submit", handleAdminLogin);
    document.getElementById("adminBack")?.addEventListener("click", goLogin);
  }

  async function handleAdminLogin(event) {
    event.preventDefault();
    const id = document.getElementById("adminId")?.value.trim() || "";
    const password = document.getElementById("adminPw")?.value || "";

    try {
      const credentials = id.includes("@")
        ? { email: id.toLowerCase(), password }
        : { phone: cleanPhone(id), password };
      const { data, error } = await supabase.auth.signInWithPassword(credentials);
      if (error) throw error;

      const profile = await getProfile(data.user.id);
      if (!profile || profile.role !== "admin" || profile.status !== "approved") {
        await supabase.auth.signOut();
        throw new Error("This account does not have approved administrator access.");
      }

      state.user = data.user;
      state.profile = profile;
      state.isAdmin = true;
      state.membership = await getMembership(data.user.id);
      state.team = state.membership?.teams || null;
      state.screen = "member";
      state.section = "admin";
      render();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Admin login failed."), "error");
    }
  }

  /* ========================= MEMBER SHELL ========================= */

  const navLink = (section, label) =>
    `<button class="app-link ${state.section === section ? "active" : ""}" data-section="${esc(section)}">${esc(label)}</button>`;

  function memberHeader() {
    return `
      <div class="app-header">
        <div class="app-nav">
          <div class="app-brand"><img src="./7th-universe-esports-logo.png" alt="7U"><div><strong>7TH <span style="color:var(--blue2)">UNIVERSE</span></strong><span>FREE FIRE ESPORTS</span></div></div>
          <nav class="app-nav-links">
            ${navLink("dashboard", "DASHBOARD")}
            ${navLink("practice", "PRACTICE")}
            ${navLink("results", "RESULTS")}
            ${navLink("rankings", "RANKINGS")}
            ${navLink("recruitment", "RECRUITMENT")}
            ${navLink("my-posts", "MY POSTS")}
            ${navLink("team-profile", "TEAM PROFILE")}
            ${state.isAdmin ? navLink("admin", "ADMIN") : ""}
            <button class="app-link" id="logoutBtn" type="button">LOGOUT</button>
          </nav>
          <div class="profile-chip">
            ${logo(state.team?.logo_url, state.team?.name || "7U", "profile-logo")}
            <div class="profile-meta"><small>${esc(roleName(state.profile?.role))}</small><strong>${esc(state.team?.name || state.profile?.display_name || "Member")}</strong></div>
          </div>
        </div>
      </div>`;
  }

  function renderMember() {
    app.innerHTML = `${memberHeader()}<main id="memberRoot" class="page"></main>`;
    document.querySelectorAll("[data-section]").forEach((button) => {
      button.addEventListener("click", () => {
        state.section = button.dataset.section;
        renderMember();
      });
    });
    document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
    loadMemberSection();
  }

  async function loadMemberSection() {
    const root = document.getElementById("memberRoot");
    if (!root) return;
    try {
      if (state.section === "dashboard") root.innerHTML = await dashboardPage();
      else if (state.section === "practice") { root.innerHTML = await practicePage(); bindPractice(); }
      else if (state.section === "results") { root.innerHTML = await resultsPage(); bindResults(); }
      else if (state.section === "rankings") root.innerHTML = await rankingsPage();
      else if (state.section === "recruitment") { root.innerHTML = recruitmentPage(); bindRecruitment(); }
      else if (state.section === "my-posts") root.innerHTML = await myPostsPage();
      else if (state.section === "team-profile") { root.innerHTML = teamProfilePage(); bindTeamProfile(); }
      else if (state.section === "admin" && state.isAdmin) { root.innerHTML = await adminPage(); bindAdmin(); }
      else { state.section = "dashboard"; renderMember(); return; }
      bindCards();
    } catch (error) {
      console.error(error);
      root.innerHTML = `<div class="container"><div class="empty"><b style="color:#fff">${esc(friendlyError(error, "Section failed to load."))}</b></div></div>`;
    }
  }

  /* ========================= DASHBOARD ========================= */

  async function openChallenges() {
    const { data, error } = await supabase
      .from("practice_challenges")
      .select("*")
      .eq("status", "open")
      .order("match_time", { ascending: true })
      .limit(100);
    if (error) throw error;
    state.challenges = data || [];
    return state.challenges;
  }

  async function openRecruitment() {
    const { data, error } = await supabase
      .from("recruitment_posts")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    state.recruitment = data || [];
    return state.recruitment;
  }

  async function getRankings() {
    const { data, error } = await supabase
      .from("team_rankings")
      .select("*")
      .order("rank_number", { ascending: true })
      .limit(250);
    if (error) throw error;
    state.rankings = data || [];
    return state.rankings;
  }

  async function dashboardPage() {
    const [challenges, recruitment, rankings] = await Promise.all([
      openChallenges(),
      openRecruitment(),
      getRankings()
    ]);
    const mine = state.team ? rankings.find((row) => row.team_id === state.team.id) : null;

    return `
      <div class="container">
        <section class="hero">
          <div class="kicker">7TH UNIVERSE ESPORTS • MEMBER HUB</div>
          <h2>${esc(state.team?.name || state.profile?.display_name || "WELCOME")}</h2>
          <p>Free Fire esports workspace for Clash Squad practice, permanent results, recruitment and all-time rankings.</p>
          <div class="hero-actions">
            <button class="btn btn-primary" data-go="practice">⚔ CREATE PRACTICE</button>
            <button class="btn btn-cyan" data-go="results">＋ SUBMIT RESULT</button>
            <button class="btn btn-dark" data-go="rankings">★ VIEW RANKINGS</button>
            <button class="btn btn-dark" data-go="team-profile">◈ TEAM PROFILE</button>
            ${state.isAdmin ? `<button class="btn btn-dark" data-go="admin">▣ ADMIN CENTER</button>` : ""}
          </div>
        </section>

        <section class="quick-grid">
          <div class="quick"><div class="qicon">${mine ? `#${esc(mine.rank_number)}` : "—"}</div><b>ALL-TIME RANK</b><span>Permanent position. Never reset.</span></div>
          <div class="quick"><div class="qicon">${mine ? esc(mine.total_points) : 0}</div><b>PERMANENT POINTS</b><span>WIN +3 • LOSS −3.</span></div>
          <div class="quick"><div class="qicon">${mine ? esc(mine.wins) : 0}</div><b>WINS</b><span>Verified permanent results.</span></div>
          <div class="quick"><div class="qicon">${mine ? esc(mine.losses) : 0}</div><b>LOSSES</b><span>Verified permanent results.</span></div>
        </section>

        <section class="member-grid">
          <div class="panel"><div class="panel-head"><div><div class="kicker">LIVE ARENA</div><h3>OPEN PRACTICE</h3></div><span class="badge badge-green">${challenges.length} LIVE</span></div><div class="feed-list">${challenges.slice(0, 5).map(challengeCard).join("") || `<div class="empty">No open practice challenges.</div>`}</div></div>
          <div class="stack">
            <div class="panel"><div class="panel-head"><div><div class="kicker">ALL-TIME</div><h3>TOP RANKING</h3></div><span class="badge badge-blue">NEVER RESET</span></div><div class="feed-list">${rankings.slice(0, 5).map(rankingMini).join("") || `<div class="empty">No active teams.</div>`}</div></div>
            <div class="panel"><div class="panel-head"><div><div class="kicker">DIRECTORY</div><h3>RECRUITMENT</h3></div><span class="badge badge-cyan">${recruitment.length} OPEN</span></div><div class="feed-list">${recruitment.slice(0, 4).map(recruitmentCard).join("") || `<div class="empty">No recruitment posts.</div>`}</div></div>
          </div>
        </section>
      </div>`;
  }

  function challengeCard(challenge) {
    return `
      <article class="challenge-card">
        <div class="row-between">
          <div class="identity">${logo(challenge.team_logo_url, challenge.team_name || "7U")}<div><div class="name">${esc(challenge.team_name)}</div><div class="meta">FREE FIRE • CLASH SQUAD • EVERYONE</div></div></div>
          <span class="badge badge-green">OPEN</span>
        </div>
        <div class="pills"><span class="pill">${esc(challenge.match_type)}</span><span class="pill">${esc(challenge.format)}</span><span class="pill">EVERYONE</span></div>
        <div class="info-row"><div class="info-box"><small>Match Time</small><strong>${esc(formatDate(challenge.match_time))}</strong></div><div class="info-box"><small>Contact</small><strong>${esc(challenge.contact || "—")}</strong></div></div>
        ${challenge.notes ? `<div class="note">${esc(challenge.notes)}</div>` : ""}
        <div class="card-actions"><button class="btn btn-primary btn-small" data-wa="${esc(challenge.contact || "")}">CONTACT</button><button class="btn btn-dark btn-small" data-json='${esc(JSON.stringify(challenge))}'>DETAILS</button></div>
      </article>`;
  }

  function recruitmentCard(post) {
    const roles = Array.isArray(post.looking_for) ? post.looking_for.join(" • ") : (post.looking_for || "—");
    return `
      <article class="recruit-card">
        <div class="row-between">
          <div class="identity">${logo(post.team_logo_url, post.team_name || post.player_ign || "7U")}<div><div class="name">${esc(post.team_name || post.player_ign || "PLAYER")}</div><div class="meta">FREE FIRE • ${esc(String(post.listing_type || "").replaceAll("_", " "))}</div></div></div>
          <span class="badge badge-cyan">OPEN</span>
        </div>
        <div class="pills"><span class="pill">${esc(roles)}</span>${post.players_needed ? `<span class="pill">${esc(post.players_needed)} NEEDED</span>` : ""}</div>
        <div class="info-row"><div class="info-box"><small>Availability</small><strong>${esc(post.availability || "—")}</strong></div><div class="info-box"><small>Age</small><strong>${esc(post.age_requirement || "—")}</strong></div>${post.player_ign ? `<div class="info-box"><small>IGN</small><strong>${esc(post.player_ign)}</strong></div>` : ""}</div>
        ${post.notes ? `<div class="note">${esc(post.notes)}</div>` : ""}
        <div class="card-actions"><button class="btn btn-cyan btn-small" data-wa="${esc(post.contact || "")}">CONTACT</button><button class="btn btn-dark btn-small" data-json='${esc(JSON.stringify(post))}'>DETAILS</button></div>
      </article>`;
  }

  function rankingMini(row) {
    return `<div class="challenge-card"><div class="row-between"><div class="identity">${logo(row.logo_url, row.team_name)}<div><div class="name">#${esc(row.rank_number)} ${esc(row.team_name)}</div><div class="meta">${esc(row.wins)} W • ${esc(row.losses)} L • ${esc(row.matches)} MATCHES</div></div></div><span class="badge badge-blue">${esc(row.total_points)} PTS</span></div></div>`;
  }

  /* ========================= PRACTICE ========================= */

  async function practicePage() {
    const challenges = await openChallenges();
    return `
      <div class="container">
        <div style="margin-bottom:16px"><div class="kicker">LIVE ARENA</div><h1 class="title">CLASH SQUAD PRACTICE</h1><div class="desc">Post a practice challenge for <b>EVERYONE</b>. There is intentionally no opponent-team field.</div></div>
        <section class="panel form-card">
          <div class="panel-head"><div><div class="kicker">CREATE</div><h3>PRACTICE CHALLENGE</h3></div><span class="badge badge-blue">EVERYONE</span></div>
          <div class="form-tip">FREE FIRE • CLASH SQUAD • EVERYONE • SINGLE / BEST OF 3 • SQUAD / TRIO / DUO / SOLO</div>
          <form id="practiceForm"><div class="field-grid">
            <label>MATCH TYPE *<select id="practiceMatchType"><option value="SINGLE">SINGLE MATCH</option><option value="BEST OF 3">BEST OF 3</option></select></label>
            <label>FORMAT *<select id="practiceFormat"><option value="SQUAD">SQUAD</option><option value="TRIO">TRIO</option><option value="DUO">DUO</option><option value="SOLO">SOLO</option></select></label>
            <label>MATCH TIME *<input id="practiceTime" type="datetime-local" required></label>
            <label>CONTACT / WHATSAPP *<input id="practiceContact" value="${esc(state.profile?.phone || "")}" required placeholder="03XXXXXXXXX"></label>
            <label class="full">ADDITIONAL NOTES<textarea id="practiceNotes" maxlength="500"></textarea></label>
          </div><div class="auth-actions" style="justify-content:flex-start"><button class="btn btn-primary" type="submit">POST OPEN CHALLENGE</button></div></form>
        </section>
        <section class="section" style="margin-top:16px"><div class="panel-head"><div><div class="kicker">PUBLIC LIST</div><h3>OPEN CHALLENGES</h3></div><span class="badge badge-green">${challenges.length} LIVE</span></div><div class="feed-list">${challenges.map(challengeCard).join("") || `<div class="empty">No open challenges.</div>`}</div></section>
      </div>`;
  }

  function bindPractice() {
    document.getElementById("practiceForm")?.addEventListener("submit", submitPractice);
  }

  async function submitPractice(event) {
    event.preventDefault();
    try {
      if (!state.team) throw new Error("Approved team membership is required.");
      const raw = document.getElementById("practiceTime")?.value || "";
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) throw new Error("Choose a valid match time.");
      const contact = cleanPhone(document.getElementById("practiceContact")?.value || "");
      if (!/^\+92\d{10}$/.test(contact)) throw new Error("Enter a valid Pakistan contact number.");

      const { error } = await supabase.rpc("create_practice_challenge", {
        p_team_id: state.team.id,
        p_team_name: state.team.name,
        p_team_logo_url: state.team.logo_url || null,
        p_match_type: document.getElementById("practiceMatchType")?.value,
        p_match_time: date.toISOString(),
        p_format: document.getElementById("practiceFormat")?.value,
        p_contact: contact,
        p_notes: document.getElementById("practiceNotes")?.value.trim() || null
      });
      if (error) throw error;
      showToast("Practice challenge posted for EVERYONE.");
      await loadMemberSection();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not post challenge."), "error");
    }
  }

  /* ========================= RESULTS ========================= */

  async function getMyResults() {
    const { data, error } = await supabase
      .from("team_match_results")
      .select("*")
      .eq("team_id", state.team?.id || EMPTY_UUID)
      .order("played_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data || [];
  }

  async function getVerifiedResults() {
    const { data, error } = await supabase
      .from("team_match_results")
      .select("*")
      .eq("status", "approved")
      .order("played_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data || [];
  }

  function resultCard(row) {
    const win = row.outcome === "WIN";
    return `<div class="challenge-card"><div class="row-between"><div><div class="name">VS ${esc(row.opponent_team_name)}</div><div class="meta">${esc(row.match_type)} • ${esc(row.format)} • ${esc(formatDate(row.played_at))}</div></div><span class="badge ${win ? "badge-green" : "badge-danger"}">${win ? "WIN +3" : "LOSS −3"}</span></div><div class="pills"><span class="pill">${esc(String(row.status || "pending").toUpperCase())}</span>${row.opponent_team_uid ? `<span class="pill">UID ${esc(row.opponent_team_uid)}</span>` : ""}</div>${row.notes ? `<div class="note">${esc(row.notes)}</div>` : ""}${row.proof_url ? `<div class="card-actions"><button class="btn btn-dark btn-small" data-proof="${esc(row.proof_url)}">VIEW PROOF</button></div>` : ""}</div>`;
  }

  async function resultsPage() {
    const [mine, verified] = await Promise.all([getMyResults(), getVerifiedResults()]);
    return `
      <div class="container">
        <div style="margin-bottom:16px"><div class="kicker">PERMANENT RECORD</div><h1 class="title">MATCH RESULTS</h1><div class="desc">Submit completed matches. <b>WIN = +3</b> • <b>LOSS = −3</b>. Approved records remain in the all-time ranking.</div></div>
        <section class="panel form-card">
          <div class="panel-head"><div><div class="kicker">SUBMIT FOR REVIEW</div><h3>TEAM RESULT</h3></div><span class="badge badge-blue">ADMIN REVIEW</span></div>
          <form id="resultForm"><div class="field-grid">
            <label>OPPONENT TEAM NAME *<input id="resultOpponent" maxlength="80" required></label>
            <label>OPPONENT UID<input id="resultOpponentUid" maxlength="30"></label>
            <label>MATCH TYPE *<select id="resultMatchType"><option value="SINGLE">SINGLE MATCH</option><option value="BEST OF 3">BEST OF 3</option></select></label>
            <label>FORMAT *<select id="resultFormat"><option value="SQUAD">SQUAD</option><option value="TRIO">TRIO</option><option value="DUO">DUO</option><option value="SOLO">SOLO</option></select></label>
            <label>OUTCOME *<select id="resultOutcome"><option value="WIN">WIN (+3)</option><option value="LOSS">LOSS (−3)</option></select></label>
            <label>PLAYED AT *<input id="resultPlayedAt" type="datetime-local" required></label>
            <label class="full">PROOF SCREENSHOT — OPTIONAL<input id="resultProof" type="file" accept="image/png,image/jpeg,image/webp"></label>
            <label class="full">NOTES<textarea id="resultNotes" maxlength="500"></textarea></label>
          </div><div class="hint">Proof image: PNG/JPG/WEBP • Maximum ${MAX_IMAGE_MB} MB.</div><div class="auth-actions" style="justify-content:flex-start"><button class="btn btn-primary" type="submit">SUBMIT RESULT</button></div></form>
        </section>
        <section class="member-grid" style="margin-top:14px"><div class="panel"><div class="panel-head"><div><div class="kicker">MY RECORDS</div><h3>MY SUBMISSIONS</h3></div></div><div class="feed-list">${mine.map(resultCard).join("") || `<div class="empty">No results submitted yet.</div>`}</div></div><div class="panel"><div class="panel-head"><div><div class="kicker">VERIFIED</div><h3>RECENT APPROVED RESULTS</h3></div></div><div class="feed-list">${verified.slice(0, 10).map(resultCard).join("") || `<div class="empty">No approved results yet.</div>`}</div></div></section>
      </div>`;
  }

  function bindResults() {
    document.getElementById("resultForm")?.addEventListener("submit", submitResult);
  }

  async function submitResult(event) {
    event.preventDefault();
    try {
      if (!state.team) throw new Error("Approved team membership is required.");
      const proof = document.getElementById("resultProof")?.files?.[0] || null;
      if (proof && (proof.size > MAX_IMAGE_MB * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(proof.type))) {
        throw new Error(`Proof image must be PNG/JPG/WEBP and ${MAX_IMAGE_MB} MB or smaller.`);
      }
      const played = new Date(document.getElementById("resultPlayedAt")?.value || "");
      if (Number.isNaN(played.getTime())) throw new Error("Choose a valid played-at time.");

      let proofUrl = null;
      if (proof) proofUrl = await uploadFile(RESULT_BUCKET, state.user.id, proof);

      const { error } = await supabase.rpc("submit_team_result", {
        p_team_id: state.team.id,
        p_opponent_team_name: document.getElementById("resultOpponent")?.value.trim(),
        p_opponent_team_uid: document.getElementById("resultOpponentUid")?.value.trim() || null,
        p_match_type: document.getElementById("resultMatchType")?.value,
        p_format: document.getElementById("resultFormat")?.value,
        p_outcome: document.getElementById("resultOutcome")?.value,
        p_played_at: played.toISOString(),
        p_proof_url: proofUrl,
        p_notes: document.getElementById("resultNotes")?.value.trim() || null
      });
      if (error) throw error;
      showToast("Result submitted. Status: PENDING ADMIN REVIEW.");
      await loadMemberSection();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not submit result."), "error");
    }
  }

  /* ========================= RANKINGS ========================= */

  async function rankingsPage() {
    const rankings = await getRankings();
    return `<div class="container"><div style="margin-bottom:16px"><div class="kicker">PERMANENT LEADERBOARD</div><h1 class="title">ALL-TIME RANKINGS</h1><div class="desc">Rankings never reset. Only administrator-approved results affect points.</div></div><section class="panel"><div class="table-shell"><table><thead><tr><th>Rank</th><th>Team</th><th>Points</th><th>Matches</th><th>Wins</th><th>Losses</th><th>Win Rate</th></tr></thead><tbody>${rankings.map((row) => `<tr><td><strong>#${esc(row.rank_number)}</strong></td><td><div class="identity">${logo(row.logo_url, row.team_name, "mini-logo")}<div><strong>${esc(row.team_name)}</strong><div style="color:#5a738b;margin-top:2px">IGL: ${esc(row.igl_name || "—")}</div></div></div></td><td><span class="badge badge-blue">${esc(row.total_points)}</span></td><td>${esc(row.matches)}</td><td>${esc(row.wins)}</td><td>${esc(row.losses)}</td><td>${esc(row.win_rate)}%</td></tr>`).join("") || `<tr><td colspan="7">No active teams yet.</td></tr>`}</tbody></table></div></section></div>`;
  }

  /* ========================= RECRUITMENT ========================= */

  function recruitmentPage() {
    return `<div class="container"><div style="margin-bottom:16px"><div class="kicker">COMPETITIVE DIRECTORY</div><h1 class="title">FREE FIRE RECRUITMENT</h1><div class="desc">Create a team requirement or publish a player listing.</div></div><section class="panel form-card"><div class="panel-head"><div><div class="kicker">CREATE</div><h3>RECRUITMENT POST</h3></div><span class="badge badge-cyan">TEAM + PLAYER</span></div><form id="recruitForm"><label style="margin-bottom:12px">LISTING TYPE *<select id="recruitType"><option value="TEAM_RECRUITMENT">TEAM RECRUITMENT — WE NEED PLAYERS</option><option value="PLAYER_RECRUITMENT">PLAYER RECRUITMENT — I NEED A TEAM</option></select></label><div id="teamFields"><div class="field-grid"><label>TEAM NAME<input value="${esc(state.team?.name || "")}" disabled></label><label>PLAYERS NEEDED<select id="recruitPlayersNeeded"><option>1</option><option>2</option><option>3</option><option>4</option></select></label><label class="full">LOOKING FOR *<select id="recruitLookingFor" multiple size="5"><option>Rusher</option><option>Sniper</option><option>Support</option><option>Entry Fragger</option><option>All-Rounder</option></select></label></div></div><div id="playerFields" class="hidden"><div class="field-grid"><label>PLAYER IGN *<input id="playerIgn" maxlength="40"></label><label>FREE FIRE UID *<input id="playerUid" maxlength="20"></label><label class="full">PREFERRED ROLE *<select id="playerRole"><option>Rusher</option><option>Sniper</option><option>Support</option><option>Entry Fragger</option><option>All-Rounder</option></select></label></div></div><div class="field-grid" style="margin-top:12px"><label>AVAILABILITY *<input id="recruitAvailability" required placeholder="5 PM – 11 PM"></label><label>AGE / AGE REQUIREMENT *<input id="recruitAge" required placeholder="16+"></label><label>CONTACT / WHATSAPP *<input id="recruitContact" value="${esc(state.profile?.phone || "")}" required></label><label>EXPERIENCE<input id="recruitExperience" maxlength="160"></label><label class="full">EXTRA DETAILS<textarea id="recruitNotes" maxlength="600"></textarea></label></div><div class="auth-actions" style="justify-content:flex-start"><button class="btn btn-cyan" type="submit">PUBLISH RECRUITMENT</button></div></form></section></div>`;
  }

  function bindRecruitment() {
    document.getElementById("recruitType")?.addEventListener("change", toggleRecruit);
    document.getElementById("recruitForm")?.addEventListener("submit", submitRecruit);
    toggleRecruit();
  }

  function toggleRecruit() {
    const team = document.getElementById("recruitType")?.value === "TEAM_RECRUITMENT";
    document.getElementById("teamFields")?.classList.toggle("hidden", !team);
    document.getElementById("playerFields")?.classList.toggle("hidden", team);
    if (document.getElementById("playerIgn")) document.getElementById("playerIgn").required = !team;
    if (document.getElementById("playerUid")) document.getElementById("playerUid").required = !team;
  }

  async function submitRecruit(event) {
    event.preventDefault();
    try {
      const type = document.getElementById("recruitType")?.value;
      const contact = cleanPhone(document.getElementById("recruitContact")?.value || "");
      if (!/^\+92\d{10}$/.test(contact)) throw new Error("Enter a valid Pakistan contact number.");

      let roles = [];
      let ign = null;
      let uid = null;
      if (type === "TEAM_RECRUITMENT") {
        if (!state.team) throw new Error("Approved team membership is required.");
        roles = [...(document.getElementById("recruitLookingFor")?.selectedOptions || [])].map((o) => o.value);
        if (!roles.length) throw new Error("Select at least one role.");
      } else {
        ign = document.getElementById("playerIgn")?.value.trim();
        uid = document.getElementById("playerUid")?.value.trim();
        roles = [document.getElementById("playerRole")?.value];
        if (!ign || !uid) throw new Error("Player IGN and UID are required.");
      }

      const { error } = await supabase.rpc("create_recruitment_post", {
        p_team_id: state.team?.id || null,
        p_team_name: state.team?.name || ign,
        p_team_logo_url: state.team?.logo_url || null,
        p_listing_type: type,
        p_looking_for: roles,
        p_players_needed: type === "TEAM_RECRUITMENT" ? Number(document.getElementById("recruitPlayersNeeded")?.value || 1) : 1,
        p_availability: document.getElementById("recruitAvailability")?.value.trim(),
        p_age_requirement: document.getElementById("recruitAge")?.value.trim(),
        p_contact: contact,
        p_experience: document.getElementById("recruitExperience")?.value.trim() || null,
        p_player_ign: ign,
        p_player_uid: uid,
        p_notes: document.getElementById("recruitNotes")?.value.trim() || null
      });
      if (error) throw error;
      showToast("Recruitment post published.");
      await loadMemberSection();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not publish recruitment."), "error");
    }
  }

  /* ========================= TEAM PROFILE ========================= */

  function teamProfilePage() {
    if (!state.team) return `<div class="container"><div class="empty">No approved team is attached to this account.</div></div>`;
    const canEditTeam = state.isAdmin || state.profile?.role === "leader";
    return `<div class="container"><div style="margin-bottom:16px"><div class="kicker">TEAM IDENTITY</div><h1 class="title">TEAM PROFILE</h1><div class="desc">Team Leaders and Administrators can edit team identity. Every member can keep their own name/contact data updated.</div></div><section class="member-grid"><div class="panel"><div class="panel-head"><div><div class="kicker">CURRENT</div><h3>${esc(state.team.name)}</h3></div><span class="badge badge-green">${esc(state.team.status)}</span></div><div style="display:flex;align-items:center;gap:14px">${logo(state.team.logo_url, state.team.name, "profile-logo")}<div><div class="name">${esc(state.team.name)}</div><div class="meta">IGL: ${esc(state.team.igl_name || "—")}</div></div></div></div><div class="panel"><div class="panel-head"><div><div class="kicker">EDIT</div><h3>${canEditTeam ? "TEAM + MEMBER SETTINGS" : "MY MEMBER SETTINGS"}</h3></div></div><form id="teamProfileForm"><div class="field-grid">${canEditTeam ? `<label>TEAM NAME *<input id="profileTeamName" value="${esc(state.team.name)}" maxlength="50" required></label><label>IGL NAME *<input id="profileIglName" value="${esc(state.team.igl_name || "")}" maxlength="60" required></label><label class="full">NEW TEAM LOGO — OPTIONAL<input id="profileLogo" type="file" accept="image/png,image/jpeg,image/webp"><div class="hint">Leave empty to keep the current logo. Uploading a new image replaces the displayed logo URL.</div></label>` : `<div class="full access-note"><b>TEAM IDENTITY LOCKED:</b> Only Team Leader/IGL or Administrator can change the team name, IGL or logo.</div>`}<label>MY MEMBER NAME<input id="profileMemberName" value="${esc(state.profile?.display_name || "")}" maxlength="60"></label><label>MY CONTACT<input id="profilePhone" value="${esc(state.profile?.phone || "")}" maxlength="20"></label></div><div class="auth-actions" style="justify-content:flex-start"><button class="btn btn-primary" type="submit">SAVE PROFILE</button></div></form></div></section></div>`;
  }

  function bindTeamProfile() {
    document.getElementById("teamProfileForm")?.addEventListener("submit", saveTeamProfile);
  }

  async function saveTeamProfile(event) {
    event.preventDefault();
    try {
      const canEditTeam = state.isAdmin || state.profile?.role === "leader";
      const memberName = document.getElementById("profileMemberName")?.value.trim() || "";
      const phone = cleanPhone(document.getElementById("profilePhone")?.value || "");
      if (phone && !/^\+92\d{10}$/.test(phone)) throw new Error("Enter a valid Pakistan contact number.");

      let teamName = state.team.name;
      let igl = state.team.igl_name || "";
      let logoUrl = state.team.logo_url || null;

      if (canEditTeam) {
        teamName = document.getElementById("profileTeamName")?.value.trim() || "";
        igl = document.getElementById("profileIglName")?.value.trim() || "";
        if (!teamName || !igl) throw new Error("Team name and IGL name are required.");
        const file = document.getElementById("profileLogo")?.files?.[0] || null;
        if (file) {
          if (file.size > MAX_IMAGE_MB * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
            throw new Error(`Logo must be PNG/JPG/WEBP and ${MAX_IMAGE_MB} MB or smaller.`);
          }
          logoUrl = await uploadFile(LOGO_BUCKET, state.user.id, file);
        }
      }

      const { error } = await supabase.rpc("update_team_profile", {
        p_team_id: state.team.id,
        p_team_name: teamName,
        p_igl_name: igl,
        p_logo_url: logoUrl,
        p_member_name: memberName || state.profile.display_name,
        p_phone: phone || state.profile.phone || null
      });
      if (error) throw error;

      state.profile = await getProfile(state.user.id);
      state.membership = await getMembership(state.user.id);
      state.team = state.membership?.teams || state.team;
      showToast("Team/member profile updated successfully.");
      renderMember();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not update profile."), "error");
    }
  }

  /* ========================= MY POSTS ========================= */

  async function myPostsPage() {
    if (!state.team) return `<div class="container"><div class="empty">No team attached.</div></div>`;
    const [challenges, posts] = await Promise.all([
      supabase.from("practice_challenges").select("*").eq("team_id", state.team.id).order("created_at", { ascending: false }),
      supabase.from("recruitment_posts").select("*").eq("team_id", state.team.id).order("created_at", { ascending: false })
    ]);
    if (challenges.error) throw challenges.error;
    if (posts.error) throw posts.error;
    return `<div class="container"><div style="margin-bottom:16px"><div class="kicker">TEAM ACTIVITY</div><h1 class="title">MY POSTS</h1><div class="desc">${esc(state.team.name)}</div></div><section class="member-grid"><div class="panel"><div class="panel-head"><div><div class="kicker">PRACTICE</div><h3>MY CHALLENGES</h3></div></div><div class="feed-list">${(challenges.data || []).map(challengeCard).join("") || `<div class="empty">No practice posts.</div>`}</div></div><div class="panel"><div class="panel-head"><div><div class="kicker">RECRUITMENT</div><h3>MY RECRUITMENT</h3></div></div><div class="feed-list">${(posts.data || []).map(recruitmentCard).join("") || `<div class="empty">No recruitment posts.</div>`}</div></div></section></div>`;
  }

  /* ========================= ADMIN CENTER ========================= */

  async function adminPage() {
    const [profiles, teams, challenges, recruitment, results] = await Promise.all([
      supabase.from("profiles").select("*").neq("role", "admin").order("created_at", { ascending: false }).limit(300),
      supabase.from("teams").select("*").order("created_at", { ascending: false }).limit(300),
      supabase.from("practice_challenges").select("*").order("created_at", { ascending: false }).limit(300),
      supabase.from("recruitment_posts").select("*").order("created_at", { ascending: false }).limit(300),
      supabase.from("team_match_results").select("*").order("created_at", { ascending: false }).limit(300)
    ]);

    for (const query of [profiles, teams, challenges, recruitment, results]) if (query.error) throw query.error;

    state.registrations = profiles.data || [];
    state.teams = teams.data || [];
    state.challenges = challenges.data || [];
    state.recruitment = recruitment.data || [];
    state.results = results.data || [];

    const pending = state.registrations.filter((row) => row.status === "pending").length;
    const resultPending = state.results.filter((row) => row.status === "pending").length;

    return `<div class="container"><div style="margin-bottom:16px"><div class="kicker">RESTRICTED CONTROL</div><div class="admin-toolbar"><div><h1 class="title" style="margin-bottom:6px">ADMIN CONTROL CENTER</h1><div class="desc">Approval, member management, team editing, ban/unban, soft-remove/restore, result verification and post moderation.</div></div><div class="toolbar-actions"><button class="btn btn-dark btn-small" id="adminDashboardBtn" type="button">DASHBOARD</button><button class="btn btn-logout btn-small" id="adminLogoutBtn" type="button">LOGOUT</button></div></div></div><div class="quick-grid"><div class="quick"><div class="qicon">${pending}</div><b>PENDING MEMBERS</b><span>Registration queue.</span></div><div class="quick"><div class="qicon">${resultPending}</div><b>PENDING RESULTS</b><span>Verification queue.</span></div><div class="quick"><div class="qicon">${state.teams.length}</div><b>TEAMS</b><span>Full team directory.</span></div><div class="quick"><div class="qicon">${state.results.filter((row) => row.status === "approved").length}</div><b>VERIFIED RESULTS</b><span>Permanent records.</span></div></div><div class="admin-grid" style="margin-top:16px"><aside class="admin-tabs"><button class="admin-tab ${state.adminSection === "registrations" ? "active" : ""}" data-admin="registrations">REGISTRATIONS <span class="admin-count">${pending}</span></button><button class="admin-tab ${state.adminSection === "members" ? "active" : ""}" data-admin="members">MEMBERS</button><button class="admin-tab ${state.adminSection === "teams" ? "active" : ""}" data-admin="teams">TEAMS</button><button class="admin-tab ${state.adminSection === "results" ? "active" : ""}" data-admin="results">RESULTS <span class="admin-count">${resultPending}</span></button><button class="admin-tab ${state.adminSection === "practice" ? "active" : ""}" data-admin="practice">PRACTICE</button><button class="admin-tab ${state.adminSection === "recruitment" ? "active" : ""}" data-admin="recruitment">RECRUITMENT</button></aside><section>${adminContent()}</section></div></div>`;
  }

  function adminContent() {
    if (state.adminSection === "teams") return adminTeamsContent();
    if (state.adminSection === "members") return adminMembersContent();
    if (state.adminSection === "results") return adminResultsContent();
    if (state.adminSection === "practice") return adminPracticeContent();
    if (state.adminSection === "recruitment") return adminRecruitmentContent();
    return adminRegistrationsContent();
  }

  function adminRegistrationsContent() {
    const pending = state.registrations.filter((row) => row.status === "pending");
    return `<div class="panel"><div class="panel-head"><div><div class="kicker">FIRST PRIORITY</div><h3>PENDING REGISTRATIONS</h3><div class="subtle">New Auth signups are inserted by the database trigger and appear here even when email confirmation is required.</div></div><span class="badge badge-warn">${pending.length} PENDING</span></div><div class="table-shell"><table><thead><tr><th>Member</th><th>Team</th><th>Role</th><th>Contact</th><th>Status</th><th>Control</th></tr></thead><tbody>${pending.map((row) => `<tr><td>${esc(row.display_name)}</td><td>${esc(row.team_name || "—")}</td><td>${esc(roleName(row.role))}</td><td>${esc(row.phone || "—")}</td><td>${esc(row.status)}</td><td><button class="btn btn-green btn-small" data-profile-status="${esc(row.id)}" data-next="approved">APPROVE</button> <button class="btn btn-danger btn-small" data-profile-status="${esc(row.id)}" data-next="rejected">REJECT</button></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">No pending registrations.</div></td></tr>`}</tbody></table></div></div>`;
  }

  function adminMembersContent() {
    return `<div class="panel"><div class="panel-head"><div><div class="kicker">MEMBER DIRECTORY</div><h3>ALL WEBSITE MEMBERS</h3><div class="subtle">Edit member name/contact/role. Approve, reject, ban or unban from here.</div></div></div><div class="table-shell"><table><thead><tr><th>Member</th><th>Team</th><th>Role</th><th>Contact</th><th>Status</th><th>Control</th></tr></thead><tbody>${state.registrations.map((row) => `<tr><td><strong>${esc(row.display_name)}</strong></td><td>${esc(row.team_name || "—")}</td><td>${esc(roleName(row.role))}</td><td>${esc(row.phone || "—")}</td><td>${esc(row.status)}</td><td><div class="admin-action-grid"><button class="btn btn-dark btn-small" data-edit-member="${esc(row.id)}">EDIT</button>${row.status === "approved" ? `<button class="btn btn-danger btn-small" data-profile-status="${esc(row.id)}" data-next="banned">BAN</button>` : row.status === "banned" ? `<button class="btn btn-green btn-small" data-profile-status="${esc(row.id)}" data-next="approved">UNBAN</button>` : row.status === "pending" ? `<button class="btn btn-green btn-small" data-profile-status="${esc(row.id)}" data-next="approved">APPROVE</button>` : ""}</div></td></tr>`).join("") || `<tr><td colspan="6">No members.</td></tr>`}</tbody></table></div></div>`;
  }

  function adminTeamsContent() {
    return `<div class="panel"><div class="panel-head"><div><div class="kicker">TEAM MANAGEMENT</div><h3>ALL TEAMS</h3><div class="subtle">EDIT TEAM INFO, BAN/UNBAN, or REMOVE/RESTORE a team. REMOVE is a soft removal so historical result records remain intact.</div></div></div><div class="table-shell"><table><thead><tr><th>Team</th><th>IGL</th><th>Status</th><th>Created</th><th>Control</th></tr></thead><tbody>${state.teams.map((team) => {
      const action = team.status === "banned" ? `<button class="btn btn-green btn-small" data-team-status="${esc(team.id)}" data-next="active">UNBAN</button>` : `<button class="btn btn-danger btn-small" data-team-status="${esc(team.id)}" data-next="banned">BAN</button>`;
      const removeAction = team.status === "removed" ? `<button class="btn btn-green btn-small" data-team-status="${esc(team.id)}" data-next="active">RESTORE</button>` : `<button class="btn btn-danger btn-small" data-team-status="${esc(team.id)}" data-next="removed">REMOVE</button>`;
      return `<tr><td><div class="identity">${logo(team.logo_url, team.name)}<strong>${esc(team.name)}</strong></div></td><td>${esc(team.igl_name || "—")}</td><td><span class="badge ${team.status === "active" ? "badge-green" : team.status === "banned" ? "badge-danger" : "badge-warn"}">${esc(team.status)}</span></td><td>${esc(formatDate(team.created_at))}</td><td><div class="admin-action-grid"><button class="btn btn-primary btn-small" data-edit-team="${esc(team.id)}">EDIT TEAM INFO</button>${action}${removeAction}</div></td></tr>`;
    }).join("") || `<tr><td colspan="5">No teams.</td></tr>`}</tbody></table></div></div>`;
  }

  function adminResultsContent() {
    const teamName = (id) => state.teams.find((team) => team.id === id)?.name || id;
    return `<div class="panel"><div class="panel-head"><div><div class="kicker">VERIFY</div><h3>MATCH RESULTS</h3><div class="subtle">Only approved results affect the permanent ranking.</div></div><span class="badge badge-blue">WIN +3 • LOSS −3</span></div><div class="table-shell"><table><thead><tr><th>Team</th><th>Opponent</th><th>Outcome</th><th>Points</th><th>Played</th><th>Status</th><th>Control</th></tr></thead><tbody>${state.results.map((row) => `<tr><td><strong>${esc(teamName(row.team_id))}</strong></td><td>${esc(row.opponent_team_name)}</td><td>${esc(row.outcome)}</td><td><strong>${row.outcome === "WIN" ? "+3" : "−3"}</strong></td><td>${esc(formatDate(row.played_at))}</td><td>${esc(row.status)}</td><td>${row.proof_url ? `<button class="btn btn-dark btn-small" data-proof="${esc(row.proof_url)}">VIEW PROOF</button> ` : ""}${row.status === "pending" ? `<button class="btn btn-green btn-small" data-review="${esc(row.id)}" data-next="approved">APPROVE</button> <button class="btn btn-danger btn-small" data-review="${esc(row.id)}" data-next="rejected">REJECT</button>` : "—"}</td></tr>`).join("") || `<tr><td colspan="7">No results.</td></tr>`}</tbody></table></div></div>`;
  }

  function adminPracticeContent() {
    return `<div class="panel"><div class="panel-head"><div><div class="kicker">LIVE ARENA</div><h3>PRACTICE CHALLENGES</h3></div></div><div class="table-shell"><table><thead><tr><th>Team</th><th>Match</th><th>Format</th><th>Time</th><th>Status</th><th>Control</th></tr></thead><tbody>${state.challenges.map((challenge) => `<tr><td>${esc(challenge.team_name)}</td><td>${esc(challenge.match_type)}</td><td>${esc(challenge.format)}</td><td>${esc(formatDate(challenge.match_time))}</td><td>${esc(challenge.status)}</td><td><button class="btn btn-dark btn-small" data-post="practice" data-id="${esc(challenge.id)}" data-next="${challenge.status === "open" ? "closed" : "open"}">${challenge.status === "open" ? "CLOSE" : "REOPEN"}</button></td></tr>`).join("") || `<tr><td colspan="6">No challenges.</td></tr>`}</tbody></table></div></div>`;
  }

  function adminRecruitmentContent() {
    return `<div class="panel"><div class="panel-head"><div><div class="kicker">DIRECTORY</div><h3>RECRUITMENT POSTS</h3></div></div><div class="table-shell"><table><thead><tr><th>Listing</th><th>Type</th><th>Roles</th><th>Availability</th><th>Status</th><th>Control</th></tr></thead><tbody>${state.recruitment.map((post) => `<tr><td>${esc(post.team_name || post.player_ign || "—")}</td><td>${esc(post.listing_type)}</td><td>${esc(Array.isArray(post.looking_for) ? post.looking_for.join(", ") : post.looking_for || "—")}</td><td>${esc(post.availability || "—")}</td><td>${esc(post.status)}</td><td><button class="btn btn-dark btn-small" data-post="recruitment" data-id="${esc(post.id)}" data-next="${post.status === "open" ? "closed" : "open"}">${post.status === "open" ? "CLOSE" : "REOPEN"}</button></td></tr>`).join("") || `<tr><td colspan="6">No recruitment.</td></tr>`}</tbody></table></div></div>`;
  }

  async function handleLogout() {
    closeModal();
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error(error);
      showToast(friendlyError(error, "Logout failed."), "error");
      return;
    }
    state.user = null;
    state.profile = null;
    state.membership = null;
    state.team = null;
    state.isAdmin = false;
    state.screen = "login";
    state.section = "dashboard";
    state.adminSection = "registrations";
    render();
    showToast("Logged out successfully.");
  }

  function bindAdmin() {
    document.getElementById("adminLogoutBtn")?.addEventListener("click", handleLogout);
    document.getElementById("adminDashboardBtn")?.addEventListener("click", () => {
      state.section = "dashboard";
      renderMember();
    });
    document.querySelectorAll("[data-admin]").forEach((button) => button.addEventListener("click", () => {
      state.adminSection = button.dataset.admin;
      renderMember();
    }));
    document.querySelectorAll("[data-profile-status]").forEach((button) => button.addEventListener("click", () => adminMemberStatus(button.dataset.profileStatus, button.dataset.next)));
    document.querySelectorAll("[data-team-status]").forEach((button) => button.addEventListener("click", () => adminTeamStatus(button.dataset.teamStatus, button.dataset.next)));
    document.querySelectorAll("[data-review]").forEach((button) => button.addEventListener("click", () => reviewResult(button.dataset.review, button.dataset.next)));
    document.querySelectorAll("[data-post]").forEach((button) => button.addEventListener("click", () => adminPost(button.dataset.post, button.dataset.id, button.dataset.next)));
    document.querySelectorAll("[data-edit-team]").forEach((button) => button.addEventListener("click", () => openAdminTeamEdit(button.dataset.editTeam)));
    document.querySelectorAll("[data-edit-member]").forEach((button) => button.addEventListener("click", () => openAdminMemberEdit(button.dataset.editMember)));
  }

  async function adminMemberStatus(userId, status) {
    const action = status === "banned" ? "ban this member" : status === "approved" ? "approve this member" : `set this member to ${status}`;
    if (!confirm(`Confirm: ${action}?`)) return;
    try {
      const { error } = await supabase.rpc("admin_set_member_status", { p_user_id: userId, p_status: status });
      if (error) throw error;
      showToast(`Member status changed to ${status}.`);
      await refreshAdmin();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not update member status."), "error");
    }
  }

  async function adminTeamStatus(teamId, status) {
    const action = status === "banned" ? "BAN" : status === "removed" ? "REMOVE" : "RESTORE / ACTIVATE";
    if (!confirm(`Confirm ${action} for this team?`)) return;
    try {
      const { error } = await supabase.rpc("admin_set_team_status", { p_team_id: teamId, p_status: status });
      if (error) throw error;
      showToast(`Team status changed to ${status}.`);
      await refreshAdmin();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not update team status."), "error");
    }
  }

  async function reviewResult(resultId, status) {
    if (!confirm(`Confirm result ${status}?`)) return;
    try {
      const { error } = await supabase.rpc("admin_review_result", { p_result_id: resultId, p_status: status });
      if (error) throw error;
      showToast(`Result ${status}.`);
      await refreshAdmin();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not review result."), "error");
    }
  }

  async function adminPost(kind, id, status) {
    try {
      const functionName = kind === "practice" ? "admin_set_practice_status" : "admin_set_recruitment_status";
      const { error } = await supabase.rpc(functionName, { p_id: id, p_status: status });
      if (error) throw error;
      showToast(`Post ${status}.`);
      await refreshAdmin();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not update post."), "error");
    }
  }

  async function refreshAdmin() {
    state.section = "admin";
    await loadMemberSection();
  }

  function openAdminTeamEdit(teamId) {
    const team = state.teams.find((row) => row.id === teamId);
    if (!team) return showToast("Team not found in the current admin list.", "error");
    showModal("EDIT TEAM INFORMATION", `<form id="adminTeamEditForm"><div class="field-grid"><label>TEAM NAME *<input id="adminTeamName" maxlength="50" value="${esc(team.name)}" required></label><label>IGL NAME *<input id="adminIglName" maxlength="60" value="${esc(team.igl_name || "")}" required></label><label>TEAM LOGO — OPTIONAL<input id="adminTeamLogo" type="file" accept="image/png,image/jpeg,image/webp"><div class="hint">Leave empty to keep current logo.</div></label><label class="full"><span style="display:block;color:#8199ae;font-size:8px">CURRENT LOGO</span>${logo(team.logo_url, team.name, "profile-logo")}</label><label class="full"><span style="display:flex;align-items:center;gap:7px"><input id="adminRemoveLogo" type="checkbox" style="width:auto;min-height:0"> REMOVE CURRENT LOGO</span></label></div><div class="auth-actions" style="justify-content:flex-start"><button class="btn btn-primary" type="submit">SAVE TEAM INFO</button><button class="btn btn-dark" id="adminEditCancel" type="button">CANCEL</button></div></form>`);
    document.getElementById("adminTeamEditForm")?.addEventListener("submit", (event) => saveAdminTeamEdit(event, team));
    document.getElementById("adminEditCancel")?.addEventListener("click", closeModal);
  }

  async function saveAdminTeamEdit(event, team) {
    event.preventDefault();
    try {
      const teamName = document.getElementById("adminTeamName")?.value.trim() || "";
      const iglName = document.getElementById("adminIglName")?.value.trim() || "";
      const removeLogo = !!document.getElementById("adminRemoveLogo")?.checked;
      const file = document.getElementById("adminTeamLogo")?.files?.[0] || null;
      if (!teamName || !iglName) throw new Error("Team name and IGL name are required.");

      let logoUrl = team.logo_url || null;
      if (removeLogo) logoUrl = null;
      if (file) {
        if (file.size > MAX_IMAGE_MB * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
          throw new Error(`Logo must be PNG/JPG/WEBP and ${MAX_IMAGE_MB} MB or smaller.`);
        }
        logoUrl = await uploadFile(LOGO_BUCKET, state.user.id, file);
      }

      const { error } = await supabase.rpc("admin_edit_team", {
        p_team_id: team.id,
        p_team_name: teamName,
        p_igl_name: iglName,
        p_logo_url: logoUrl
      });
      if (error) throw error;

      closeModal();
      showToast("Team information updated successfully.");
      await refreshAdmin();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not edit team information."), "error");
    }
  }

  function openAdminMemberEdit(userId) {
    const member = state.registrations.find((row) => row.id === userId);
    if (!member) return showToast("Member not found in the current admin list.", "error");
    showModal("EDIT MEMBER INFORMATION", `<form id="adminMemberEditForm"><div class="field-grid"><label>MEMBER NAME *<input id="adminMemberName" maxlength="60" value="${esc(member.display_name || "")}" required></label><label>CONTACT<input id="adminMemberPhone" maxlength="20" value="${esc(member.phone || "")}"></label><label>WEBSITE ROLE *<select id="adminMemberRole"><option value="leader" ${member.role === "leader" ? "selected" : ""}>Team Leader / IGL</option><option value="sub_leader" ${member.role === "sub_leader" ? "selected" : ""}>Sub-Leader</option></select></label><label>STATUS<select id="adminMemberStatus"><option value="pending" ${member.status === "pending" ? "selected" : ""}>Pending</option><option value="approved" ${member.status === "approved" ? "selected" : ""}>Approved</option><option value="rejected" ${member.status === "rejected" ? "selected" : ""}>Rejected</option><option value="banned" ${member.status === "banned" ? "selected" : ""}>Banned</option></select></label></div><div class="auth-actions" style="justify-content:flex-start"><button class="btn btn-primary" type="submit">SAVE MEMBER</button><button class="btn btn-dark" id="adminMemberCancel" type="button">CANCEL</button></div></form>`);
    document.getElementById("adminMemberEditForm")?.addEventListener("submit", (event) => saveAdminMemberEdit(event, member));
    document.getElementById("adminMemberCancel")?.addEventListener("click", closeModal);
  }

  async function saveAdminMemberEdit(event, member) {
    event.preventDefault();
    try {
      const displayName = document.getElementById("adminMemberName")?.value.trim() || "";
      const phoneRaw = document.getElementById("adminMemberPhone")?.value.trim() || "";
      const phone = phoneRaw ? cleanPhone(phoneRaw) : null;
      const role = document.getElementById("adminMemberRole")?.value || "";
      const status = document.getElementById("adminMemberStatus")?.value || "";
      if (!displayName) throw new Error("Member name is required.");
      if (phone && !/^\+92\d{10}$/.test(phone)) throw new Error("Enter a valid Pakistan mobile number.");

      const { error } = await supabase.rpc("admin_edit_member", {
        p_user_id: member.id,
        p_display_name: displayName,
        p_phone: phone,
        p_role: role
      });
      if (error) throw error;

      if (status !== member.status) {
        const statusResult = await supabase.rpc("admin_set_member_status", { p_user_id: member.id, p_status: status });
        if (statusResult.error) throw statusResult.error;
      }

      closeModal();
      showToast("Member information updated successfully.");
      await refreshAdmin();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not edit member information."), "error");
    }
  }

  /* ========================= COMMON CARD BINDINGS ========================= */

  function bindCards() {
    document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => {
      state.section = button.dataset.go;
      renderMember();
    }));

    document.querySelectorAll("[data-wa]").forEach((button) => button.addEventListener("click", () => {
      const phone = cleanPhone(button.dataset.wa);
      if (!phone) return showToast("No contact number available.", "error");
      window.open(`https://wa.me/${phone.replace("+", "")}`, "_blank", "noopener,noreferrer");
    }));

    document.querySelectorAll("[data-proof]").forEach((button) => button.addEventListener("click", () => {
      showModal("RESULT PROOF", `<img src="${esc(button.dataset.proof)}" alt="Result proof" style="width:100%;max-height:70vh;object-fit:contain;border-radius:12px;border:1px solid rgba(64,168,255,.18);background:#02060b">`);
    }));

    document.querySelectorAll("[data-json]").forEach((button) => button.addEventListener("click", () => {
      let item;
      try { item = JSON.parse(button.dataset.json); } catch (_) { return showToast("Details could not be opened.", "error"); }
      const body = Object.entries(item)
        .filter(([key, value]) => !["id", "team_id", "team_logo_url", "created_by"].includes(key) && value !== null && value !== "")
        .map(([key, value]) => `<div class="info-box" style="margin-bottom:7px"><small>${esc(key.replaceAll("_", " "))}</small><strong>${esc(Array.isArray(value) ? value.join(" • ") : String(value))}</strong></div>`)
        .join("");
      showModal("POST DETAILS", body || `<div class="empty">No additional details.</div>`);
    }));
  }

  function render() {
    if (state.screen === "admin-login") renderAdminLogin();
    else if (state.screen === "member") renderMember();
    else renderAuth();
  }

  render();
  hydrateSession().catch((error) => {
    console.error(error);
    state.screen = new URLSearchParams(location.search).get("register") === "1" ? "register" : "login";
    render();
    showToast(friendlyError(error, "Supabase session check failed. You can retry login."), "error");
  });
})();
