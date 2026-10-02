/*
  7TH UNIVERSE ESPORTS — Professional rebuild
  FREE FIRE • PRACTICE • RECRUITMENT

  Connected to the separate ESPORTS Supabase project.
  Frontend contains ONLY the Supabase publishable key.
  Never put a service_role / secret key in this file.
*/

(() => {
  "use strict";

  const SUPABASE_URL = "https://otrjuqcutwlwvzyruhaq.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ro_4z-4OdgFCda9pT8Z3Pg_UEnY4aTE";

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

  const state = {
    user: null,
    profile: null,
    team: null,
    isAdmin: false,
    page: "dashboard",
    adminTab: "registrations",
    challenges: [],
    recruitment: [],
    registrations: [],
    teams: [],
    memberCounts: {},
    registrationMode: false
  };

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));

  const safeJson = (obj) => esc(JSON.stringify(obj));

  const showToast = (message, type = "success") => {
    toast.textContent = message;
    toast.className = `show ${type}`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.className = ""; }, 4200);
  };

  const openModal = (title, body) => {
    modalTitle.textContent = title;
    modalBody.innerHTML = body;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  };

  const closeModal = () => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  };

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  const cleanPhone = (input) => {
    let v = String(input || "").trim().replace(/[^\d+]/g, "");
    if (v.startsWith("00")) v = "+" + v.slice(2);
    if (v.startsWith("03")) v = "+92" + v.slice(1);
    if (v.startsWith("92")) v = "+" + v;
    return v;
  };

  const formatDate = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
  };

  const formatRole = (role) => ({
    admin: "Administrator",
    leader: "Team Leader / IGL",
    sub_leader: "Sub-Leader",
    member: "Member"
  }[role] || role || "Member");

  const logoHtml = (url, label = "7U") =>
    url
      ? `<img class="team-logo" src="${esc(url)}" alt="${esc(label)} logo">`
      : `<div class="team-logo placeholder">${esc(label.slice(0,3).toUpperCase())}</div>`;

  function ensureClient() {
    if (!sb) throw new Error("Supabase client failed to initialize.");
  }

  async function getProfile(userId) {
    const { data, error } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getTeamForUser(userId) {
    const { data, error } = await sb
      .from("team_members")
      .select(`
        id,
        team_id,
        role,
        status,
        teams ( id, name, logo_url, status, created_at )
      `)
      .eq("user_id", userId)
      .in("status", ["pending","approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data?.teams || null;
  }

  async function hydrateSession() {
    ensureClient();
    const { data: { session } } = await sb.auth.getSession();
    state.user = session?.user || null;

    if (!state.user) {
      state.profile = null;
      state.team = null;
      state.isAdmin = false;
      state.page = "dashboard";
      renderAuth();
      return;
    }

    try {
      state.profile = await getProfile(state.user.id);

      /*
        When Supabase email confirmation is ON, signUp() returns no session.
        The registration metadata is retained in auth.users. On first login,
        complete the pending public profile through the existing RPC.
      */
      if (!state.profile) {
        const meta = state.user.user_metadata || {};
        if (meta.team_name && meta.display_name && meta.requested_role) {
          const { error: regError } = await sb.rpc("register_team_member", {
            p_user_id: state.user.id,
            p_team_name: meta.team_name,
            p_member_name: meta.display_name,
            p_phone: meta.phone || null,
            p_role: meta.requested_role,
            p_logo_url: meta.logo_url || null
          });
          if (regError) throw regError;
          state.profile = await getProfile(state.user.id);
        }
      }

      if (!state.profile) {
        await sb.auth.signOut();
        throw new Error("Account profile is missing. Please contact the administrator.");
      }

      state.isAdmin = state.profile.role === "admin" && state.profile.status === "approved";

      if (!state.isAdmin && state.profile.status !== "approved") {
        await sb.auth.signOut();
        throw new Error(
          state.profile.status === "banned"
            ? "Your account has been banned."
            : "Your account is still awaiting administrator approval."
        );
      }

      state.team = await getTeamForUser(state.user.id);
      renderApp();
    } catch (error) {
      console.error(error);
      renderAuth();
      showToast(error.message || "Could not load your account.", "error");
    }
  }

  sb?.auth.onAuthStateChange(async (event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
      await hydrateSession();
    }
  });

  /* ---------------- Public auth ---------------- */

  function renderAuth() {
    const params = new URLSearchParams(window.location.search);
    const showRegister = params.get("register") === "1";

    app.innerHTML = `
      <div class="public-shell">
        <div class="auth-frame">

          <header class="auth-top">
            <div class="auth-top-actions left-actions">
              <button class="auth-action admin" id="adminAccessBtn">ADMIN ACCESS</button>
            </div>

            <div class="brand">
              <span>7TH</span><span class="b"> UNIVERSE</span><span class="r"> ESPORTS</span>
            </div>

            <div class="auth-top-actions right-actions">
              <div class="member-state">
                <span class="live-dot"></span>
                MEMBER ACCESS
              </div>
              <button class="auth-action register" id="registerAccessBtn">REGISTER NEW ACCOUNT</button>
            </div>
          </header>

          <div class="auth-layout">
            <section class="auth-copy">
              <div class="eyebrow">FREE FIRE ESPORTS PLATFORM</div>
              <h1>
                <span class="white">7TH</span>
                <span class="blue"> UNIVERSE</span>
                <span class="red"> ESPORTS</span>
              </h1>

              <h2>One platform for serious Free Fire competition.</h2>

              <p>
                A dedicated Free Fire esports workspace for approved teams and members.
                Organize Clash Squad practice, publish team or player recruitment requirements,
                and manage your esports activity from one controlled professional hub.
              </p>

              <div class="feature-grid">
                <div class="feature">
                  <b>CLASH SQUAD PRACTICE</b>
                  <span>Open practice challenges published for EVERYONE.</span>
                </div>
                <div class="feature">
                  <b>TEAM & PLAYER RECRUITMENT</b>
                  <span>Find roles, players and competitive opportunities.</span>
                </div>
                <div class="feature">
                  <b>CONTROLLED ACCESS</b>
                  <span>Members enter after administrator approval.</span>
                </div>
                <div class="feature">
                  <b>TEAM LIMIT</b>
                  <span>Maximum two website members per team.</span>
                </div>
              </div>

              <div class="security-strip">
                <b>MEMBER AREA:</b> Practice, recruitment, team posts and administration
                remain inside the authenticated platform.
              </div>
            </section>

            <section class="auth-panel">
              <div class="auth-card">
                ${showRegister ? registrationForm() : loginForm()}
              </div>
            </section>
          </div>
        </div>
      </div>
    `;

    document.getElementById("registerAccessBtn")?.addEventListener("click", () => {
      goRegister();
    });

    document.getElementById("adminAccessBtn")?.addEventListener("click", () => {
      goLogin("admin");
    });

    document.getElementById("inlineRegister")?.addEventListener("click", () => {
      goRegister();
    });

    document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
    document.getElementById("registerForm")?.addEventListener("submit", handleRegister);
    document.getElementById("backToLogin")?.addEventListener("click", () => goLogin());
  }

  function loginForm() {
    return `
      <div class="badge">AUTHORIZED MEMBERS</div>
      <h3>Member Login</h3>
      <p class="auth-sub">Sign in with your registered email or mobile number.</p>

      <form id="loginForm">
        <div class="field">
          <label>Email / Mobile Number</label>
          <input id="loginIdentifier" required autocomplete="username"
                 placeholder="you@email.com or 03XXXXXXXXX">
        </div>

        <div class="field">
          <label>Password</label>
          <input id="loginPassword" type="password" required autocomplete="current-password"
                 placeholder="Enter your password">
        </div>

        <button class="btn btn-primary" style="width:100%" type="submit">
          LOGIN TO 7TH UNIVERSE
        </button>

        <div class="auth-note">
          New member?
          <button class="link-btn" type="button" id="inlineRegister">Register New Account</button>
        </div>
      </form>
    `;
  }

  function registrationForm() {
    return `
      <div class="badge">MEMBER REGISTRATION</div>
      <h3>Create Member Account</h3>
      <p class="auth-sub">
        Register as Team Leader / IGL or Sub-Leader. Every team is limited to two website members.
      </p>

      <button id="backToLogin" type="button" class="btn btn-dark btn-small" style="margin-bottom:16px">
        ← BACK TO LOGIN
      </button>

      <form id="registerForm">
        <div class="form-grid">
          <div class="field">
            <label>Team Name *</label>
            <input id="regTeamName" maxlength="50" required placeholder="Your team name">
          </div>
          <div class="field">
            <label>Member Role *</label>
            <select id="regRole" required>
              <option value="leader">Team Leader / IGL</option>
              <option value="sub_leader">Sub-Leader</option>
            </select>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label>IGL / Member Name *</label>
            <input id="regName" maxlength="60" required placeholder="Name">
          </div>
          <div class="field">
            <label>Contact Number *</label>
            <input id="regPhone" maxlength="20" required placeholder="03XXXXXXXXX">
          </div>
        </div>

        <div class="field">
          <label>Email *</label>
          <input id="regEmail" type="email" maxlength="120" required placeholder="team@example.com">
        </div>

        <div class="form-grid">
          <div class="field">
            <label>Password *</label>
            <input id="regPassword" type="password" minlength="8" required placeholder="Minimum 8 characters">
          </div>
          <div class="field">
            <label>Confirm Password *</label>
            <input id="regPassword2" type="password" minlength="8" required placeholder="Repeat password">
          </div>
        </div>

        <div class="field">
          <label>Team Logo — Optional</label>
          <input id="regLogo" type="file" accept="image/png,image/jpeg,image/webp">
          <div class="hint">PNG / JPG / WEBP • Maximum ${MAX_LOGO_MB} MB</div>
        </div>

        <div class="security-strip" style="margin:0 0 14px">
          <b>2-MEMBER TEAM RULE:</b> One team can have a maximum of
          <b>2 website members</b> — normally Leader/IGL + Sub-Leader.
        </div>

        <button class="btn btn-primary" style="width:100%" type="submit">
          SUBMIT REGISTRATION
        </button>

        <div class="auth-note">
          Administrator approval is required before access is granted.
        </div>
      </form>
    `;
  }

  function goRegister() {
    const url = new URL(window.location.href);
    url.searchParams.set("register", "1");
    window.history.replaceState({}, "", url);
    renderAuth();
  }

  function goLogin(mode = "") {
    const url = new URL(window.location.href);
    url.searchParams.delete("register");
    window.history.replaceState({}, "", url);
    renderAuth();
    const input = document.getElementById("loginIdentifier");
    if (input && mode === "admin") {
      input.focus();
      showToast("Use your approved administrator email/mobile and password.");
    }
  }

  async function handleLogin(e) {
    e.preventDefault();

    try {
      ensureClient();

      const identifier = document.getElementById("loginIdentifier").value.trim();
      const password = document.getElementById("loginPassword").value;

      if (!identifier || !password) throw new Error("Enter your login details.");

      const credentials = identifier.includes("@")
        ? { email: identifier.toLowerCase(), password }
        : { phone: cleanPhone(identifier), password };

      const { data, error } = await sb.auth.signInWithPassword(credentials);
      if (error) throw error;

      state.user = data.user;

      let profile = await getProfile(data.user.id);

      // Finish a registration that was waiting for email confirmation.
      if (!profile) {
        const meta = data.user.user_metadata || {};
        if (meta.team_name && meta.display_name && meta.requested_role) {
          const { error: rpcError } = await sb.rpc("register_team_member", {
            p_user_id: data.user.id,
            p_team_name: meta.team_name,
            p_member_name: meta.display_name,
            p_phone: meta.phone || null,
            p_role: meta.requested_role,
            p_logo_url: meta.logo_url || null
          });
          if (rpcError) throw rpcError;
          profile = await getProfile(data.user.id);
        }
      }

      if (!profile) {
        await sb.auth.signOut();
        throw new Error("Your account profile has not been completed. Contact the administrator.");
      }

      if (profile.status !== "approved" && profile.role !== "admin") {
        await sb.auth.signOut();
        throw new Error(
          profile.status === "banned"
            ? "Your account is banned."
            : "Your registration is pending admin approval."
        );
      }

      state.profile = profile;
      state.isAdmin = profile.role === "admin" && profile.status === "approved";
      state.team = await getTeamForUser(data.user.id);
      state.page = "dashboard";

      renderApp();
      showToast("Login successful. Welcome to 7TH UNIVERSE ESPORTS.");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Login failed.", "error");
    }
  }

  async function handleRegister(e) {
    e.preventDefault();

    try {
      ensureClient();

      const teamName = document.getElementById("regTeamName").value.trim();
      const role = document.getElementById("regRole").value;
      const displayName = document.getElementById("regName").value.trim();
      const phone = cleanPhone(document.getElementById("regPhone").value);
      const email = document.getElementById("regEmail").value.trim().toLowerCase();
      const password = document.getElementById("regPassword").value;
      const password2 = document.getElementById("regPassword2").value;
      const logoFile = document.getElementById("regLogo").files?.[0] || null;

      if (!teamName || !displayName || !phone || !email) {
        throw new Error("Complete all required registration fields.");
      }
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");
      if (password !== password2) throw new Error("Passwords do not match.");
      if (!/^\+92\d{10}$/.test(phone)) throw new Error("Enter a valid Pakistan mobile number.");

      if (logoFile) {
        if (logoFile.size > MAX_LOGO_MB * 1024 * 1024) {
          throw new Error(`Team logo must be ${MAX_LOGO_MB} MB or smaller.`);
        }
        if (!/^image\/(png|jpeg|webp)$/.test(logoFile.type)) {
          throw new Error("Team logo must be PNG, JPG or WEBP.");
        }
      }

      // Client-side availability check for instant feedback. The server-side trigger
      // remains the source of truth for the two-member team rule.
      const { data: existingTeam, error: teamError } = await sb
        .from("teams")
        .select("id,name,status")
        .ilike("name", teamName)
        .limit(1)
        .maybeSingle();
      if (teamError) throw teamError;
      if (existingTeam?.status === "banned") throw new Error("This team is blocked from registration.");

      if (existingTeam) {
        const { count, error: countError } = await sb
          .from("team_members")
          .select("id", { count:"exact", head:true })
          .eq("team_id", existingTeam.id)
          .in("status", ["pending","approved"]);
        if (countError) throw countError;
        if ((count || 0) >= 2) throw new Error("This team already has the maximum 2 website members.");

        const { data: sameRole, error: roleError } = await sb
          .from("team_members")
          .select("id")
          .eq("team_id", existingTeam.id)
          .eq("role", role)
          .in("status", ["pending","approved"])
          .limit(1);
        if (roleError) throw roleError;
        if ((sameRole || []).length) {
          throw new Error(`This team already has a ${role === "leader" ? "Team Leader / IGL" : "Sub-Leader"}.`);
        }
      }

      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName,
            phone,
            team_name: teamName,
            requested_role: role,
            logo_url: null
          }
        }
      });

      if (error) throw error;
      if (!data.user) throw new Error("Supabase did not create the account.");

      // REGISTRATION_FIX.sql installs an auth.users trigger. That trigger creates
      // profiles + team_members immediately, including when email confirmation means
      // data.session is null. Therefore the admin queue is populated at signup time.
      if (data.session && logoFile) {
        const logoUrl = await uploadLogo(data.user.id, logoFile);
        const { error: logoError } = await sb.from("teams").update({ logo_url: logoUrl }).eq("name", teamName);
        if (logoError) console.warn("Team logo update failed:", logoError);
      }

      const url = new URL(window.location.href);
      url.searchParams.delete("register");
      window.history.replaceState({}, "", url);
      renderAuth();
      showToast(
        data.session
          ? "Registration submitted. Your application is waiting for admin approval."
          : "Registration received. Your application is already in the admin approval queue. Check your email if confirmation is requested.",
        "success"
      );
    } catch (error) {
      console.error(error);
      showToast(error.message || "Registration failed.", "error");
    }
  }

  async function uploadLogo(userId, file) {
    const ext = file.name.split(".").pop().toLowerCase();
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;

    const { error } = await sb.storage.from(LOGO_BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });

    if (error) throw error;

    return sb.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  /* ---------------- App shell ---------------- */

  function renderApp() {
    app.innerHTML = `
      <header class="topbar">
        <div class="container topbar-inner">
          <div class="brand">
            <span>7TH</span><span class="b"> UNIVERSE</span><span class="r"> ESPORTS</span>
          </div>

          <nav class="nav">
            <button class="nav-btn ${state.page === "dashboard" ? "active" : ""}" data-page="dashboard">DASHBOARD</button>
            <button class="nav-btn ${state.page === "practice" ? "active" : ""}" data-page="practice">PRACTICE</button>
            <button class="nav-btn ${state.page === "recruit" ? "active" : ""}" data-page="recruit">RECRUITMENT</button>
            <button class="nav-btn ${state.page === "my-posts" ? "active" : ""}" data-page="my-posts">MY POSTS</button>
            ${state.isAdmin ? `<button class="nav-btn ${state.page === "admin" ? "active" : ""}" data-page="admin">ADMIN</button>` : ""}
            <button class="nav-btn" id="logoutBtn">LOGOUT</button>
          </nav>

          <div class="profile-chip">
            ${logoHtml(state.team?.logo_url, state.team?.name || "7U")}
            <div class="profile-text">
              <small>${esc(formatRole(state.profile?.role))}</small>
              <b>${esc(state.team?.name || state.profile?.display_name || "Member")}</b>
            </div>
          </div>
        </div>
      </header>

      <main id="pageRoot" class="page">
        <div class="container"><div class="empty">Loading your esports dashboard...</div></div>
      </main>
    `;

    document.querySelectorAll("[data-page]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.page = btn.dataset.page;
        renderApp();
      });
    });

    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
      await sb.auth.signOut();
    });

    loadPage();
  }

  async function loadPage() {
    const root = document.getElementById("pageRoot");
    if (!root) return;

    try {
      if (state.page === "dashboard") root.innerHTML = await dashboardPage();
      else if (state.page === "practice") {
        root.innerHTML = await practicePage();
        bindPractice();
      }
      else if (state.page === "recruit") {
        root.innerHTML = recruitPage();
        bindRecruit();
      }
      else if (state.page === "my-posts") root.innerHTML = await myPostsPage();
      else if (state.page === "admin" && state.isAdmin) {
        root.innerHTML = await adminPage();
        bindAdmin();
      }
      else {
        state.page = "dashboard";
        renderApp();
      }

      bindCommonCards();
    } catch (error) {
      console.error(error);
      root.innerHTML = `
        <div class="container">
          <div class="empty">
            <div style="font-size:26px">!</div>
            <div style="margin-top:8px;color:#fff;font-weight:900">${esc(error.message || "Unable to load this section.")}</div>
          </div>
        </div>
      `;
    }
  }

  async function getOpenChallenges() {
    const { data, error } = await sb
      .from("practice_challenges")
      .select("*")
      .eq("status", "open")
      .order("match_time", { ascending: true })
      .limit(100);
    if (error) throw error;
    state.challenges = data || [];
    return state.challenges;
  }

  async function getOpenRecruitment() {
    const { data, error } = await sb
      .from("recruitment_posts")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    state.recruitment = data || [];
    return state.recruitment;
  }

  async function dashboardPage() {
    const [challenges, recruitment] = await Promise.all([
      getOpenChallenges(),
      getOpenRecruitment()
    ]);

    return `
      <div class="container">
        <section class="dashboard-hero">
          <div class="mini">7TH UNIVERSE ESPORTS • MEMBER HUB</div>
          <h2>${esc(state.team?.name || state.profile?.display_name || "WELCOME")}</h2>
          <p>
            Your Free Fire esports workspace. Publish open Clash Squad practice challenges,
            connect with players/teams through recruitment, and keep your activity organized.
          </p>

          <div class="hero-actions">
            <button class="btn btn-primary" data-go="practice">CREATE PRACTICE CHALLENGE</button>
            <button class="btn btn-dark" data-go="recruit">CREATE RECRUITMENT POST</button>
            ${state.isAdmin ? `<button class="btn btn-red" data-go="admin">OPEN ADMIN CENTER</button>` : ""}
          </div>
        </section>

        <section class="quick-grid">
          <button class="quick" data-go="practice">
            <div class="qicon">⚔</div>
            <b>Practice</b>
            <span>Open a Free Fire Clash Squad challenge for everyone.</span>
          </button>
          <button class="quick" data-go="recruit">
            <div class="qicon">◎</div>
            <b>Recruitment</b>
            <span>Find competitive players or announce team requirements.</span>
          </button>
          <button class="quick" data-go="my-posts">
            <div class="qicon">▣</div>
            <b>My Posts</b>
            <span>Review your active and previous website posts.</span>
          </button>
          <button class="quick" data-go="dashboard">
            <div class="qicon">7U</div>
            <b>Team Area</b>
            <span>One team, maximum two website members.</span>
          </button>
        </section>

        <section class="section">
          <div class="section-title">
            <h3>Open Practice Challenges</h3>
            <span>VISIBLE TO EVERYONE</span>
          </div>
          <div class="cards">
            ${challenges.slice(0,4).map(challengeCard).join("") ||
              `<div class="empty" style="grid-column:1/-1">No open practice challenges right now.</div>`}
          </div>
        </section>

        <section class="section">
          <div class="section-title">
            <h3>Active Recruitment</h3>
            <span>TEAMS + PLAYERS</span>
          </div>
          <div class="cards">
            ${recruitment.slice(0,4).map(recruitmentCard).join("") ||
              `<div class="empty" style="grid-column:1/-1">No active recruitment posts right now.</div>`}
          </div>
        </section>
      </div>
    `;
  }

  function challengeCard(c) {
    return `
      <article class="card">
        <div class="card-top">
          ${logoHtml(c.team_logo_url, c.team_name || "7U")}
          <div class="card-title">
            <h3>${esc(c.team_name)}</h3>
            <p>FREE FIRE • CLASH SQUAD • EVERYONE</p>
          </div>
        </div>

        <div class="badges">
          <span class="badge2 red">${esc(c.match_type)}</span>
          <span class="badge2 blue">${esc(c.format)}</span>
          <span class="badge2 green">OPEN</span>
          <span class="badge2 blue">EVERYONE</span>
        </div>

        <div class="info-grid">
          <div class="info"><small>Match Time</small><b>${esc(formatDate(c.match_time))}</b></div>
          <div class="info"><small>Contact</small><b>${esc(c.contact || "—")}</b></div>
        </div>

        ${c.notes ? `<p class="note-text">${esc(c.notes)}</p>` : ""}

        <div class="card-actions">
          <button class="btn btn-primary btn-small" data-wa="${esc(c.contact || "")}">CONTACT</button>
          <button class="btn btn-dark btn-small" data-details="${safeJson(c)}">VIEW DETAILS</button>
        </div>
      </article>
    `;
  }

  function recruitmentCard(r) {
    const roles = Array.isArray(r.looking_for) ? r.looking_for.join(" • ") : (r.looking_for || "—");

    return `
      <article class="card">
        <div class="card-top">
          ${logoHtml(r.team_logo_url, r.team_name || r.player_ign || "7U")}
          <div class="card-title">
            <h3>${esc(r.team_name || r.player_ign || "Player")}</h3>
            <p>FREE FIRE • ${esc(String(r.listing_type || "").replaceAll("_"," "))}</p>
          </div>
        </div>

        <div class="badges">
          <span class="badge2 blue">${esc(roles)}</span>
          ${r.players_needed ? `<span class="badge2">${esc(r.players_needed)} NEEDED</span>` : ""}
          <span class="badge2 green">OPEN</span>
        </div>

        <div class="info-grid">
          <div class="info"><small>Availability</small><b>${esc(r.availability || "—")}</b></div>
          <div class="info"><small>Age</small><b>${esc(r.age_requirement || "—")}</b></div>
          ${r.player_ign ? `<div class="info"><small>Player IGN</small><b>${esc(r.player_ign)}</b></div>` : ""}
          ${r.player_uid ? `<div class="info"><small>Free Fire UID</small><b>${esc(r.player_uid)}</b></div>` : ""}
        </div>

        ${r.notes ? `<p class="note-text">${esc(r.notes)}</p>` : ""}

        <div class="card-actions">
          <button class="btn btn-primary btn-small" data-wa="${esc(r.contact || "")}">CONTACT</button>
          <button class="btn btn-dark btn-small" data-details="${safeJson(r)}">VIEW DETAILS</button>
        </div>
      </article>
    `;
  }

  /* ---------------- Practice ---------------- */

  async function practicePage() {
    const challenges = await getOpenChallenges();

    return `
      <div class="container">
        <div class="page-heading">
          <h2>CLASH SQUAD PRACTICE</h2>
          <p>Publish one open challenge. The audience is <b>EVERYONE</b> — there is no specific opponent/team field.</p>
        </div>

        <div class="card">
          <div class="section-title" style="margin-bottom:18px">
            <h3>Create Practice Challenge</h3>
            <span>FREE FIRE • CLASH SQUAD</span>
          </div>

          <form id="practiceForm">
            <div class="form-grid">
              <div class="field">
                <label>Match Type *</label>
                <select id="practiceMatchType" required>
                  <option value="SINGLE">SINGLE MATCH</option>
                  <option value="BEST OF 3">BEST OF 3</option>
                </select>
              </div>

              <div class="field">
                <label>Format *</label>
                <select id="practiceFormat" required>
                  <option value="SQUAD">SQUAD</option>
                  <option value="TRIO">TRIO</option>
                  <option value="DUO">DUO</option>
                  <option value="SOLO">SOLO</option>
                </select>
              </div>
            </div>

            <div class="form-grid">
              <div class="field">
                <label>Match Time *</label>
                <input id="practiceTime" type="datetime-local" required>
              </div>

              <div class="field">
                <label>Contact / WhatsApp *</label>
                <input id="practiceContact" value="${esc(state.profile?.phone || "")}" maxlength="20" required placeholder="03XXXXXXXXX">
              </div>
            </div>

            <div class="field">
              <label>Additional Notes</label>
              <textarea id="practiceNotes" maxlength="500" placeholder="Example: Serious competitive teams only."></textarea>
            </div>

            <div class="security-strip" style="margin:0 0 14px">
              <b>CHALLENGE AUDIENCE:</b> EVERYONE
            </div>

            <button class="btn btn-primary" type="submit">POST OPEN CHALLENGE</button>
          </form>
        </div>

        <section class="section">
          <div class="section-title">
            <h3>Open Challenges</h3>
            <span>${challenges.length} LISTED</span>
          </div>
          <div class="cards">
            ${challenges.map(challengeCard).join("") ||
              `<div class="empty" style="grid-column:1/-1">No open challenges available.</div>`}
          </div>
        </section>
      </div>
    `;
  }

  function bindPractice() {
    document.getElementById("practiceForm")?.addEventListener("submit", submitPractice);
  }

  async function submitPractice(e) {
    e.preventDefault();

    try {
      ensureClient();
      if (!state.team) throw new Error("Approved team membership is required.");

      const localTime = document.getElementById("practiceTime").value;
      const matchTime = new Date(localTime);
      if (Number.isNaN(matchTime.getTime())) throw new Error("Choose a valid match time.");

      const contact = cleanPhone(document.getElementById("practiceContact").value);
      if (!/^\+92\d{10}$/.test(contact)) throw new Error("Enter a valid Pakistan contact number.");

      const { data, error } = await sb.rpc("create_practice_challenge", {
        p_team_id: state.team.id,
        p_team_name: state.team.name,
        p_team_logo_url: state.team.logo_url || null,
        p_match_type: document.getElementById("practiceMatchType").value,
        p_match_time: matchTime.toISOString(),
        p_format: document.getElementById("practiceFormat").value,
        p_contact: contact,
        p_notes: document.getElementById("practiceNotes").value.trim() || null
      });

      if (error) throw error;

      await notifyWhatsApp({ type:"practice_challenge", record_id:data });
      showToast("Practice challenge posted for EVERYONE.");
      e.target.reset();
      await loadPage();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not post the challenge.", "error");
    }
  }

  /* ---------------- Recruitment ---------------- */

  function recruitPage() {
    return `
      <div class="container">
        <div class="page-heading">
          <h2>FREE FIRE RECRUITMENT</h2>
          <p>Create a requirement for your team or publish your own player profile.</p>
        </div>

        <div class="card">
          <div class="section-title" style="margin-bottom:18px">
            <h3>Create Recruitment Post</h3>
            <span>TEAM + PLAYER</span>
          </div>

          <form id="recruitForm">
            <div class="field">
              <label>Listing Type *</label>
              <select id="recruitType" required>
                <option value="TEAM_RECRUITMENT">TEAM RECRUITMENT — We need players</option>
                <option value="PLAYER_RECRUITMENT">PLAYER RECRUITMENT — I need a team</option>
              </select>
            </div>

            <div id="teamModeFields">
              <div class="form-grid">
                <div class="field">
                  <label>Team Name</label>
                  <input value="${esc(state.team?.name || "")}" disabled>
                </div>
                <div class="field">
                  <label>Players Needed</label>
                  <select id="recruitPlayersNeeded">
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                  </select>
                </div>
              </div>

              <div class="field">
                <label>Looking For *</label>
                <select id="recruitLookingFor" multiple size="5" required>
                  <option value="Rusher">Rusher</option>
                  <option value="Sniper">Sniper</option>
                  <option value="Support">Support</option>
                  <option value="Entry Fragger">Entry Fragger</option>
                  <option value="All-Rounder">All-Rounder</option>
                </select>
                <div class="hint">Select one or more roles. On mobile, use your browser's multi-select control.</div>
              </div>
            </div>

            <div id="playerModeFields" class="hidden">
              <div class="form-grid">
                <div class="field">
                  <label>Player IGN *</label>
                  <input id="playerIgn" maxlength="40" placeholder="Free Fire in-game name">
                </div>
                <div class="field">
                  <label>Free Fire UID *</label>
                  <input id="playerUid" maxlength="20" placeholder="Your UID">
                </div>
              </div>

              <div class="field">
                <label>Preferred Role *</label>
                <select id="playerRole">
                  <option value="Rusher">Rusher</option>
                  <option value="Sniper">Sniper</option>
                  <option value="Support">Support</option>
                  <option value="Entry Fragger">Entry Fragger</option>
                  <option value="All-Rounder">All-Rounder</option>
                </select>
              </div>
            </div>

            <div class="form-grid">
              <div class="field">
                <label>Availability *</label>
                <input id="recruitAvailability" required placeholder="Example: 5 PM – 11 PM">
              </div>
              <div class="field">
                <label>Age / Age Requirement *</label>
                <input id="recruitAge" required placeholder="Example: 16+">
              </div>
            </div>

            <div class="form-grid">
              <div class="field">
                <label>Contact / WhatsApp *</label>
                <input id="recruitContact" required value="${esc(state.profile?.phone || "")}" placeholder="03XXXXXXXXX">
              </div>
              <div class="field">
                <label>Experience (Optional)</label>
                <input id="recruitExperience" maxlength="160" placeholder="Example: 2 years competitive CS">
              </div>
            </div>

            <div class="field">
              <label>Extra Details</label>
              <textarea id="recruitNotes" maxlength="600" placeholder="Requirements, trial details, preferred timings, etc."></textarea>
            </div>

            <button class="btn btn-primary" type="submit">PUBLISH RECRUITMENT</button>
          </form>
        </div>
      </div>
    `;
  }

  function bindRecruit() {
    const type = document.getElementById("recruitType");
    type?.addEventListener("change", toggleRecruitMode);
    document.getElementById("recruitForm")?.addEventListener("submit", submitRecruitment);
    toggleRecruitMode();
  }

  function toggleRecruitMode() {
    const type = document.getElementById("recruitType")?.value;
    const teamMode = type === "TEAM_RECRUITMENT";

    document.getElementById("teamModeFields")?.classList.toggle("hidden", !teamMode);
    document.getElementById("playerModeFields")?.classList.toggle("hidden", teamMode);

    const playerIgn = document.getElementById("playerIgn");
    const playerUid = document.getElementById("playerUid");

    if (playerIgn) playerIgn.required = !teamMode;
    if (playerUid) playerUid.required = !teamMode;
  }

  async function submitRecruitment(e) {
    e.preventDefault();

    try {
      ensureClient();

      const type = document.getElementById("recruitType").value;
      const contact = cleanPhone(document.getElementById("recruitContact").value);
      if (!/^\+92\d{10}$/.test(contact)) throw new Error("Enter a valid Pakistan contact number.");

      let lookingFor = [];
      let playerIgn = null;
      let playerUid = null;

      if (type === "TEAM_RECRUITMENT") {
        if (!state.team) throw new Error("Approved team membership is required.");
        lookingFor = [...document.getElementById("recruitLookingFor").selectedOptions].map(o => o.value);
        if (!lookingFor.length) throw new Error("Select at least one required role.");
      } else {
        playerIgn = document.getElementById("playerIgn").value.trim();
        playerUid = document.getElementById("playerUid").value.trim();
        lookingFor = [document.getElementById("playerRole").value];
        if (!playerIgn || !playerUid) throw new Error("Player IGN and UID are required.");
      }

      const { data, error } = await sb.rpc("create_recruitment_post", {
        p_team_id: state.team?.id || null,
        p_team_name: state.team?.name || playerIgn,
        p_team_logo_url: state.team?.logo_url || null,
        p_listing_type: type,
        p_looking_for: lookingFor,
        p_players_needed: type === "TEAM_RECRUITMENT"
          ? Number(document.getElementById("recruitPlayersNeeded").value)
          : 1,
        p_availability: document.getElementById("recruitAvailability").value.trim(),
        p_age_requirement: document.getElementById("recruitAge").value.trim(),
        p_contact: contact,
        p_experience: document.getElementById("recruitExperience").value.trim() || null,
        p_player_ign: playerIgn,
        p_player_uid: playerUid,
        p_notes: document.getElementById("recruitNotes").value.trim() || null
      });

      if (error) throw error;

      await notifyWhatsApp({ type:"recruitment", record_id:data });
      showToast("Recruitment post published.");
      e.target.reset();
      await loadPage();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not publish recruitment.", "error");
    }
  }

  /* ---------------- My posts ---------------- */

  async function myPostsPage() {
    if (!state.team) {
      return `
        <div class="container">
          <div class="empty">
            <b>No approved team membership is attached to this account.</b>
          </div>
        </div>
      `;
    }

    const [ch, rec] = await Promise.all([
      sb.from("practice_challenges").select("*").eq("team_id", state.team.id).order("created_at",{ascending:false}),
      sb.from("recruitment_posts").select("*").eq("team_id", state.team.id).order("created_at",{ascending:false})
    ]);

    if (ch.error) throw ch.error;
    if (rec.error) throw rec.error;

    return `
      <div class="container">
        <div class="page-heading">
          <h2>MY POSTS</h2>
          <p>${esc(state.team.name)} • Practice and recruitment activity.</p>
        </div>

        <section class="section">
          <div class="section-title"><h3>Practice Challenges</h3><span>${(ch.data||[]).length} POSTS</span></div>
          <div class="cards">
            ${(ch.data||[]).map(challengeCard).join("") ||
              `<div class="empty" style="grid-column:1/-1">No practice posts yet.</div>`}
          </div>
        </section>

        <section class="section">
          <div class="section-title"><h3>Recruitment</h3><span>${(rec.data||[]).length} POSTS</span></div>
          <div class="cards">
            ${(rec.data||[]).map(recruitmentCard).join("") ||
              `<div class="empty" style="grid-column:1/-1">No recruitment posts yet.</div>`}
          </div>
        </section>
      </div>
    `;
  }

  /* ---------------- Admin ---------------- */

  async function adminPage() {
    const [profiles, teams, challenges, recruitment] = await Promise.all([
      sb.from("profiles").select("*").neq("role","admin").order("created_at",{ascending:false}).limit(250),
      sb.from("teams").select("*").order("created_at",{ascending:false}).limit(250),
      sb.from("practice_challenges").select("*").order("created_at",{ascending:false}).limit(250),
      sb.from("recruitment_posts").select("*").order("created_at",{ascending:false}).limit(250)
    ]);

    if (profiles.error) throw profiles.error;
    if (teams.error) throw teams.error;
    if (challenges.error) throw challenges.error;
    if (recruitment.error) throw recruitment.error;

    state.registrations = profiles.data || [];
    state.teams = teams.data || [];
    state.challenges = challenges.data || [];
    state.recruitment = recruitment.data || [];

    const pending = state.registrations.filter(x => x.status === "pending").length;
    const banned = state.registrations.filter(x => x.status === "banned").length;

    return `
      <div class="container">
        <div class="page-heading">
          <h2>ADMIN CONTROL CENTER</h2>
          <p>Moderate members, teams, practice challenges and recruitment activity from one command center.</p>
        </div>

        <div class="quick-grid">
          <div class="quick"><div class="qicon">${pending}</div><b>Pending</b><span>Registrations waiting for approval.</span></div>
          <div class="quick"><div class="qicon">${state.teams.length}</div><b>Teams</b><span>Registered esports teams.</span></div>
          <div class="quick"><div class="qicon">${state.challenges.length}</div><b>Practice</b><span>Total practice challenge records.</span></div>
          <div class="quick"><div class="qicon">${banned}</div><b>Banned</b><span>Member accounts currently blocked.</span></div>
        </div>

        <div class="admin-layout" style="margin-top:18px">
          <aside class="admin-nav">
            <button class="${state.adminTab==="registrations"?"active":""}" data-admin-tab="registrations">REGISTRATIONS</button>
            <button class="${state.adminTab==="teams"?"active":""}" data-admin-tab="teams">TEAMS</button>
            <button class="${state.adminTab==="practice"?"active":""}" data-admin-tab="practice">PRACTICE</button>
            <button class="${state.adminTab==="recruitment"?"active":""}" data-admin-tab="recruitment">RECRUITMENT</button>
          </aside>

          <section>
            ${adminTabContent()}
          </section>
        </div>
      </div>
    `;
  }

  function adminTabContent() {
    if (state.adminTab === "teams") return `
      <div class="card">
        <div class="section-title"><h3>Teams</h3><span>${state.teams.length} TOTAL</span></div>
        <div class="table-shell">
          <table>
            <thead><tr><th>Team</th><th>Status</th><th>Created</th><th>Control</th></tr></thead>
            <tbody>
              ${state.teams.map(t => `
                <tr>
                  <td><div style="display:flex;align-items:center;gap:9px">${t.logo_url ? `<img src="${esc(t.logo_url)}" style="width:34px;height:34px;border-radius:9px;border:1px solid #214460;object-fit:cover">` : `<div style="width:34px;height:34px;border-radius:9px;background:#091321;display:grid;place-items:center;color:#74baff;font-weight:900">7U</div>`}<strong>${esc(t.name)}</strong></div></td>
                  <td><span class="badge2 ${t.status==="active"?"green":"red"}">${esc(t.status)}</span></td>
                  <td>${esc(formatDate(t.created_at))}</td>
                  <td><button class="btn btn-dark btn-small" data-team-status="${esc(t.id)}" data-next="${t.status==="banned"?"active":"banned"}">${t.status==="banned"?"UNBAN":"BAN"}</button></td>
                </tr>
              `).join("") || `<tr><td colspan="4">No teams found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;

    if (state.adminTab === "practice") return `
      <div class="card">
        <div class="section-title"><h3>Practice Challenges</h3><span>${state.challenges.length} TOTAL</span></div>
        <div class="table-shell">
          <table>
            <thead><tr><th>Team</th><th>Type</th><th>Format</th><th>Time</th><th>Status</th><th>Control</th></tr></thead>
            <tbody>
              ${state.challenges.map(c => `
                <tr>
                  <td>${esc(c.team_name)}</td>
                  <td>${esc(c.match_type)}</td>
                  <td>${esc(c.format)}</td>
                  <td>${esc(formatDate(c.match_time))}</td>
                  <td><span class="badge2 ${c.status==="open"?"green":"red"}">${esc(c.status)}</span></td>
                  <td><button class="btn btn-dark btn-small" data-challenge-status="${esc(c.id)}" data-next="${c.status==="open"?"closed":"open"}">${c.status==="open"?"CLOSE":"REOPEN"}</button></td>
                </tr>
              `).join("") || `<tr><td colspan="6">No challenges found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;

    if (state.adminTab === "recruitment") return `
      <div class="card">
        <div class="section-title"><h3>Recruitment Posts</h3><span>${state.recruitment.length} TOTAL</span></div>
        <div class="table-shell">
          <table>
            <thead><tr><th>Listing</th><th>Type</th><th>Looking For</th><th>Availability</th><th>Status</th><th>Control</th></tr></thead>
            <tbody>
              ${state.recruitment.map(r => `
                <tr>
                  <td>${esc(r.team_name || r.player_ign || "—")}</td>
                  <td>${esc(r.listing_type)}</td>
                  <td>${esc(Array.isArray(r.looking_for) ? r.looking_for.join(", ") : r.looking_for || "—")}</td>
                  <td>${esc(r.availability || "—")}</td>
                  <td><span class="badge2 ${r.status==="open"?"green":"red"}">${esc(r.status)}</span></td>
                  <td><button class="btn btn-dark btn-small" data-recruit-status="${esc(r.id)}" data-next="${r.status==="open"?"closed":"open"}">${r.status==="open"?"CLOSE":"REOPEN"}</button></td>
                </tr>
              `).join("") || `<tr><td colspan="6">No recruitment posts found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const pendingCount = state.registrations.filter(p => p.status === "pending").length;

    return `
      ${pendingCount ? `
        <div class="admin-highlight">
          <div class="section-kicker">REGISTRATION REVIEW QUEUE</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px">
            <div><b style="font-size:17px">${pendingCount} Pending Application${pendingCount === 1 ? "" : "s"}</b><div style="font-size:10px;color:#7890a7;margin-top:4px">Approve or reject Team Leader / IGL and Sub-Leader requests.</div></div>
            <span class="status-pill"><span class="tiny-dot"></span>PENDING</span>
          </div>
        </div>` : `
        <div class="admin-highlight">
          <div class="section-kicker">REGISTRATION REVIEW QUEUE</div>
          <div style="margin-top:8px;color:#7990a7;font-size:11px">No pending registration applications.</div>
        </div>`}

      <div class="card">
        <div class="section-title"><h3>Member Registrations</h3><span>${state.registrations.length} ACCOUNTS</span></div>
        <div class="table-shell">
          <table>
            <thead><tr><th>Member</th><th>Team</th><th>Role</th><th>Contact</th><th>Status</th><th>Control</th></tr></thead>
            <tbody>
              ${state.registrations.map(p => `
                <tr>
                  <td><strong>${esc(p.display_name)}</strong></td>
                  <td>${esc(p.team_name || "—")}</td>
                  <td>${esc(formatRole(p.role))}</td>
                  <td>${esc(p.phone || "—")}</td>
                  <td><span class="badge2 ${p.status==="approved"?"green":p.status==="banned"?"red":"blue"}">${esc(p.status)}</span></td>
                  <td>
                    <div class="card-actions" style="margin:0">
                      ${p.status === "pending"
                        ? `<button class="btn btn-green btn-small" data-profile-status="${esc(p.id)}" data-next="approved">APPROVE</button>
                           <button class="btn btn-danger btn-small" data-profile-status="${esc(p.id)}" data-next="rejected">REJECT</button>`
                        : `<button class="btn btn-dark btn-small" data-profile-status="${esc(p.id)}" data-next="${p.status==="banned"?"approved":"banned"}">${p.status==="banned"?"UNBAN":"BAN"}</button>`}
                    </div>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="6">No registrations found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function bindAdmin() {
    document.querySelectorAll("[data-admin-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.adminTab = btn.dataset.adminTab;
        loadPage().then(() => bindAdmin());
      });
    });

    document.querySelectorAll("[data-profile-status]").forEach(btn => {
      btn.addEventListener("click", () => updateProfileStatus(btn.dataset.profileStatus, btn.dataset.next));
    });

    document.querySelectorAll("[data-team-status]").forEach(btn => {
      btn.addEventListener("click", () => updateTeamStatus(btn.dataset.teamStatus, btn.dataset.next));
    });

    document.querySelectorAll("[data-challenge-status]").forEach(btn => {
      btn.addEventListener("click", () => updatePostStatus("practice_challenges", btn.dataset.challengeStatus, btn.dataset.next));
    });

    document.querySelectorAll("[data-recruit-status]").forEach(btn => {
      btn.addEventListener("click", () => updatePostStatus("recruitment_posts", btn.dataset.recruitStatus, btn.dataset.next));
    });
  }

  async function updateProfileStatus(id, status) {
    try {
      const { error: profileError } = await sb
        .from("profiles")
        .update({ status })
        .eq("id", id);

      if (profileError) throw profileError;

      let memberStatus = null;
      if (status === "approved") memberStatus = "approved";
      if (status === "rejected") memberStatus = "rejected";
      if (status === "banned") memberStatus = "banned";

      if (memberStatus) {
        const { error: memberError } = await sb
          .from("team_members")
          .update({ status: memberStatus })
          .eq("user_id", id);

        if (memberError) throw memberError;
      }

      showToast(`Member status changed to ${status}.`);
      await loadPage();
      bindAdmin();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not update member.", "error");
    }
  }

  async function updateTeamStatus(id, status) {
    try {
      const { error } = await sb.from("teams").update({ status }).eq("id", id);
      if (error) throw error;
      showToast(`Team status changed to ${status}.`);
      await loadPage();
      bindAdmin();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not update team.", "error");
    }
  }

  async function updatePostStatus(table, id, status) {
    try {
      const { error } = await sb.from(table).update({ status }).eq("id", id);
      if (error) throw error;
      showToast(`Post status changed to ${status}.`);
      await loadPage();
      bindAdmin();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not update post.", "error");
    }
  }

  /* ---------------- Shared bindings ---------------- */

  function bindCommonCards() {
    document.querySelectorAll("[data-go]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.page = btn.dataset.go;
        renderApp();
      });
    });

    document.querySelectorAll("[data-wa]").forEach(btn => {
      btn.addEventListener("click", () => {
        const phone = cleanPhone(btn.dataset.wa);
        if (!phone) return showToast("No contact number is available.", "error");
        window.open(`https://wa.me/${phone.replace("+","")}`, "_blank", "noopener");
      });
    });

    document.querySelectorAll("[data-details]").forEach(btn => {
      btn.addEventListener("click", () => {
        const data = JSON.parse(btn.dataset.details);
        const html = Object.entries(data)
          .filter(([k,v]) => !["id","team_id","team_logo_url","created_by"].includes(k) && v !== null && v !== "")
          .map(([k,v]) => `
            <div class="info" style="margin-bottom:8px">
              <small>${esc(k.replaceAll("_"," "))}</small>
              <b>${esc(Array.isArray(v) ? v.join(" • ") : String(v))}</b>
            </div>
          `).join("");
        openModal("Post Details", html || `<div class="muted">No additional details.</div>`);
      });
    });
  }

  async function notifyWhatsApp(payload) {
    try {
      const { error } = await sb.functions.invoke(WHATSAPP_FUNCTION, { body: payload });
      if (error) {
        console.warn("WhatsApp notification failed:", error);
        showToast("Post saved. WhatsApp automation is not connected yet.", "error");
      }
    } catch (error) {
      console.warn(error);
      showToast("Post saved. WhatsApp automation is not connected yet.", "error");
    }
  }

  /* ---------------- Startup ---------------- */

  (async () => {
    try {
      ensureClient();
      await hydrateSession();
    } catch (error) {
      console.error(error);
      renderAuth();
      showToast(error.message || "Supabase connection failed.", "error");
    }
  })();

})();
