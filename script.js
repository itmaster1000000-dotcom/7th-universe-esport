/*
  7TH UNIVERSE ESPORTS — PRODUCTION FINAL HARDENED BUILD v25
  Simple frontend: index.html + script.js + logo only.
  Backend: Supabase Auth/DB/Storage + Railway/Baileys bridge.

  Security rules:
  - Publishable Supabase key only. Never place service_role/secret keys here.
  - Public writes are RPC-only; admin actions are verified by SECURITY DEFINER RPCs.
  - Registration creates the profile/team membership from the auth.users trigger.
  - Maximum 2 website members per team: Team Leader/IGL + Sub-Leader.
  - Permanent ranking: SOLO / DUO / SQUAD are separate point pools. WIN +3 / LOSS -3. Only approved results count.
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
    rankFormat: "ALL",
    registrations: [],
    teams: [],
    adminPoints: [],
    teamDetails: null
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


  function formatTimeOnly(value) {
    if (!value) return "—";
    const raw = String(value).trim();
    if (/^\d{1,2}:\d{2}\s*[AP]M$/i.test(raw)) return raw.replace(/\s+/g, "").toUpperCase();
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Karachi",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      }).format(d).replace(/\s+/g, "").toUpperCase();
    } catch (_) {
      return raw;
    }
  }

  function pakistanDateParts() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Karachi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    return { year: get("year"), month: get("month"), day: get("day"), hour: Number(get("hour")), minute: Number(get("minute")) };
  }

  function nextPakistanDateForTime(hhmm) {
    const now = pakistanDateParts();
    const [hh, mm] = String(hhmm || "").split(":").map(Number);
    if (!Number.isInteger(hh) || !Number.isInteger(mm)) throw new Error("Choose a valid match time.");
    const targetMinutes = hh * 60 + mm;
    const nowMinutes = now.hour * 60 + now.minute;
    let dateText = `${now.year}-${now.month}-${now.day}`;
    if (targetMinutes <= nowMinutes) {
      const base = new Date(`${dateText}T12:00:00+05:00`);
      base.setUTCDate(base.getUTCDate() + 1);
      const out = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(base);
      const get = (type) => out.find((p) => p.type === type)?.value || "";
      dateText = `${get("year")}-${get("month")}-${get("day")}`;
    }
    return `${dateText}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00+05:00`;
  }

  function time12Parts(hhmm) {
    const [h, m] = String(hhmm || "").split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    let hour = h % 12;
    if (hour === 0) hour = 12;
    return { hour: String(hour).padStart(2,"0"), minute: String(m).padStart(2,"0"), period };
  }

  function time24FromParts(hour12, minute, period) {
    let h = Number(hour12) % 12;
    if (String(period).toUpperCase() === "PM") h += 12;
    return `${String(h).padStart(2,"0")}:${String(Number(minute)).padStart(2,"0")}`;
  }

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
      return "Database denied this action. Run the latest ESPORTS V25 hardening SQL and verify the admin profile is role=admin and status=approved.";
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
    if (/No removed registration found|No eligible previous registration/i.test(message)) {
      return "This email already has an account, but no removable/rejected registration is available. Use LOGIN or contact the administrator.";
    }
    if (/previous team.*removed|registration.*removed.*register again/i.test(message)) {
      return "Your previous team was permanently removed. Please submit a new team registration.";
    }
    if (/team name.*already|another team already uses this name/i.test(message)) {
      return "That team name is already in use. Choose another team name.";
    }
    if (/Invalid login credentials/i.test(message)) return "Email or password is incorrect.";
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

  // Robust team-context lookup: avoids losing the nested `teams` record because of
  // client-side RLS/nested-select visibility. The DB function checks the caller's own approved membership + active team before returning context.
  async function getApprovedTeamContext() {
    const { data, error } = await supabase.rpc("get_my_team_context");
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.team_id) return null;

    state.membership = {
      id: row.membership_id,
      team_id: row.team_id,
      user_id: row.user_id,
      role: row.member_role,
      status: row.membership_status,
      created_at: row.membership_created_at,
      teams: {
        id: row.team_id,
        name: row.team_name,
        logo_url: row.team_logo_url,
        igl_name: row.team_igl_name,
        status: row.team_status,
        created_at: row.team_created_at,
        updated_at: row.team_updated_at
      }
    };

    state.team = state.membership.teams;
    return state.team;
  }

  async function ensureApprovedTeam() {
    const team = await getApprovedTeamContext();
    if (!team) throw new Error("No approved active team membership was found for this account. Ask the administrator to re-check the team approval in Admin → Registrations / Members.");
    return team;
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
        showToast("Your previous team registration was removed. Please submit a new team registration.", "error");
        return;
      }

      state.isAdmin = state.profile.role === "admin" && state.profile.status === "approved";

      if (!state.isAdmin && state.profile.status !== "approved") {
        const currentStatus = state.profile.status;
        await supabase.auth.signOut();
        state.screen = "login";
        render();
        const statusMessage = currentStatus === "banned"
          ? "Your account is banned."
          : currentStatus === "rejected"
            ? "Your registration was rejected. Open NEW TEAM REGISTRATION to submit it again."
            : currentStatus === "removed"
              ? "Your previous team membership was removed. Open NEW TEAM REGISTRATION to register again."
              : "Your registration is pending administrator approval.";
        showToast(statusMessage, "error");
        return;
      }

      if (state.isAdmin) {
        // Administrators do not require a team membership.
        // V25 RLS intentionally restricts team-member reads, so do not query
        // team_members during administrator session hydration.
        state.membership = null;
        state.team = null;
      } else {
        const approvedTeam = await getApprovedTeamContext();
        if (!approvedTeam) {
          await supabase.auth.signOut();
          state.screen = "login";
          render();
          showToast("Your team is not confirmed yet. Please wait for admin approval.", "error");
          return;
        }
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
        <p>Use your registered email and password.</p>
      </div>
      <form id="loginForm" style="margin-top:16px">
        <div class="field-grid">
          <label class="full">EMAIL *<input id="loginIdentifier" type="email" autocomplete="username" placeholder="leader@example.com" required></label>
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
          
        </div>
        <div class="hint">Team logo can be uploaded later from TEAM PROFILE after approval.</div>
        <div class="access-note" style="margin-top:13px"><b>IMPORTANT:</b> Team approval is required before login. A permanently removed team can register again using the same email after signing in during re-registration.</div>
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
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) throw new Error("Enter a valid email address.");
      const credentials = { email: id.toLowerCase(), password };
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

    try {
      if (!teamName || !name || !email || !phone) throw new Error("Complete all required fields.");
      if (!/^\+92\d{10}$/.test(phone)) throw new Error("Enter a valid Pakistan mobile number.");
      if (!['leader', 'sub_leader'].includes(role)) throw new Error("Invalid website member role.");
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");
      if (password !== password2) throw new Error("Passwords do not match.");

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

      // Normal first-time registration.
      if (!error && data?.user && (data.user.identities?.length ?? 1) > 0) {
        if (data.session) await supabase.auth.signOut();
        goLogin();
        showToast("Registration submitted. Status: PENDING for administrator approval.");
        return;
      }

      // Existing Auth user: this is the path used for a permanently removed
      // team (and also supports an existing rejected registration via the DB RPC).
      const duplicateAccount = Boolean(
        error && /already registered|already exists|user already/i.test(String(error.message || ""))
      ) || Boolean(data?.user && (data.user.identities?.length ?? 1) === 0);

      if (!duplicateAccount) {
        if (error) throw error;
        throw new Error("Registration could not be created.");
      }

      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      if (loginError) {
        throw new Error("This email already has an account. Enter the correct existing password to submit the registration again.");
      }

      const { error: reapplyError } = await supabase.rpc("reapply_existing_registration", {
        p_team_name: teamName,
        p_display_name: name,
        p_phone: phone,
        p_role: role
      });

      await supabase.auth.signOut();

      if (reapplyError) throw reapplyError;

      goLogin();
      showToast("Previous registration was accepted for re-submission. Status: PENDING for administrator approval.");
    } catch (error) {
      console.error(error);
      try { await supabase.auth.signOut(); } catch (_) {}
      showToast(friendlyError(error, "Registration failed."), "error");
    }
  }

  async function uploadFile(bucket, uid, file, { privateObject = false } = {}) {
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const path = `${uid}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });
    if (error) throw error;
    if (privateObject) return path;
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  const proofUrlCache = new Map();

  async function resolveProofUrl(reference) {
    const raw = String(reference || "").trim();
    if (!raw) throw new Error("Proof image reference is missing.");

    let path = raw;
    const marker = "/storage/v1/object/public/result-proofs/";
    try {
      const parsed = new URL(raw);
      const idx = parsed.pathname.indexOf(marker);
      if (idx >= 0) path = decodeURIComponent(parsed.pathname.slice(idx + marker.length));
      else if (/^https?:$/i.test(parsed.protocol)) return raw;
    } catch (_) {
      // Keep raw as a storage path.
    }

    if (/^https?:\/\//i.test(path)) return path;

    const cached = proofUrlCache.get(path);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const { data, error } = await supabase.storage
      .from(RESULT_BUCKET)
      .createSignedUrl(path, 15 * 60);

    if (error || !data?.signedUrl) {
      throw error || new Error("Could not create a secure proof URL.");
    }

    proofUrlCache.set(path, {
      url: data.signedUrl,
      expiresAt: Date.now() + 14 * 60 * 1000
    });

    return data.signedUrl;
  }

  async function openProof(reference, title) {
    try {
      const url = await resolveProofUrl(reference);
      showModal(title || "RESULT PROOF", `<img src="${esc(url)}" alt="Result proof" style="width:100%;max-height:70vh;object-fit:contain;border-radius:12px;border:1px solid rgba(64,168,255,.18);background:#02060b">`);
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not open the proof image."), "error");
    }
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
            <div class="desc">Approve registrations, edit team information, manage members, ban/unban, permanently remove teams, verify results and moderate posts.</div>
            <div class="access-note"><b>PRIVATE:</b> Only an approved administrator can enter.</div>
          </section>
          <section class="card auth-card">
            <div class="auth-inner">
              <div class="auth-logo-row"><img src="./7th-universe-esports-logo.png" alt="7U"><div><strong>ADMIN LOGIN</strong><span>CONTROL CENTER</span></div></div>
              <form id="adminLoginForm">
                <div class="field-grid">
                  <label class="full">ADMIN EMAIL *<input id="adminId" type="email" autocomplete="username" placeholder="admin@example.com" required></label>
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
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) throw new Error("Enter a valid admin email address.");
      const credentials = { email: id.toLowerCase(), password };
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
      // Admin accounts are global administrators and do not need team membership.
      // Avoid querying team_members here because V25 RLS does not grant admins
      // blanket client-side access to team_members.
      state.membership = null;
      state.team = null;
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
      else if (state.section === "results") { const resultChallenges = await getMyResultChallenges(); root.innerHTML = await resultsPage(resultChallenges); bindResults(resultChallenges); }
      else if (state.section === "rankings") { root.innerHTML = await rankingsPage(); bindRankings(); }
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
      .in("format", ["SOLO", "DUO", "SQUAD"])
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

  async function getRankings(format = "ALL") {
    const target = String(format || "ALL").toUpperCase();
    const source = target === "ALL" ? "team_rankings" : "team_rankings_by_format";
    let query = supabase
      .from(source)
      .select("*")
      .order("rank_number", { ascending: true })
      .limit(250);

    if (target !== "ALL") query = query.eq("format", target);

    const { data, error } = await query;
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
    const ownTeam = state.team?.id && challenge.team_id === state.team.id;
    const accepted = challenge.status === "accepted";
    const acceptedByMe = challenge.accepted_by_team_id && state.team?.id === challenge.accepted_by_team_id;
    return `
      <article class="challenge-card">
        <div class="row-between">
          <div class="identity">${logo(challenge.team_logo_url, challenge.team_name || "7U")}<div><div class="name">${esc(challenge.team_name)}</div><div class="meta">FREE FIRE • CLASH SQUAD • EVERYONE</div></div></div>
          <span class="badge ${accepted ? "badge-cyan" : "badge-green"}">${accepted ? "ACCEPTED" : "OPEN"}</span>
        </div>
        <div class="pills"><span class="pill">${esc(challenge.match_type)}</span><span class="pill">${esc(challenge.format)}</span><span class="pill">EVERYONE</span></div>
        <div class="info-row"><div class="info-box"><small>Match Time</small><strong>${esc(formatTimeOnly(challenge.match_time))}</strong></div><div class="info-box"><small>Contact</small><strong>${esc(challenge.contact || "—")}</strong></div></div>
        ${challenge.notes ? `<div class="note">${esc(challenge.notes)}</div>` : ""}
        ${accepted ? `<div class="note" style="border-color:rgba(45,224,255,.18);color:#9eeaff;background:rgba(45,224,255,.04)"><b>ACCEPTED BY:</b> ${esc(challenge.accepted_by_team_name || "Another Team")}</div>` : ""}
        <div class="card-actions">
          <button class="btn btn-primary btn-small" data-wa="${esc(challenge.contact || "")}">CONTACT</button>
          <button class="btn btn-dark btn-small" data-json='${esc(JSON.stringify(challenge))}'>DETAILS</button>
          ${!ownTeam && !accepted ? `<button class="btn btn-cyan btn-small" data-accept-challenge="${esc(challenge.id)}">ACCEPT CHALLENGE</button>` : ""}
          ${acceptedByMe ? `<span class="badge badge-cyan">YOUR ACCEPTED MATCH</span>` : ""}
          ${ownTeam && !accepted ? `<span class="badge badge-blue">YOUR CHALLENGE</span>` : ""}
        </div>
      </article>`;
  }

  function recruitmentCard(post) {
    const roles = Array.isArray(post.looking_for) ? post.looking_for.join(" • ") : (post.looking_for || "—");
    const isPlayer = String(post.listing_type || "").toUpperCase() === "PLAYER_RECRUITMENT";
    const visual = isPlayer
      ? `<div class="mini-logo mini-placeholder">PL</div>`
      : logo(post.team_logo_url, post.team_name || "7U");
    return `
      <article class="recruit-card">
        <div class="row-between">
          <div class="identity">${visual}<div><div class="name">${esc(post.team_name || post.player_ign || "PLAYER")}</div><div class="meta">FREE FIRE • ${esc(String(post.listing_type || "").replaceAll("_", " "))}</div></div></div>
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
          <div class="form-tip">FREE FIRE • CLASH SQUAD • EVERYONE • SINGLE / BEST OF 3 • SOLO / DUO / SQUAD • MATCH TIME ONLY</div>
          <form id="practiceForm"><div class="field-grid">
            <label>MATCH TYPE *<select id="practiceMatchType"><option value="SINGLE">SINGLE MATCH</option><option value="BEST OF 3">BEST OF 3</option></select></label>
            <label>FORMAT *<select id="practiceFormat"><option value="SQUAD">SQUAD</option><option value="DUO">DUO</option><option value="SOLO">SOLO</option></select></label>
            <label>MATCH TIME *
              <button class="time-picker-button" id="practiceTimeBtn" type="button" aria-haspopup="dialog" aria-controls="modalBackdrop">
                <span><span class="time-value" id="practiceTimeDisplay">SELECT TIME</span><span class="time-hint">PAKISTAN TIME • DATE IS NOT SHOWN</span></span>
                <span class="time-icon">◷</span>
              </button>
              <input id="practiceTime" type="hidden" value="">
            </label>
            <label>CONTACT / WHATSAPP *<input id="practiceContact" value="${esc(state.profile?.phone || "")}" required placeholder="03XXXXXXXXX"></label>
            <label class="full">ADDITIONAL NOTES<textarea id="practiceNotes" maxlength="500"></textarea></label>
          </div><div class="auth-actions" style="justify-content:flex-start"><button class="btn btn-primary" type="submit">POST OPEN CHALLENGE</button></div></form>
        </section>
        <section class="section" style="margin-top:16px"><div class="panel-head"><div><div class="kicker">PUBLIC LIST</div><h3>OPEN CHALLENGES</h3></div><span class="badge badge-green">${challenges.length} LIVE</span></div><div class="feed-list">${challenges.map(challengeCard).join("") || `<div class="empty">No open challenges.</div>`}</div></section>
      </div>`;
  }

  function bindPractice() {
    document.getElementById("practiceForm")?.addEventListener("submit", submitPractice);
    document.getElementById("practiceTimeBtn")?.addEventListener("click", openPracticeTimePicker);
  }

  function openPracticeTimePicker() {
    const current = document.getElementById("practiceTime")?.value || "12:00";
    const parts = time12Parts(current);
    const hours = Array.from({length:12}, (_,i) => String(i + 1).padStart(2,"0"));
    const minutes = Array.from({length:60}, (_,i) => String(i).padStart(2,"0"));
    showModal("SET MATCH TIME", `
      <div class="time-picker-modal">
        <div class="time-picker-display">
          <strong id="timePickerPreview">${esc(parts.hour)}:${esc(parts.minute)} ${esc(parts.period)}</strong>
          <small>PAKISTAN TIME • DATE IS NOT SHOWN</small>
        </div>
        <div class="time-picker-grid">
          <label>HOUR<select id="timePickerHour">${hours.map((h) => `<option value="${h}" ${h === parts.hour ? "selected" : ""}>${h}</option>`).join("")}</select></label>
          <label>MINUTE<select id="timePickerMinute">${minutes.map((m) => `<option value="${m}" ${m === parts.minute ? "selected" : ""}>${m}</option>`).join("")}</select></label>
        </div>
        <div class="time-picker-period">
          <button type="button" class="time-period-btn ${parts.period === "AM" ? "active" : ""}" data-time-period="AM">AM</button>
          <button type="button" class="time-period-btn ${parts.period === "PM" ? "active" : ""}" data-time-period="PM">PM</button>
        </div>
        <div class="time-picker-actions">
          <div class="left-actions"><button type="button" class="btn btn-dark" id="timePickerClear">CLEAR</button></div>
          <div class="right-actions"><button type="button" class="btn btn-dark" id="timePickerCancel">CANCEL</button><button type="button" class="btn btn-primary" id="timePickerSet">SET</button></div>
        </div>
      </div>`);

    const preview = document.getElementById("timePickerPreview");
    let period = parts.period;
    const refreshPreview = () => {
      const h = document.getElementById("timePickerHour")?.value || "12";
      const m = document.getElementById("timePickerMinute")?.value || "00";
      if (preview) preview.textContent = `${h}:${m} ${period}`;
    };
    document.getElementById("timePickerHour")?.addEventListener("change", refreshPreview);
    document.getElementById("timePickerMinute")?.addEventListener("change", refreshPreview);
    document.querySelectorAll("[data-time-period]").forEach((button) => button.addEventListener("click", () => {
      period = button.dataset.timePeriod;
      document.querySelectorAll("[data-time-period]").forEach((b) => b.classList.toggle("active", b === button));
      refreshPreview();
    }));
    document.getElementById("timePickerClear")?.addEventListener("click", () => {
      const input = document.getElementById("practiceTime");
      const display = document.getElementById("practiceTimeDisplay");
      if (input) input.value = "";
      if (display) display.textContent = "SELECT TIME";
      closeModal();
    });
    document.getElementById("timePickerCancel")?.addEventListener("click", closeModal);
    document.getElementById("timePickerSet")?.addEventListener("click", () => {
      const h = document.getElementById("timePickerHour")?.value || "12";
      const m = document.getElementById("timePickerMinute")?.value || "00";
      const value = time24FromParts(h, m, period);
      document.getElementById("practiceTime").value = value;
      document.getElementById("practiceTimeDisplay").textContent = `${h}:${m} ${period}`;
      closeModal();
    });
  }

  async function submitPractice(event) {
    event.preventDefault();
    try {
      const team = await ensureApprovedTeam();
      const selectedTime = document.getElementById("practiceTime")?.value || "";
      if (!/^\d{2}:\d{2}$/.test(selectedTime)) throw new Error("Please select a match time.");
      const matchDateTime = nextPakistanDateForTime(selectedTime);
      const contact = cleanPhone(document.getElementById("practiceContact")?.value || "");
      if (!/^\+92\d{10}$/.test(contact)) throw new Error("Enter a valid Pakistan contact number.");

      const { error } = await supabase.rpc("create_practice_challenge", {
        p_team_id: team.id,
        p_team_name: team.name,
        p_team_logo_url: team.logo_url || null,
        p_match_type: document.getElementById("practiceMatchType")?.value,
        p_match_time: new Date(matchDateTime).toISOString(),
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

  async function getMyResultChallenges() {
    const { data, error } = await supabase.rpc("get_my_result_challenges");
    if (error) throw error;
    return data || [];
  }

  async function getMyResults() {
    const { data, error } = await supabase
      .from("team_match_results")
      .select("*")
      .eq("team_id", state.team?.id || EMPTY_UUID)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data || [];
  }

  async function getVerifiedResults() {
    const { data, error } = await supabase
      .from("team_match_results")
      .select("*")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data || [];
  }

  function resultCard(row) {
    const win = row.outcome === "WIN";
    const winner = row.winner_team_name || (win ? state.team?.name : row.opponent_team_name) || "Winner";
    const loser = row.loser_team_name || (!win ? state.team?.name : row.opponent_team_name) || "Loser";
    const isMine = row.team_id === state.team?.id;
    const canViewProof = state.isAdmin || isMine;
    const formatLabel = row.challenge_format || row.format || "—";
    const matchLabel = row.challenge_match_type || row.match_type || "MATCH";
    const hasChallengeSnapshot = Boolean(row.challenge_id || row.challenge_team_name || row.challenge_format);
    return `<article class="result-record">
      <div class="result-record-top">
        <div><div class="kicker">${hasChallengeSnapshot ? "CHALLENGE RESULT" : "LEGACY RESULT"}</div><div class="result-matchup"><strong>${esc(winner)}</strong><span>VS</span><strong>${esc(loser)}</strong></div></div>
        <span class="badge ${row.status === "approved" ? "badge-green" : row.status === "rejected" ? "badge-danger" : "badge-warn"}">${esc(String(row.status || "pending").toUpperCase())}</span>
      </div>
      ${row.score ? `<div class="result-score-line"><span>SCORE</span><strong>${esc(row.score)}</strong><em>WIN +3 • LOSS −3</em></div>` : ""}
      ${hasChallengeSnapshot ? `<div class="result-meta-grid"><div><small>CHALLENGE</small><b>${esc(matchLabel)}</b></div><div><small>FORMAT</small><b>${esc(formatLabel)}</b></div><div><small>TIME</small><b>${esc(formatTimeOnly(row.challenge_match_time || row.played_at || row.created_at))}</b></div></div>` : ""}
      ${canViewProof ? `<div class="result-proof-row">
        ${row.proof_challenge_url ? `<button class="btn btn-dark btn-small" data-proof-ref="${esc(row.proof_challenge_url)}" data-proof-title="ACCEPTED CHALLENGE PROOF">SCREENSHOT 1</button>` : ""}
        ${row.proof_result_url || row.proof_url ? `<button class="btn btn-dark btn-small" data-proof-ref="${esc(row.proof_result_url || row.proof_url)}" data-proof-title="MATCH RESULT PROOF">SCREENSHOT 2</button>` : ""}
      </div>` : ""}
    </article>`;
  }

  function challengeOptionLabel(challenge) {
    const posted = challenge.team_name || "Team";
    const accepted = challenge.accepted_by_team_name || "Opponent";
    return `${posted}  vs  ${accepted} • ${challenge.match_type} • ${challenge.format} • ${formatTimeOnly(challenge.match_time)}`;
  }

  function challengeById(challenges, id) {
    return challenges.find((item) => item.id === id) || null;
  }

  function renderResultChallengeDetails(challenge) {
    const box = document.getElementById("resultChallengeDetails");
    const winner = document.getElementById("resultWinnerTeam");
    const loser = document.getElementById("resultLoserTeam");
    if (!box || !winner || !loser) return;

    if (!challenge) {
      box.innerHTML = `<div class="result-empty-state"><strong>NO CHALLENGE SELECTED</strong><span>Select an accepted practice challenge to continue.</span></div>`;
      winner.innerHTML = `<option value="">Select winner team</option>`;
      loser.innerHTML = `<option value="">Select loser team</option>`;
      const resultFormat = document.getElementById("resultFormat");
      if (resultFormat) resultFormat.value = "";
      return;
    }

    const teams = [
      { id: challenge.team_id, name: challenge.team_name },
      { id: challenge.accepted_by_team_id, name: challenge.accepted_by_team_name }
    ].filter((item, index, arr) => item.id && arr.findIndex((x) => x.id === item.id) === index);

    box.innerHTML = `
      <div class="result-challenge-head"><div><small>SELECTED CHALLENGE</small><strong>${esc(challenge.team_name)} <span>VS</span> ${esc(challenge.accepted_by_team_name || "Opponent")}</strong></div><span class="badge badge-cyan">ACCEPTED</span></div>
      <div class="result-meta-grid"><div><small>MATCH</small><b>${esc(challenge.match_type)}</b></div><div><small>FORMAT</small><b>${esc(challenge.format)}</b></div><div><small>TIME</small><b>${esc(formatTimeOnly(challenge.match_time))}</b></div></div>`;

    const resultFormat = document.getElementById("resultFormat");
    if (resultFormat) resultFormat.value = String(challenge.format || "").toUpperCase();

    const options = teams.map((team) => `<option value="${esc(team.id)}">${esc(team.name)}</option>`).join("");
    winner.innerHTML = `<option value="">Select winner team</option>${options}`;
    loser.innerHTML = `<option value="">Select loser team</option>${options}`;

    const me = state.team?.id;
    if (me && teams.length === 2) {
      const other = teams.find((team) => team.id !== me);
      winner.value = me;
      loser.value = other?.id || "";
    }
  }

  async function resultsPage(challenges = null) {
    const [mine, verified] = await Promise.all([getMyResults(), getVerifiedResults()]);
    if (!Array.isArray(challenges)) challenges = await getMyResultChallenges();
    const noChallenges = !challenges.length;
    return `
      <div class="container">
        <div style="margin-bottom:16px"><div class="kicker">SUBMIT • VERIFY • RANK</div><h1 class="title">MATCH RESULTS</h1><div class="desc">Choose the accepted challenge first, record the winner, loser and final score, then attach both proof screenshots. <b>Only after Admin approval:</b> Winner +3 • Loser −3.</div></div>

        <section class="panel result-submit-panel">
          <div class="panel-head"><div><div class="kicker">STEP-BY-STEP SUBMISSION</div><h3>TEAM RESULT</h3></div><span class="badge badge-blue">ADMIN APPROVAL</span></div>
          <div class="result-steps">
            <div class="result-step"><span>01</span><div><b>SELECT CHALLENGE</b><small>Choose the accepted practice challenge.</small></div></div>
            <div class="result-step"><span>02</span><div><b>ENTER RESULT</b><small>Winner • Loser • Final score.</small></div></div>
            <div class="result-step"><span>03</span><div><b>ADD PROOF</b><small>Two screenshots for verification.</small></div></div>
          </div>

          <form id="resultForm">
            <label class="full">ACCEPTED CHALLENGE *
              <select id="resultChallenge" ${noChallenges ? "disabled" : "required"}>
                <option value="">${noChallenges ? "No accepted challenges available" : "Select an accepted challenge"}</option>
                ${challenges.map((challenge) => `<option value="${esc(challenge.id)}">${esc(challengeOptionLabel(challenge))}</option>`).join("")}
              </select>
            </label>

            <div id="resultChallengeDetails" class="result-challenge-box">
              <div class="result-empty-state"><strong>${noChallenges ? "NO ACCEPTED CHALLENGE" : "SELECT A CHALLENGE"}</strong><span>${noChallenges ? "Accept a Practice Challenge first, then return here." : "The selected challenge details will appear here."}</span></div>
            </div>

            <label class="result-format-select">RESULT FORMAT *
              <select id="resultFormat" ${noChallenges ? "disabled" : "required"}>
                <option value="">Select result format</option>
                <option value="SOLO">SOLO</option>
                <option value="DUO">DUO</option>
                <option value="SQUAD">SQUAD</option>
              </select>
              <span class="result-format-note">The result format must match the selected accepted challenge. Points are kept separately for SOLO, DUO and SQUAD rankings.</span>
            </label>

            <div class="field-grid">
              <label>WINNER TEAM *<select id="resultWinnerTeam" required><option value="">Select winner team</option></select></label>
              <label>LOSER TEAM *<select id="resultLoserTeam" required><option value="">Select loser team</option></select></label>
              <label class="full">FINAL SCORE *<input id="resultScore" maxlength="15" inputmode="numeric" placeholder="Example: 7-1" required></label>
            </div>

            <div class="result-score-preview" id="resultScorePreview"><span>FINAL SCORE</span><strong>—</strong></div>

            <div class="proof-grid">
              <label>SCREENSHOT 1 — ACCEPTED CHALLENGE *
                <input id="resultChallengeProof" type="file" accept="image/png,image/jpeg,image/webp" required>
                <span class="hint">Private proof screenshot used only for Admin verification.</span>
              </label>
              <label>SCREENSHOT 2 — MATCH RESULT *
                <input id="resultMatchProof" type="file" accept="image/png,image/jpeg,image/webp" required>
                <span class="hint">Private proof screenshot used only for Admin verification.</span>
              </label>
            </div>

            <div class="result-policy"><b>POINT RULE:</b> Pending results do not change rankings. After Admin approval, the Winner receives <strong>+3</strong> and the Loser receives <strong>−3</strong> in the selected format only.</div>

            <div class="auth-actions" style="justify-content:flex-start"><button class="btn btn-primary" type="submit" ${noChallenges ? "disabled" : ""}>SUBMIT RESULT FOR REVIEW</button></div>
          </form>
        </section>

        <section class="member-grid" style="margin-top:14px">
          <div class="panel"><div class="panel-head"><div><div class="kicker">MY RECORDS</div><h3>MY SUBMISSIONS</h3></div></div><div class="feed-list">${mine.map(resultCard).join("") || `<div class="empty">No results submitted yet.</div>`}</div></div>
          <div class="panel"><div class="panel-head"><div><div class="kicker">VERIFIED</div><h3>RECENT APPROVED RESULTS</h3></div></div><div class="feed-list">${verified.slice(0, 10).map(resultCard).join("") || `<div class="empty">No approved results yet.</div>`}</div></div>
        </section>
      </div>`;
  }

  function bindResults(challenges = []) {
    document.getElementById("resultForm")?.addEventListener("submit", submitResult);

    const challengeSelect = document.getElementById("resultChallenge");
    const winner = document.getElementById("resultWinnerTeam");
    const loser = document.getElementById("resultLoserTeam");
    const score = document.getElementById("resultScore");
    const resultFormat = document.getElementById("resultFormat");
    const preview = document.getElementById("resultScorePreview");

    challengeSelect?.addEventListener("change", () => {
      renderResultChallengeDetails(challengeById(challenges, challengeSelect.value));
    });

    resultFormat?.addEventListener("change", () => {
      const selected = challengeById(challenges, challengeSelect?.value || "");
      if (!selected) return;
      const expected = String(selected.format || "").toUpperCase();
      if (resultFormat.value !== expected) {
        resultFormat.value = expected;
        showToast(`Result format must match the selected challenge: ${expected}.`, "error");
      }
    });

    const syncPreview = () => {
      const clean = String(score?.value || "").replace(/\s+/g, "").replace(/[^0-9-]/g, "");
      if (preview) preview.innerHTML = `<span>FINAL SCORE</span><strong>${esc(clean || "—")}</strong>`;
    };
    score?.addEventListener("input", syncPreview);
    winner?.addEventListener("change", () => {
      if (winner.value && loser.value === winner.value) loser.value = "";
    });
    loser?.addEventListener("change", () => {
      if (loser.value && winner.value === loser.value) winner.value = "";
    });
  }

  async function submitResult(event) {
    event.preventDefault();
    const uploadedProofPaths = [];
    try {
      const team = await ensureApprovedTeam();
      const challengeId = document.getElementById("resultChallenge")?.value || "";
      const winnerTeamId = document.getElementById("resultWinnerTeam")?.value || "";
      const loserTeamId = document.getElementById("resultLoserTeam")?.value || "";
      const resultFormat = String(document.getElementById("resultFormat")?.value || "").toUpperCase();
      const scoreValue = document.getElementById("resultScore")?.value.trim() || "";
      const challengeProof = document.getElementById("resultChallengeProof")?.files?.[0] || null;
      const matchProof = document.getElementById("resultMatchProof")?.files?.[0] || null;

      if (!challengeId) throw new Error("Select the accepted practice challenge first.");
      const selectedChallenge = (await getMyResultChallenges()).find((item) => item.id === challengeId) || null;
      if (!selectedChallenge) throw new Error("The selected challenge is no longer available for result submission.");
      const expectedFormat = String(selectedChallenge.format || "").toUpperCase();
      if (!["SOLO","DUO","SQUAD"].includes(resultFormat)) throw new Error("Select SOLO, DUO or SQUAD result format.");
      if (resultFormat !== expectedFormat) throw new Error(`Result format must match the accepted challenge: ${expectedFormat}.`);
      if (!winnerTeamId || !loserTeamId) throw new Error("Select both Winner Team and Loser Team.");
      if (winnerTeamId === loserTeamId) throw new Error("Winner and Loser must be different teams.");
      if (winnerTeamId !== team.id && loserTeamId !== team.id) throw new Error("Your team must be either the Winner or the Loser of the selected challenge.");
      if (!/^\d{1,3}\s*-\s*\d{1,3}$/.test(scoreValue)) throw new Error("Enter the final score in this format: 7-1");

      const [winnerScore, loserScore] = scoreValue.split("-").map((value) => Number(value.trim()));
      if (!Number.isFinite(winnerScore) || !Number.isFinite(loserScore) || winnerScore <= loserScore) {
        throw new Error("The final score must show a higher score for the Winner, for example 7-1.");
      }

      for (const [label, file] of [["Screenshot 1", challengeProof], ["Screenshot 2", matchProof]]) {
        if (!file) throw new Error(`${label} is required.`);
        if (file.size > MAX_IMAGE_MB * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
          throw new Error(`${label} must be PNG/JPG/WEBP and ${MAX_IMAGE_MB} MB or smaller.`);
        }
      }

      const stamp = Date.now();
      const challengeExt = challengeProof.type === "image/webp" ? "webp" : challengeProof.type === "image/png" ? "png" : "jpg";
      const resultExt = matchProof.type === "image/webp" ? "webp" : matchProof.type === "image/png" ? "png" : "jpg";
      const challengeFile = new File([await challengeProof.arrayBuffer()], `challenge-proof-${stamp}.${challengeExt}`, {type: challengeProof.type});
      const resultFile = new File([await matchProof.arrayBuffer()], `result-proof-${stamp}.${resultExt}`, {type: matchProof.type});
      const challengeProofUrl = await uploadFile(RESULT_BUCKET, state.user.id, challengeFile, { privateObject: true });
      uploadedProofPaths.push(challengeProofUrl);
      const resultProofUrl = await uploadFile(RESULT_BUCKET, state.user.id, resultFile, { privateObject: true });
      uploadedProofPaths.push(resultProofUrl);

      const { error } = await supabase.rpc("submit_team_result", {
        p_team_id: team.id,
        p_challenge_id: challengeId,
        p_format: resultFormat,
        p_winner_team_id: winnerTeamId,
        p_loser_team_id: loserTeamId,
        p_score: scoreValue,
        p_proof_challenge_url: challengeProofUrl,
        p_proof_result_url: resultProofUrl
      });
      if (error) throw error;

      showToast("Result submitted successfully. Waiting for Admin approval.");
      await loadMemberSection();
    } catch (error) {
      // If the database submission fails after proof uploads, remove the
      // orphaned private objects owned by the current user.
      if (uploadedProofPaths.length && state.user?.id) {
        try {
          await Promise.all(uploadedProofPaths.map((path) =>
            supabase.storage.from(RESULT_BUCKET).remove([path])
          ));
        } catch (cleanupError) {
          console.warn("Proof cleanup failed:", cleanupError);
        }
      }
      console.error(error);
      showToast(friendlyError(error, "Could not submit result."), "error");
    }
  }

  /* ========================= RANKINGS ========================= */

  async function rankingsPage() {
    const format = String(state.rankFormat || "ALL").toUpperCase();
    const rankings = await getRankings(format);
    const labels = {SOLO: "SOLO", DUO: "DUO", SQUAD: "SQUAD", ALL: "ALL FORMATS"};
    return `<div class="container"><div style="margin-bottom:16px"><div class="kicker">PERMANENT LEADERBOARD</div><h1 class="title">${esc(labels[format] || "RANKINGS")} RANKINGS</h1><div class="desc">Each format has its own permanent point pool. An approved SOLO result changes only SOLO points; DUO and SQUAD remain separate.</div></div>
      <div class="ranking-format-grid" role="tablist" aria-label="Ranking formats">
        ${["SOLO","DUO","SQUAD","ALL"].map((item) => `<button class="ranking-format-btn ${item === format ? "active" : ""}" type="button" data-ranking-format="${item}"><strong>${item === "ALL" ? "ALL" : item}</strong><span>${item === "ALL" ? "COMBINED VIEW" : `${item} ONLY`}</span></button>`).join("")}
      </div>
      <section class="panel"><div class="panel-head"><div><div class="kicker">${esc(labels[format] || "RANKING")}</div><h3>${esc(labels[format] || "RANKING")} LEADERBOARD</h3></div><span class="badge badge-blue">NEVER RESET</span></div><div class="table-shell"><table><thead><tr><th>Rank</th><th>Team</th><th>Points</th><th>Matches</th><th>Wins</th><th>Losses</th><th>Win Rate</th></tr></thead><tbody>${rankings.map((row) => `<tr><td><strong>#${esc(row.rank_number)}</strong></td><td><div class="identity">${logo(row.logo_url, row.team_name, "mini-logo")}<div><strong>${esc(row.team_name)}</strong><div style="color:#5a738b;margin-top:2px">IGL: ${esc(row.igl_name || "—")}</div></div></div></td><td><span class="badge badge-blue">${esc(row.total_points)}</span></td><td>${esc(row.matches)}</td><td>${esc(row.wins)}</td><td>${esc(row.losses)}</td><td>${esc(row.win_rate)}%</td></tr>`).join("") || `<tr><td colspan="7">No active teams yet.</td></tr>`}</tbody></table></div></section></div>`;
  }

  function bindRankings() {
    document.querySelectorAll("[data-ranking-format]").forEach((button) => {
      button.addEventListener("click", () => {
        state.rankFormat = String(button.dataset.rankingFormat || "ALL").toUpperCase();
        loadMemberSection();
      });
    });
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
      let team = null;
      if (type === "TEAM_RECRUITMENT") {
        team = state.team || await ensureApprovedTeam();
        roles = [...(document.getElementById("recruitLookingFor")?.selectedOptions || [])].map((o) => o.value);
        if (!roles.length) throw new Error("Select at least one role.");
      } else {
        ign = document.getElementById("playerIgn")?.value.trim();
        uid = document.getElementById("playerUid")?.value.trim();
        roles = [document.getElementById("playerRole")?.value];
        if (!ign || !uid) throw new Error("Player IGN and UID are required.");
      }

      const { error } = await supabase.rpc("create_recruitment_post", {
        p_team_id: team?.id || null,
        p_team_name: team?.name || ign,
        p_team_logo_url: team?.logo_url || null,
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
      const team = state.team || await ensureApprovedTeam();
      state.team = team;
      const canEditTeam = state.isAdmin || state.profile?.role === "leader";
      const memberName = document.getElementById("profileMemberName")?.value.trim() || "";
      const phone = cleanPhone(document.getElementById("profilePhone")?.value || "");
      if (phone && !/^\+92\d{10}$/.test(phone)) throw new Error("Enter a valid Pakistan contact number.");

      let teamName = team.name;
      let igl = team.igl_name || "";
      let logoUrl = team.logo_url || null;

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
        p_team_id: team.id,
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
    const team = state.team || await ensureApprovedTeam();
    state.team = team;
    const [challenges, posts] = await Promise.all([
      supabase.from("practice_challenges").select("*").eq("team_id", team.id).order("created_at", { ascending: false }),
      supabase.from("recruitment_posts").select("*").eq("team_id", team.id).order("created_at", { ascending: false })
    ]);
    if (challenges.error) throw challenges.error;
    if (posts.error) throw posts.error;
    return `<div class="container"><div style="margin-bottom:16px"><div class="kicker">TEAM ACTIVITY</div><h1 class="title">MY POSTS</h1><div class="desc">${esc(team.name)}</div></div><section class="member-grid"><div class="panel"><div class="panel-head"><div><div class="kicker">PRACTICE</div><h3>MY CHALLENGES</h3></div></div><div class="feed-list">${(challenges.data || []).map(challengeCard).join("") || `<div class="empty">No practice posts.</div>`}</div></div><div class="panel"><div class="panel-head"><div><div class="kicker">RECRUITMENT</div><h3>MY RECRUITMENT</h3></div></div><div class="feed-list">${(posts.data || []).map(recruitmentCard).join("") || `<div class="empty">No recruitment posts.</div>`}</div></div></section></div>`;
  }

  /* ========================= ADMIN POINTS ========================= */

  async function loadAdminPointControls() {
    const { data, error } = await supabase.rpc("admin_get_team_points");
    if (error) throw error;
    state.adminPoints = data || [];
    return state.adminPoints;
  }

  function adminPointsContent() {
    const rows = state.adminPoints || [];
    return `<div class="panel"><div class="panel-head"><div><div class="kicker">MANUAL CONTROL</div><h3>TEAM POINT MANAGEMENT</h3><div class="subtle">Point controls are available inside each Team &gt; ⋮ &gt; EDIT panel. Verified match history is never rewritten by an Admin adjustment.</div></div><span class="badge badge-blue">ADMIN ONLY</span></div><div class="admin-warning" style="margin-bottom:12px"><b>POINT SAFETY:</b> Verified result points stay untouched. Only the separate Admin Adjustment can be changed here. The total ranking is recalculated automatically.</div><div class="table-shell"><table style="min-width:1120px"><thead><tr><th>Team</th><th>SOLO</th><th>DUO</th><th>SQUAD</th><th>ALL FORMATS</th><th>Control</th></tr></thead><tbody>${rows.map((row) => `<tr><td><div class="identity">${logo(row.logo_url, row.team_name)}<div><strong>${esc(row.team_name)}</strong><div class="meta">IGL: ${esc(row.igl_name || "—")}</div><span class="badge ${row.team_status === "active" ? "badge-green" : row.team_status === "banned" ? "badge-danger" : "badge-warn"}" style="margin-top:5px">${esc(row.team_status || "—")}</span></div></div></td><td><strong>${esc(row.solo_total)}</strong><div class="meta">VERIFIED ${esc(row.solo_verified)} • CARRY ${esc(row.solo_carry)} • ADMIN ${esc(row.solo_adjustment)}</div></td><td><strong>${esc(row.duo_total)}</strong><div class="meta">VERIFIED ${esc(row.duo_verified)} • CARRY ${esc(row.duo_carry)} • ADMIN ${esc(row.duo_adjustment)}</div></td><td><strong>${esc(row.squad_total)}</strong><div class="meta">VERIFIED ${esc(row.squad_verified)} • CARRY ${esc(row.squad_carry)} • ADMIN ${esc(row.squad_adjustment)}</div></td><td><span class="badge badge-cyan">${esc(row.total_points)} PTS</span></td><td><button class="btn btn-primary btn-small" data-edit-points="${esc(row.team_id)}">EDIT POINTS</button></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">No teams available.</div></td></tr>`}</tbody></table></div></div>`;
  }

  function openAdminPointsEdit(teamId) {
    const row = state.adminPoints.find((item) => item.team_id === teamId);
    if (!row) return showToast("Team points record not found.", "error");

    showModal("EDIT TEAM POINTS", `<form id="adminPointsEditForm"><div class="access-note" style="margin-bottom:12px"><b>${esc(row.team_name)}</b><br>Enter a positive number to ADD points, or a negative number to REMOVE points. Verified results are never edited by this control.</div><div class="field-grid"><label>SOLO ADMIN CHANGE<input id="pointsSoloDelta" type="number" step="1" min="-2" max="2" value="0" placeholder="+1 / -1 / +2 / -2"><div class="hint">Current Admin Adjustment: ${esc(row.solo_adjustment)}</div></label><label>DUO ADMIN CHANGE<input id="pointsDuoDelta" type="number" step="1" min="-2" max="2" value="0" placeholder="+1 / -1 / +2 / -2"><div class="hint">Current Admin Adjustment: ${esc(row.duo_adjustment)}</div></label><label>SQUAD ADMIN CHANGE<input id="pointsSquadDelta" type="number" step="1" min="-2" max="2" value="0" placeholder="+1 / -1 / +2 / -2"><div class="hint">Current Admin Adjustment: ${esc(row.squad_adjustment)}</div></label><div class="info-box"><small>CURRENT TOTAL</small><strong>SOLO ${esc(row.solo_total)} • DUO ${esc(row.duo_total)} • SQUAD ${esc(row.squad_total)}</strong></div></div><div class="auth-actions" style="justify-content:flex-start"><button class="btn btn-primary" type="submit">APPLY POINT CHANGES</button><button class="btn btn-dark" id="adminPointsCancel" type="button">CANCEL</button></div></form>`);
    document.getElementById("adminPointsEditForm")?.addEventListener("submit", (event) => saveAdminPointsEdit(event, row));
    document.getElementById("adminPointsCancel")?.addEventListener("click", closeModal);
  }

  async function saveAdminPointsEdit(event, row) {
    event.preventDefault();
    try {
      const solo = Number(document.getElementById("pointsSoloDelta")?.value || 0);
      const duo = Number(document.getElementById("pointsDuoDelta")?.value || 0);
      const squad = Number(document.getElementById("pointsSquadDelta")?.value || 0);
      if (![solo, duo, squad].every(Number.isInteger)) throw new Error("Point changes must be whole numbers.");
      if (solo === 0 && duo === 0 && squad === 0) throw new Error("Enter at least one point change.");
      if ([solo, duo, squad].some((value) => value < -2 || value > 2)) throw new Error("Each Admin point change must be -2, -1, +1 or +2.");

      const summary = [`SOLO ${solo >= 0 ? "+" : ""}${solo}`, `DUO ${duo >= 0 ? "+" : ""}${duo}`, `SQUAD ${squad >= 0 ? "+" : ""}${squad}`].filter((value) => !/ 0$/.test(value)).join(" • ");
      if (!confirm(`Apply point changes to ${row.team_name}?\n\n${summary}`)) return;

      const { error } = await supabase.rpc("admin_adjust_team_points", {
        p_team_id: row.team_id,
        p_solo_delta: solo,
        p_duo_delta: duo,
        p_squad_delta: squad,
        p_reason: document.getElementById("pointsReason")?.value.trim() || null
      });
      if (error) throw error;

      closeModal();
      showToast("Team points updated successfully. Rankings recalculated.");
      await refreshAdmin();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not update team points."), "error");
    }
  }

  /* ========================= ADMIN CENTER ========================= */

  async function adminPage() {
    const [profiles, teams, challenges, recruitment, results] = await Promise.all([
      supabase.from("profiles").select("*").neq("role", "admin").order("created_at", { ascending: false }).limit(300),
      supabase.from("teams").select("*").neq("status", "removed").order("created_at", { ascending: false }).limit(300),
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

    return `<div class="container"><div style="margin-bottom:16px"><div class="kicker">RESTRICTED CONTROL</div><div class="admin-toolbar"><div><h1 class="title" style="margin-bottom:6px">ADMIN CONTROL CENTER</h1><div class="desc">Approval, member management, team editing, 3-dot team controls, point adjustments, permanent team removal, result verification and post moderation.</div></div><div class="toolbar-actions"><button class="btn btn-dark btn-small" id="adminDashboardBtn" type="button">DASHBOARD</button><button class="btn btn-logout btn-small" id="adminLogoutBtn" type="button">LOGOUT</button></div></div></div><div class="quick-grid"><div class="quick"><div class="qicon">${pending}</div><b>PENDING MEMBERS</b><span>Registration queue.</span></div><div class="quick"><div class="qicon">${resultPending}</div><b>PENDING RESULTS</b><span>Verification queue.</span></div><div class="quick"><div class="qicon">${state.teams.length}</div><b>TEAMS</b><span>Full team directory.</span></div><div class="quick"><div class="qicon">${state.results.filter((row) => row.status === "approved").length}</div><b>VERIFIED RESULTS</b><span>Permanent records.</span></div></div><div class="admin-grid" style="margin-top:16px"><aside class="admin-tabs"><button class="admin-tab ${state.adminSection === "registrations" ? "active" : ""}" data-admin="registrations">REGISTRATIONS <span class="admin-count">${pending}</span></button><button class="admin-tab ${state.adminSection === "members" ? "active" : ""}" data-admin="members">MEMBERS</button><button class="admin-tab ${state.adminSection === "teams" ? "active" : ""}" data-admin="teams">TEAMS</button><button class="admin-tab ${state.adminSection === "results" ? "active" : ""}" data-admin="results">RESULTS <span class="admin-count">${resultPending}</span></button><button class="admin-tab ${state.adminSection === "practice" ? "active" : ""}" data-admin="practice">PRACTICE</button><button class="admin-tab ${state.adminSection === "recruitment" ? "active" : ""}" data-admin="recruitment">RECRUITMENT</button></aside><section>${adminContent()}</section></div></div>`;
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

  async function getAdminTeamDetails(teamId) {
    const { data, error } = await supabase.rpc("admin_get_team_details", { p_team_id: teamId });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  }

  function teamPointCards(detail) {
    return `<div class="team-info-grid">
      <div class="team-info-card"><small>SOLO POINTS</small><strong>${esc(detail.solo_points ?? 0)}</strong></div>
      <div class="team-info-card"><small>DUO POINTS</small><strong>${esc(detail.duo_points ?? 0)}</strong></div>
      <div class="team-info-card"><small>SQUAD POINTS</small><strong>${esc(detail.squad_points ?? 0)}</strong></div>
    </div>`;
  }

  function teamMembersCards(detail) {
    const members = Array.isArray(detail.members) ? detail.members : [];
    if (!members.length) return `<div class="empty">No website members are currently attached to this team.</div>`;
    return members.map((m) => `<div class="team-member-card">
      <div class="team-member-head"><div><strong>${esc(m.display_name || "—")}</strong><div class="meta">${esc(roleName(m.role))}</div></div><span class="badge ${m.status === "approved" ? "badge-green" : m.status === "banned" ? "badge-danger" : "badge-warn"}">${esc(m.status || "—")}</span></div>
      <div class="team-member-meta"><div><b>CONTACT</b><br>${esc(m.phone || "—")}</div><div><b>EMAIL</b><br>${esc(m.email || "—")}</div><div><b>ROLE</b><br>${esc(roleName(m.role))}</div></div>
    </div>`).join("");
  }

  async function openAdminTeamInfo(teamId) {
    try {
      const detail = await getAdminTeamDetails(teamId);
      if (!detail) throw new Error("Team details not found.");
      state.teamDetails = detail;
      showModal("TEAM INFORMATION", `<div class="identity" style="margin-bottom:14px">${logo(detail.logo_url, detail.team_name, "profile-logo")}<div><strong style="font-family:'Barlow Condensed',sans-serif;font-size:27px">${esc(detail.team_name)}</strong><div class="meta">IGL: ${esc(detail.igl_name || "—")} • STATUS: ${esc(detail.team_status || "—")}</div></div></div>${teamPointCards(detail)}<div class="kicker" style="margin-bottom:7px">TEAM MEMBERS</div>${teamMembersCards(detail)}<div class="auth-actions" style="justify-content:flex-start;margin-top:12px"><button class="btn btn-primary" id="teamInfoEditBtn" type="button">EDIT</button><button class="btn btn-dark" id="teamInfoCloseBtn" type="button">CLOSE</button></div>`);
      document.getElementById("teamInfoEditBtn")?.addEventListener("click", () => openAdminTeamEdit(teamId));
      document.getElementById("teamInfoCloseBtn")?.addEventListener("click", closeModal);
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not load team information."), "error");
    }
  }

  async function openAdminTeamEdit(teamId) {
    try {
      const detail = await getAdminTeamDetails(teamId);
      if (!detail) throw new Error("Team details not found.");
      state.teamDetails = detail;
      const members = Array.isArray(detail.members) ? detail.members : [];
      const memberEditors = members.map((m) => `<div class="team-member-card">
        <div class="team-member-head"><div><strong>${esc(m.display_name || "—")}</strong><div class="meta">${esc(m.email || "—")} • ${esc(roleName(m.role))}</div></div><button class="btn btn-danger btn-small" type="button" data-remove-member="${esc(m.user_id)}" data-remove-team="${esc(detail.team_id)}">REMOVE MEMBER</button></div>
        <div class="field-grid">
          <label>MEMBER NAME<input class="admin-member-name" data-member-id="${esc(m.user_id)}" value="${esc(m.display_name || "")}" maxlength="60"></label>
          <label>CONTACT<input class="admin-member-phone" data-member-id="${esc(m.user_id)}" value="${esc(m.phone || "")}" maxlength="20"></label>
          <label>WEBSITE ROLE<select class="admin-member-role" data-member-id="${esc(m.user_id)}"><option value="leader" ${m.role === "leader" ? "selected" : ""}>Team Leader / IGL</option><option value="sub_leader" ${m.role === "sub_leader" ? "selected" : ""}>Sub-Leader</option></select></label>
          <div class="info-box"><small>EMAIL</small><strong style="word-break:break-word">${esc(m.email || "—")}</strong></div>
        </div>
        <div class="auth-actions" style="justify-content:flex-start"><button class="btn btn-dark btn-small" type="button" data-save-member-inline="${esc(m.user_id)}" data-member-role="${esc(m.role)}">SAVE MEMBER</button></div>
      </div>`).join("");

      showModal("EDIT TEAM", `<form id="adminTeamEditForm"><div class="identity" style="margin-bottom:12px">${logo(detail.logo_url, detail.team_name, "profile-logo")}<div><strong style="font-family:'Barlow Condensed',sans-serif;font-size:24px">${esc(detail.team_name)}</strong><div class="meta">Edit team identity, member contact/details and points.</div></div></div><div class="field-grid"><label>TEAM NAME *<input id="adminTeamName" maxlength="50" value="${esc(detail.team_name || "")}" required></label><label>IGL NAME *<input id="adminIglName" maxlength="60" value="${esc(detail.igl_name || "")}" required></label><label>TEAM LOGO — OPTIONAL<input id="adminTeamLogo" type="file" accept="image/png,image/jpeg,image/webp"><div class="hint">Leave empty to keep current logo.</div></label><div class="info-box"><small>TEAM EMAIL</small><strong>Emails are shown per member and are managed by Auth.</strong></div></div><div class="kicker" style="margin:14px 0 7px">MEMBERS — CONTACT / ROLE / REMOVE</div>${memberEditors || `<div class="empty">No members found.</div>`}<div class="kicker" style="margin:14px 0 7px">POINT ADJUSTMENT</div><div class="access-note"><b>POINTS:</b> Enter +1 / +2 to add or -1 / -2 to subtract. Verified match results are never edited. Changes are separately audited Admin Adjustments.</div><div class="field-grid"><label>SOLO CHANGE<input id="pointsSoloDelta" type="number" step="1" min="-2" max="2" value="0" placeholder="+1 / -1 / +2 / -2"><div class="hint">Current SOLO total: ${esc(detail.solo_points ?? 0)}</div><div class="quick-points"><button type="button" data-point-input="pointsSoloDelta" data-point-delta="1">+1</button><button type="button" data-point-input="pointsSoloDelta" data-point-delta="2">+2</button><button type="button" data-point-input="pointsSoloDelta" data-point-delta="-1">−1</button><button type="button" data-point-input="pointsSoloDelta" data-point-delta="-2">−2</button></div></label><label>DUO CHANGE<input id="pointsDuoDelta" type="number" step="1" min="-2" max="2" value="0" placeholder="+1 / -1 / +2 / -2"><div class="hint">Current DUO total: ${esc(detail.duo_points ?? 0)}</div><div class="quick-points"><button type="button" data-point-input="pointsDuoDelta" data-point-delta="1">+1</button><button type="button" data-point-input="pointsDuoDelta" data-point-delta="2">+2</button><button type="button" data-point-input="pointsDuoDelta" data-point-delta="-1">−1</button><button type="button" data-point-input="pointsDuoDelta" data-point-delta="-2">−2</button></div></label><label>SQUAD CHANGE<input id="pointsSquadDelta" type="number" step="1" min="-2" max="2" value="0" placeholder="+1 / -1 / +2 / -2"><div class="hint">Current SQUAD total: ${esc(detail.squad_points ?? 0)}</div><div class="quick-points"><button type="button" data-point-input="pointsSquadDelta" data-point-delta="1">+1</button><button type="button" data-point-input="pointsSquadDelta" data-point-delta="2">+2</button><button type="button" data-point-input="pointsSquadDelta" data-point-delta="-1">−1</button><button type="button" data-point-input="pointsSquadDelta" data-point-delta="-2">−2</button></div></label><label class="full">REASON (OPTIONAL)<input id="pointsReason" maxlength="180" placeholder="Why are these points being adjusted?"></label></div><div class="auth-actions" style="justify-content:flex-start"><button class="btn btn-primary" type="submit">SAVE TEAM + POINTS</button><button class="btn btn-dark" id="adminEditCancel" type="button">CANCEL</button></div></form>`);

      document.getElementById("adminEditCancel")?.addEventListener("click", closeModal);
      document.getElementById("adminTeamEditForm")?.addEventListener("submit", (event) => saveCombinedAdminTeamEdit(event, detail));
      document.querySelectorAll("[data-point-input]").forEach((button) => button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.pointInput);
        if (!input) return;
        input.value = String(Number(input.value || 0) + Number(button.dataset.pointDelta || 0));
      }));
      document.querySelectorAll("[data-save-member-inline]").forEach((button) => button.addEventListener("click", () => saveInlineMember(button.dataset.saveMemberInline, detail.team_id)));
      document.querySelectorAll("[data-remove-member]").forEach((button) => button.addEventListener("click", () => adminRemoveMember(button.dataset.removeMember, button.dataset.removeTeam)));
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not open team editor."), "error");
    }
  }

  async function saveCombinedAdminTeamEdit(event, detail) {
    event.preventDefault();
    try {
      const teamName = document.getElementById("adminTeamName")?.value.trim() || "";
      const iglName = document.getElementById("adminIglName")?.value.trim() || "";
      const file = document.getElementById("adminTeamLogo")?.files?.[0] || null;
      if (!teamName || !iglName) throw new Error("Team name and IGL name are required.");

      let logoUrl = detail.logo_url || null;
      if (file) {
        if (file.size > MAX_IMAGE_MB * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error(`Logo must be PNG/JPG/WEBP and ${MAX_IMAGE_MB} MB or smaller.`);
        logoUrl = await uploadFile(LOGO_BUCKET, state.user.id, file);
      }

      const solo = Number(document.getElementById("pointsSoloDelta")?.value || 0);
      const duo = Number(document.getElementById("pointsDuoDelta")?.value || 0);
      const squad = Number(document.getElementById("pointsSquadDelta")?.value || 0);
      if (![solo, duo, squad].every(Number.isInteger)) throw new Error("Point changes must be whole numbers.");
      if ([solo, duo, squad].some((value) => value < -2 || value > 2)) throw new Error("Each Admin point change must be -2, -1, +1 or +2.");

      const { error: saveError } = await supabase.rpc("admin_edit_team_and_points", {
        p_team_id: detail.team_id,
        p_team_name: teamName,
        p_igl_name: iglName,
        p_logo_url: logoUrl,
        p_solo_delta: solo,
        p_duo_delta: duo,
        p_squad_delta: squad,
        p_reason: document.getElementById("pointsReason")?.value.trim() || null
      });
      if (saveError) throw saveError;

      closeModal();
      showToast("Team information and point changes saved successfully.");
      await refreshAdmin();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not save team changes."), "error");
    }
  }

  async function saveInlineMember(userId, teamId) {
    try {
      const nameEl = document.querySelector(`.admin-member-name[data-member-id="${CSS.escape(userId)}"]`);
      const phoneEl = document.querySelector(`.admin-member-phone[data-member-id="${CSS.escape(userId)}"]`);
      const roleEl = document.querySelector(`.admin-member-role[data-member-id="${CSS.escape(userId)}"]`);
      const displayName = nameEl?.value.trim() || "";
      const phoneRaw = phoneEl?.value.trim() || "";
      const phone = phoneRaw ? cleanPhone(phoneRaw) : null;
      const role = roleEl?.value || "";
      if (!displayName) throw new Error("Member name is required.");
      if (phone && !/^\+92\d{10}$/.test(phone)) throw new Error("Enter a valid Pakistan mobile number.");
      const { error } = await supabase.rpc("admin_edit_member", { p_user_id: userId, p_display_name: displayName, p_phone: phone, p_role: role });
      if (error) throw error;
      showToast("Member details updated.");
      await openAdminTeamEdit(teamId);
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not update member."), "error");
    }
  }

  async function adminRemoveMember(userId, teamId) {
    const detail = state.teamDetails || await getAdminTeamDetails(teamId);
    const member = (detail?.members || []).find((m) => m.user_id === userId);
    if (!member) return showToast("Member not found.", "error");
    const promoted = member.role === "leader" && (detail.members || []).some((m) => m.user_id !== userId && m.role === "sub_leader");
    const warning = promoted ? " The remaining Sub-Leader will automatically become Team Leader / IGL." : "";
    if (!confirm(`Remove ${member.display_name || "this member"} from ${detail.team_name}?${warning}\n\nThis does not remove the team's verified points.`)) return;
    try {
      const { error } = await supabase.rpc("admin_remove_team_member", { p_team_id: teamId, p_user_id: userId });
      if (error) throw error;
      closeModal();
      showToast(`${member.display_name || "Member"} was removed from the team.`);
      await refreshAdmin();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not remove member."), "error");
    }
  }

  function adminTeamsContent() {
    return `<div class="panel"><div class="panel-head"><div><div class="kicker">TEAM MANAGEMENT</div><h3>ALL TEAMS</h3><div class="subtle">Use the <b>⋮</b> menu on any team to view complete information, edit team data, change points, remove one member, ban/unban, or permanently remove the whole team.</div></div><span class="badge badge-blue">3-DOT CONTROL</span></div><div class="table-shell"><table><thead><tr><th>Team</th><th>IGL</th><th>Status</th><th>Created</th><th>Control</th></tr></thead><tbody>${state.teams.map((team) => {
      const banLabel = team.status === "banned" ? "UNBAN TEAM" : "BAN TEAM";
      const banClass = team.status === "banned" ? "green" : "danger";
      return `<tr><td><div class="identity">${logo(team.logo_url, team.name)}<div><strong>${esc(team.name)}</strong><div class="meta">IGL: ${esc(team.igl_name || "—")}</div></div></div></td><td>${esc(team.igl_name || "—")}</td><td><span class="badge ${team.status === "active" ? "badge-green" : team.status === "banned" ? "badge-danger" : "badge-warn"}">${esc(team.status)}</span></td><td>${esc(formatDate(team.created_at))}</td><td><div class="team-menu" data-team-menu-wrap="${esc(team.id)}"><button class="team-menu-toggle" type="button" data-team-menu-toggle="${esc(team.id)}" aria-label="Team actions">⋮</button><div class="team-menu-panel"><button class="team-menu-item" data-team-info="${esc(team.id)}">TEAM INFO</button><button class="team-menu-item" data-team-edit="${esc(team.id)}">EDIT</button><button class="team-menu-item ${banClass}" data-team-status="${esc(team.id)}" data-next="${team.status === "banned" ? "active" : "banned"}">${banLabel}</button><button class="team-menu-item danger" data-team-remove="${esc(team.id)}">REMOVE TEAM</button></div></div></td></tr>`;
    }).join("") || `<tr><td colspan="5"><div class="empty">No teams.</div></td></tr>`}</tbody></table></div></div>`;
  }

  function adminResultsContent() {
    const teamName = (id) => state.teams.find((team) => team.id === id)?.name || id || "—";
    return `<div class="panel"><div class="panel-head"><div><div class="kicker">VERIFY</div><h3>MATCH RESULTS</h3><div class="subtle">Admin approval activates +3 for the Winner and −3 for the Loser in the selected permanent format ranking.</div></div><span class="badge badge-blue">WIN +3 • LOSS −3</span></div><div class="table-shell"><table><thead><tr><th>Challenge</th><th>Winner</th><th>Loser</th><th>Score</th><th>Proof</th><th>Status</th><th>Control</th></tr></thead><tbody>${state.results.map((row) => {
      const winner = row.winner_team_name || (row.outcome === "WIN" ? teamName(row.team_id) : row.opponent_team_name) || "—";
      const loser = row.loser_team_name || (row.outcome === "LOSS" ? teamName(row.team_id) : row.opponent_team_name) || "—";
      const hasSnapshot = Boolean(row.challenge_team_name || row.challenge_id || row.challenge_format);
      const challengeLabel = hasSnapshot
        ? `${row.challenge_match_type || row.match_type || "MATCH"} • ${row.challenge_format || row.format || "—"}`
        : "Legacy result";
      return `<tr><td>${esc(challengeLabel)}</td><td><strong>${esc(winner)}</strong></td><td><strong>${esc(loser)}</strong></td><td><span class="badge badge-cyan">${esc(row.score || "—")}</span></td><td>${row.proof_challenge_url ? `<button class="btn btn-dark btn-small" data-proof-ref="${esc(row.proof_challenge_url)}" data-proof-title="CHALLENGE PROOF">S1</button> ` : ""}${row.proof_result_url || row.proof_url ? `<button class="btn btn-dark btn-small" data-proof-ref="${esc(row.proof_result_url || row.proof_url)}" data-proof-title="RESULT PROOF">S2</button>` : "—"}</td><td>${esc(row.status)}</td><td>${row.status === "pending" ? `<button class="btn btn-green btn-small" data-review="${esc(row.id)}" data-next="approved">APPROVE</button> <button class="btn btn-danger btn-small" data-review="${esc(row.id)}" data-next="rejected">REJECT</button>` : "—"}</td></tr>`;
    }).join("") || `<tr><td colspan="7">No results.</td></tr>`}</tbody></table></div></div>`;
  }

  function adminPracticeContent() {
    return `<div class="panel"><div class="panel-head"><div><div class="kicker">LIVE ARENA</div><h3>PRACTICE CHALLENGES</h3></div></div><div class="table-shell"><table><thead><tr><th>Team</th><th>Match</th><th>Format</th><th>Time</th><th>Status</th><th>Control</th></tr></thead><tbody>${state.challenges.map((challenge) => `<tr><td>${esc(challenge.team_name)}</td><td>${esc(challenge.match_type)}</td><td>${esc(challenge.format)}</td><td>${esc(formatTimeOnly(challenge.match_time))}</td><td>${esc(challenge.status)}</td><td>${["open","accepted"].includes(challenge.status) ? `<button class="btn btn-dark btn-small" data-post="practice" data-id="${esc(challenge.id)}" data-next="closed">CLOSE</button>` : "—"}</td></tr>`).join("") || `<tr><td colspan="6">No challenges.</td></tr>`}</tbody></table></div></div>`;
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

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".team-menu")) document.querySelectorAll(".team-menu.open").forEach((node) => node.classList.remove("open"));
  });
  window.addEventListener("scroll", () => {
    document.querySelectorAll(".team-menu.open").forEach((node) => node.classList.remove("open"));
  }, { passive: true });
  window.addEventListener("resize", () => {
    document.querySelectorAll(".team-menu.open").forEach((node) => node.classList.remove("open"));
  });

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
    document.querySelectorAll("[data-team-menu-toggle]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const wrap = button.closest("[data-team-menu-wrap]");
      document.querySelectorAll(".team-menu.open").forEach((node) => { if (node !== wrap) node.classList.remove("open"); });
      if (!wrap) return;
      wrap.classList.toggle("open");
      if (wrap.classList.contains("open")) {
        const panel = wrap.querySelector(".team-menu-panel");
        const rect = button.getBoundingClientRect();
        if (panel) {
          const viewportPad = 8;
          const panelWidth = Math.min(Math.max(panel.offsetWidth || 190, 170), window.innerWidth - viewportPad * 2);
          const panelHeight = panel.offsetHeight || 220;
          let left = rect.right - panelWidth;
          let top = rect.bottom + 6;
          if (left < viewportPad) left = viewportPad;
          if (left + panelWidth > window.innerWidth - viewportPad) left = window.innerWidth - panelWidth - viewportPad;
          if (top + panelHeight > window.innerHeight - viewportPad) top = Math.max(viewportPad, rect.top - panelHeight - 6);
          panel.style.width = `${panelWidth}px`;
          panel.style.left = `${Math.round(left)}px`;
          panel.style.top = `${Math.round(top)}px`;
        }
      }
    }));
    document.querySelectorAll("[data-team-info]").forEach((button) => button.addEventListener("click", () => { document.querySelector(`[data-team-menu-wrap="${CSS.escape(button.dataset.teamInfo)}"]`)?.classList.remove("open"); openAdminTeamInfo(button.dataset.teamInfo); }));
    document.querySelectorAll("[data-team-edit]").forEach((button) => button.addEventListener("click", () => { document.querySelector(`[data-team-menu-wrap="${CSS.escape(button.dataset.teamEdit)}"]`)?.classList.remove("open"); openAdminTeamEdit(button.dataset.teamEdit); }));
    document.querySelectorAll("[data-team-status]").forEach((button) => button.addEventListener("click", () => adminTeamStatus(button.dataset.teamStatus, button.dataset.next)));
    document.querySelectorAll("[data-team-remove]").forEach((button) => button.addEventListener("click", () => adminRemoveTeam(button.dataset.teamRemove)));
    document.querySelectorAll("[data-review]").forEach((button) => button.addEventListener("click", () => reviewResult(button.dataset.review, button.dataset.next)));
    document.querySelectorAll("[data-post]").forEach((button) => button.addEventListener("click", () => adminPost(button.dataset.post, button.dataset.id, button.dataset.next)));
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
    if (!['active', 'banned'].includes(status)) {
      showToast("Invalid team status action.", "error");
      return;
    }
    const action = status === "banned" ? "BAN" : "UNBAN";
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

  async function adminRemoveTeam(teamId) {
    const team = state.teams.find((row) => row.id === teamId);
    const name = team?.name || "this team";
    if (!confirm(`PERMANENT REMOVE: ${name}?\n\nTeam/member/post data will be removed. Verified points will be preserved. This action cannot be undone.`)) return;
    try {
      const { error } = await supabase.rpc("admin_remove_team_permanently", {
        p_team_id: teamId
      });
      if (error) throw error;
      showToast(`${name} was permanently removed. Verified points were preserved.`);
      await refreshAdmin();
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "Could not permanently remove team."), "error");
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
      if (kind === "practice" && status === "open") {
        throw new Error("Practice challenges cannot be reopened after being closed or accepted.");
      }
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

      const { error } = await supabase.rpc("admin_edit_member_and_status", {
        p_user_id: member.id,
        p_display_name: displayName,
        p_phone: phone,
        p_role: role,
        p_status: status
      });
      if (error) throw error;

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

    document.querySelectorAll("[data-proof-ref]").forEach((button) => button.addEventListener("click", async () => {
      await openProof(button.dataset.proofRef, button.dataset.proofTitle || "RESULT PROOF");
    }));

    document.querySelectorAll("[data-accept-challenge]").forEach((button) => button.addEventListener("click", async () => {
      const id = button.dataset.acceptChallenge;
      if (!id) return;
      button.disabled = true;
      button.textContent = "ACCEPTING...";
      try {
        const { error } = await supabase.rpc("accept_practice_challenge", { p_challenge_id: id });
        if (error) throw error;
        showToast("Challenge accepted. You can submit the final result after the match.");
        await loadMemberSection();
      } catch (error) {
        console.error(error);
        button.disabled = false;
        button.textContent = "ACCEPT CHALLENGE";
        showToast(friendlyError(error, "Could not accept challenge."), "error");
      }
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
