/*
  7TH UNIVERSE ESPORTS — FREE FIRE
  Frontend: Supabase JS v2

  IMPORTANT:
  1) Replace SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY below.
  2) This frontend expects the database objects from setup.sql.
  3) Do NOT put Supabase secret/service_role keys here.
  4) WhatsApp automation is called through a Supabase Edge Function named:
       post-whatsapp
     Keep Meta/WhatsApp secrets ONLY inside the Edge Function.
*/

(() => {
  "use strict";

  const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
  const SUPABASE_PUBLISHABLE_KEY = "YOUR_SUPABASE_PUBLISHABLE_KEY";

  const LOGO_BUCKET = "team-logos";
  const WHATSAPP_FUNCTION = "post-whatsapp";
  const MAX_LOGO_MB = 3;

  const app = document.getElementById("app");
  const toast = document.getElementById("toast");
  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const modalClose = document.getElementById("modalClose");

  const supabaseReady =
    SUPABASE_URL.startsWith("http") &&
    SUPABASE_PUBLISHABLE_KEY &&
    !SUPABASE_URL.includes("YOUR_") &&
    !SUPABASE_PUBLISHABLE_KEY.includes("YOUR_");

  let supabase = null;
  let currentUser = null;
  let currentProfile = null;
  let currentTeam = null;
  let isAdmin = false;
  let currentPage = "home";
  let adminSection = "registrations";
  let loginMode = "login";

  const state = {
    challenges: [],
    recruitment: [],
    registrations: [],
    teams: [],
    users: [],
    stats: {}
  };

  if (supabaseReady && window.supabase?.createClient) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  const esc = (value) => {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[ch]));
  };

  const fmtDate = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return esc(value);
    return d.toLocaleString("en-PK", {
      dateStyle: "medium",
      timeStyle: "short"
    });
  };

  const cleanPhone = (value) => {
    let v = String(value || "").trim().replace(/[^\d+]/g, "");
    if (v.startsWith("00")) v = "+" + v.slice(2);
    if (v.startsWith("03")) return "+92" + v.slice(1);
    if (v.startsWith("92")) return "+" + v;
    if (v.startsWith("+92")) return v;
    return v;
  };

  const showToast = (message, type = "success") => {
    toast.textContent = message;
    toast.className = "";
    toast.classList.add("show", type);
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.className = "";
    }, 4200);
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

  const loading = (message = "Loading...") => `
    <div class="empty"><div style="font-size:24px">⏳</div><div style="margin-top:8px">${esc(message)}</div></div>
  `;

  const appError = (message) => `
    <div class="empty">
      <div style="font-size:28px">⚠</div>
      <div style="margin-top:8px;color:#ddd;font-weight:900">${esc(message)}</div>
      <div class="status-line">Check your Supabase configuration and database setup.</div>
    </div>
  `;

  async function ensureClient() {
    if (!supabaseReady) {
      throw new Error("Please add your Supabase URL and publishable key in script.js.");
    }
    if (!supabase) throw new Error("Supabase client failed to initialize.");
  }

  async function getProfile(userId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function getTeamForUser(userId) {
    const { data, error } = await supabase
      .from("team_members")
      .select(`
        id,
        team_id,
        role,
        status,
        teams (
          id,
          name,
          logo_url,
          status,
          created_at
        )
      `)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    return data?.teams || null;
  }

  async function refreshSession() {
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    currentUser = session?.user || null;

    if (!currentUser) {
      currentProfile = null;
      currentTeam = null;
      isAdmin = false;
      currentPage = "home";
      render();
      return;
    }

    try {
      currentProfile = await getProfile(currentUser.id);
      currentTeam = await getTeamForUser(currentUser.id);
      isAdmin = currentProfile?.role === "admin";

      if (currentProfile?.status !== "approved" && !isAdmin) {
        await supabase.auth.signOut();
        currentUser = null;
        currentProfile = null;
        currentTeam = null;
        isAdmin = false;
        render();
        showToast("Your account is pending admin approval.", "error");
        return;
      }

      render();
    } catch (error) {
      console.error(error);
      await supabase.auth.signOut();
      showToast("Account profile could not be loaded.", "error");
      render();
    }
  }

  supabase?.auth.onAuthStateChange(async (event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
      await refreshSession();
    }
  });

  function render() {
    if (!currentUser) {
      renderAuthShell();
    } else {
      renderAppShell();
    }
  }

  function renderAuthShell() {
    app.innerHTML = `
      <div class="landing-shell">
        <div class="landing">
          <button class="admin-mini-btn" id="adminBtn">ADMIN</button>
          <div class="landing-top">
            <div class="brand-mini"><span>7TH UNIVERSE</span> ESPORTS</div>
            <div class="actions">
              <button class="btn btn-dark btn-small" id="landingPractice">PRACTICE CHALLENGES</button>
              <button class="btn btn-dark btn-small" id="landingRecruitment">RECRUITMENT</button>
              <button class="btn btn-primary btn-small" id="registerBtnTop">REGISTER NEW ACCOUNT</button>
            </div>
          </div>

          <div class="landing-body">
            <section class="hero">
              <div class="eyebrow">FREE FIRE ESPORTS PLATFORM</div>
              <h1>7TH <strong>UNIVERSE</strong></h1>
              <h2>ESPORTS PRACTICE • RECRUITMENT</h2>
              <p>
                Find Clash Squad practice challenges, post your team's recruitment requirements,
                and connect with competitive Free Fire players and teams through one organized platform.
              </p>
              <div class="hero-tags">
                <span class="tag">CLASH SQUAD</span>
                <span class="tag">PRACTICE MATCHES</span>
                <span class="tag">TEAM RECRUITMENT</span>
                <span class="tag">PLAYER RECRUITMENT</span>
                <span class="tag">7TH UNIVERSE COMMUNITY</span>
              </div>
              <div class="danger-note">
                Every team may have a maximum of <b>2 registered website members</b>
                (Leader/IGL + Sub-Leader). Final approval is controlled by the admin.
              </div>
            </section>

            <section class="auth-card">
              <div class="auth-box">
                <div class="auth-tabs">
                  <button class="tab ${loginMode === "login" ? "active" : ""}" data-auth-tab="login">LOGIN</button>
                  <button class="tab ${loginMode === "register" ? "active" : ""}" data-auth-tab="register">REGISTER</button>
                </div>
                ${loginMode === "login" ? loginForm() : registerForm()}
              </div>
            </section>
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll("[data-auth-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        loginMode = btn.dataset.authTab;
        render();
      });
    });

    document.getElementById("registerBtnTop")?.addEventListener("click", () => {
      loginMode = "register";
      render();
    });

    document.getElementById("adminBtn")?.addEventListener("click", () => {
      loginMode = "login";
      render();
      document.querySelector("#loginIdentifier")?.focus();
    });

    document.getElementById("landingPractice")?.addEventListener("click", async () => {
      await openPublicList("practice");
    });

    document.getElementById("landingRecruitment")?.addEventListener("click", async () => {
      await openPublicList("recruit");
    });

    document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
    document.getElementById("registerForm")?.addEventListener("submit", handleRegister);
  }

  function loginForm() {
    return `
      <h3>Welcome Back</h3>
      <p class="sub">Login with your email or mobile number.</p>
      <form id="loginForm">
        <div class="field">
          <label>Email / Mobile Number</label>
          <input id="loginIdentifier" required placeholder="you@email.com or 03XXXXXXXXX" autocomplete="username" />
        </div>
        <div class="field">
          <label>Password</label>
          <input id="loginPassword" type="password" required placeholder="Your password" autocomplete="current-password" />
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%">LOGIN</button>
        <div class="status-line">New member? Use <b>REGISTER</b> above.</div>
      </form>
    `;
  }

  function registerForm() {
    return `
      <h3>Register New Account</h3>
      <p class="sub">Create a Team Leader / IGL or Sub-Leader account.</p>
      <form id="registerForm">
        <div class="grid-2">
          <div class="field">
            <label>Team Name *</label>
            <input id="regTeamName" required maxlength="50" placeholder="Your esports team name" />
          </div>
          <div class="field">
            <label>Member Role *</label>
            <select id="regRole" required>
              <option value="leader">Team Leader / IGL</option>
              <option value="sub_leader">Sub-Leader</option>
            </select>
          </div>
        </div>

        <div class="grid-2">
          <div class="field">
            <label>IGL / Member Name *</label>
            <input id="regName" required maxlength="60" placeholder="Full name or preferred name" />
          </div>
          <div class="field">
            <label>Contact Number *</label>
            <input id="regPhone" required maxlength="20" placeholder="03XXXXXXXXX" />
          </div>
        </div>

        <div class="field">
          <label>Email *</label>
          <input id="regEmail" type="email" required maxlength="120" placeholder="team@example.com" />
        </div>

        <div class="grid-2">
          <div class="field">
            <label>Password *</label>
            <input id="regPassword" type="password" required minlength="8" placeholder="Minimum 8 characters" />
          </div>
          <div class="field">
            <label>Confirm Password *</label>
            <input id="regPassword2" type="password" required minlength="8" placeholder="Repeat password" />
          </div>
        </div>

        <div class="field">
          <label>Team Logo (Optional)</label>
          <input id="regLogo" type="file" accept="image/png,image/jpeg,image/webp" />
          <div class="hint">PNG/JPG/WEBP • Maximum ${MAX_LOGO_MB} MB</div>
        </div>

        <div class="danger-note" style="margin-bottom:14px">
          <b>Maximum 2 website registrations per team.</b><br>
          Recommended: 1 Team Leader/IGL + 1 Sub-Leader.
        </div>

        <button class="btn btn-primary" type="submit" style="width:100%">SUBMIT REGISTRATION</button>
      </form>
    `;
  }

  async function handleLogin(e) {
    e.preventDefault();
    try {
      await ensureClient();

      const identifier = document.getElementById("loginIdentifier").value.trim();
      const password = document.getElementById("loginPassword").value;

      if (!identifier || !password) throw new Error("Enter your login details.");

      let credentials;
      if (identifier.includes("@")) {
        credentials = { email: identifier.toLowerCase(), password };
      } else {
        credentials = { phone: cleanPhone(identifier), password };
      }

      const { data, error } = await supabase.auth.signInWithPassword(credentials);
      if (error) throw error;

      const profile = await getProfile(data.user.id);
      if (!profile) {
        await supabase.auth.signOut();
        throw new Error("Profile not found. Contact the admin.");
      }

      if (profile.status !== "approved" && profile.role !== "admin") {
        await supabase.auth.signOut();
        throw new Error("Your registration is still pending admin approval.");
      }

      currentUser = data.user;
      currentProfile = profile;
      currentTeam = await getTeamForUser(data.user.id);
      isAdmin = profile.role === "admin";
      currentPage = "home";
      render();

      showToast("Login successful.");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Login failed.", "error");
    }
  }

  async function handleRegister(e) {
    e.preventDefault();

    try {
      await ensureClient();

      const teamName = document.getElementById("regTeamName").value.trim();
      const role = document.getElementById("regRole").value;
      const memberName = document.getElementById("regName").value.trim();
      const phone = cleanPhone(document.getElementById("regPhone").value.trim());
      const email = document.getElementById("regEmail").value.trim().toLowerCase();
      const password = document.getElementById("regPassword").value;
      const password2 = document.getElementById("regPassword2").value;
      const logoFile = document.getElementById("regLogo").files?.[0] || null;

      if (!teamName || !memberName || !phone || !email) throw new Error("Please complete all required fields.");
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");
      if (password !== password2) throw new Error("Passwords do not match.");
      if (!/^\+92\d{10}$/.test(phone)) {
        throw new Error("Use a valid Pakistan mobile number, e.g. 03XXXXXXXXX.");
      }

      if (logoFile) {
        if (logoFile.size > MAX_LOGO_MB * 1024 * 1024) {
          throw new Error(`Logo must be ${MAX_LOGO_MB} MB or smaller.`);
        }
        if (!/^image\/(png|jpeg|webp)$/.test(logoFile.type)) {
          throw new Error("Logo must be PNG, JPG or WEBP.");
        }
      }

      // Fast client-side precheck; final 2-member limit is enforced by setup.sql RPC.
      const existing = await supabase
        .from("teams")
        .select("id,name,status")
        .ilike("name", teamName)
        .limit(1)
        .maybeSingle();

      if (existing.error) throw existing.error;

      if (existing.data?.status === "banned") {
        throw new Error("This team is blocked from registration.");
      }

      if (existing.data) {
        const countRes = await supabase
          .from("team_members")
          .select("id", { count: "exact", head: true })
          .eq("team_id", existing.data.id)
          .in("status", ["pending", "approved"]);

        if (countRes.error) throw countRes.error;
        if ((countRes.count || 0) >= 2) {
          throw new Error("This team already has the maximum 2 website members.");
        }
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: memberName,
            phone,
            team_name: teamName,
            requested_role: role
          }
        }
      });

      if (error) throw error;
      if (!data.user) throw new Error("Registration did not create a user.");

      // On hosted Supabase, email confirmation may be required.
      // Profile/member rows are completed by the RPC after the session exists.
      if (!data.session) {
        showToast("Account created. Check your email to confirm the account, then contact/admin approval will follow.", "success");
        loginMode = "login";
        render();
        return;
      }

      let logoUrl = null;
      if (logoFile) {
        logoUrl = await uploadLogo(data.user.id, logoFile);
      }

      const { data: regData, error: rpcError } = await supabase.rpc("register_team_member", {
        p_user_id: data.user.id,
        p_team_name: teamName,
        p_member_name: memberName,
        p_phone: phone,
        p_role: role,
        p_logo_url: logoUrl
      });

      if (rpcError) throw rpcError;

      await supabase.auth.signOut();
      currentUser = null;

      showToast(
        "Registration submitted successfully. Maximum 2 members per team is enforced. Wait for admin approval.",
        "success"
      );
      loginMode = "login";
      render();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Registration failed.", "error");
    }
  }

  async function uploadLogo(userId, file) {
    const ext = file.name.split(".").pop().toLowerCase();
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from(LOGO_BUCKET)
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type
      });

    if (error) throw error;

    const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  function renderAppShell() {
    app.innerHTML = `
      <header class="topbar">
        <div class="container topbar-inner">
          <div class="brand">7TH <b>UNIVERSE</b> ESPORTS</div>

          <nav class="nav">
            <button class="nav-btn ${currentPage === "home" ? "active" : ""}" data-page="home">HOME</button>
            <button class="nav-btn ${currentPage === "practice" ? "active" : ""}" data-page="practice">PRACTICE</button>
            <button class="nav-btn ${currentPage === "recruit" ? "active" : ""}" data-page="recruit">RECRUIT</button>
            <button class="nav-btn ${currentPage === "my-posts" ? "active" : ""}" data-page="my-posts">MY POSTS</button>
            ${isAdmin ? `<button class="nav-btn ${currentPage === "admin" ? "active" : ""}" data-page="admin">ADMIN</button>` : ""}
            <button class="nav-btn" id="logoutBtn">LOGOUT</button>
          </nav>

          <div class="user-chip">
            ${currentTeam?.logo_url
              ? `<img class="avatar" src="${esc(currentTeam.logo_url)}" alt="Team logo">`
              : `<div class="avatar placeholder-logo">7U</div>`}
            <div class="user-meta">
              <strong>${esc(currentTeam?.name || currentProfile?.display_name || "Member")}</strong>
              <span>${esc(currentProfile?.role === "admin" ? "Administrator" : (currentProfile?.role || "Member"))}</span>
            </div>
          </div>
        </div>
      </header>

      <main id="pageRoot" class="page">
        ${loading("Preparing your esports dashboard...")}
      </main>
    `;

    document.querySelectorAll("[data-page]").forEach(btn => {
      btn.addEventListener("click", () => {
        currentPage = btn.dataset.page;
        renderAppShell();
      });
    });

    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
      await supabase.auth.signOut();
      showToast("Logged out.");
    });

    loadPage();
  }

  async function loadPage() {
    try {
      const root = document.getElementById("pageRoot");
      if (!root) return;

      if (currentPage === "home") {
        root.innerHTML = await renderHome();
      } else if (currentPage === "practice") {
        root.innerHTML = await renderPracticePage();
        bindPracticePage();
      } else if (currentPage === "recruit") {
        root.innerHTML = await renderRecruitPage();
        bindRecruitPage();
      } else if (currentPage === "my-posts") {
        root.innerHTML = await renderMyPosts();
      } else if (currentPage === "admin" && isAdmin) {
        root.innerHTML = await renderAdmin();
        bindAdmin();
      } else {
        currentPage = "home";
        root.innerHTML = await renderHome();
      }
    } catch (error) {
      console.error(error);
      document.getElementById("pageRoot").innerHTML = appError(error.message || "Page failed to load.");
    }
  }

  async function fetchChallenges() {
    const { data, error } = await supabase
      .from("practice_challenges")
      .select(`
        id, team_id, team_name, team_logo_url, match_type, match_time,
        format, contact, notes, status, created_at
      `)
      .eq("status", "open")
      .order("match_time", { ascending: true })
      .limit(100);

    if (error) throw error;
    state.challenges = data || [];
    return state.challenges;
  }

  async function fetchRecruitment() {
    const { data, error } = await supabase
      .from("recruitment_posts")
      .select(`
        id, team_id, team_name, team_logo_url, listing_type, looking_for,
        players_needed, availability, age_requirement, contact, experience,
        player_ign, player_uid, notes, status, created_at
      `)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;
    state.recruitment = data || [];
    return state.recruitment;
  }

  async function renderHome() {
    const [challenges, recruitment] = await Promise.all([
      fetchChallenges(),
      fetchRecruitment()
    ]);

    const challengeCards = challenges.slice(0, 4).map(challengeCard).join("");
    const recruitCards = recruitment.slice(0, 4).map(recruitCard).join("");

    return `
      <div class="container">
        <section class="hero-card">
          <div class="eyebrow">FREE FIRE ESPORTS</div>
          <h2>Welcome to 7TH UNIVERSE ESPORTS</h2>
          <p>
            Your central place for Clash Squad practice challenges and
            competitive team/player recruitment.
          </p>
          <div class="card-actions">
            <button class="btn btn-primary" data-page-home="practice">⚔ CREATE PRACTICE CHALLENGE</button>
            <button class="btn btn-blue" data-page-home="recruit">👥 CREATE RECRUITMENT POST</button>
          </div>
        </section>

        <section class="section-gap">
          <div class="page-title">
            <h2>⚔ Open Practice Challenges</h2>
            <p>Every challenge is posted for <b>EVERYONE</b>. There is no opponent-team selector.</p>
          </div>
          <div class="cards">
            ${challengeCards || `<div class="empty" style="grid-column:1/-1">No open practice challenges right now.</div>`}
          </div>
        </section>

        <section class="section-gap">
          <div class="page-title">
            <h2>👥 Recruitment</h2>
            <p>Free Fire teams and players looking for competitive opportunities.</p>
          </div>
          <div class="cards">
            ${recruitCards || `<div class="empty" style="grid-column:1/-1">No active recruitment posts right now.</div>`}
          </div>
        </section>
      </div>
    `;
  }

  function challengeCard(c) {
    const timeText = c.match_time
      ? new Date(c.match_time).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })
      : "Flexible";

    return `
      <article class="card">
        <div class="card-head">
          ${c.team_logo_url
            ? `<img class="team-logo" src="${esc(c.team_logo_url)}" alt="Team logo">`
            : `<div class="team-logo placeholder-logo">7U</div>`}
          <div>
            <h3>${esc(c.team_name)}</h3>
            <p>FREE FIRE • CLASH SQUAD • EVERYONE</p>
          </div>
        </div>

        <div class="badges">
          <span class="badge red">${esc(c.match_type)}</span>
          <span class="badge blue">${esc(c.format)}</span>
          <span class="badge green">OPEN</span>
          <span class="badge">EVERYONE</span>
        </div>

        <div class="info-grid">
          <div class="info"><small>Match Time</small><strong>${esc(timeText)}</strong></div>
          <div class="info"><small>Contact</small><strong>${esc(c.contact || "—")}</strong></div>
        </div>

        ${c.notes ? `<p style="color:#969696;font-size:12px;line-height:1.55;margin:13px 0 0">${esc(c.notes)}</p>` : ""}

        <div class="card-actions">
          <button class="btn btn-primary btn-small" data-contact="${esc(c.contact || "")}">WHATSAPP / CONTACT</button>
          <button class="btn btn-dark btn-small" data-details='${esc(JSON.stringify(c))}'>DETAILS</button>
        </div>
      </article>
    `;
  }

  function recruitCard(r) {
    const looking = Array.isArray(r.looking_for)
      ? r.looking_for.join(" • ")
      : (r.looking_for || "—");

    return `
      <article class="card">
        <div class="card-head">
          ${r.team_logo_url
            ? `<img class="team-logo" src="${esc(r.team_logo_url)}" alt="Team logo">`
            : `<div class="team-logo placeholder-logo">7U</div>`}
          <div>
            <h3>${esc(r.team_name || "Recruitment")}</h3>
            <p>FREE FIRE • ${esc(String(r.listing_type || "").replace("_", " ").toUpperCase())}</p>
          </div>
        </div>

        <div class="badges">
          <span class="badge red">${esc(looking)}</span>
          ${r.players_needed ? `<span class="badge blue">${esc(r.players_needed)} PLAYER(S)</span>` : ""}
          <span class="badge green">OPEN</span>
        </div>

        <div class="info-grid">
          <div class="info"><small>Availability</small><strong>${esc(r.availability || "—")}</strong></div>
          <div class="info"><small>Age</small><strong>${esc(r.age_requirement || "—")}</strong></div>
          ${r.player_ign ? `<div class="info"><small>Player IGN</small><strong>${esc(r.player_ign)}</strong></div>` : ""}
          ${r.player_uid ? `<div class="info"><small>UID</small><strong>${esc(r.player_uid)}</strong></div>` : ""}
        </div>

        ${r.notes ? `<p style="color:#969696;font-size:12px;line-height:1.55;margin:13px 0 0">${esc(r.notes)}</p>` : ""}

        <div class="card-actions">
          <button class="btn btn-blue btn-small" data-contact="${esc(r.contact || "")}">CONTACT</button>
          <button class="btn btn-dark btn-small" data-details='${esc(JSON.stringify(r))}'>DETAILS</button>
        </div>
      </article>
    `;
  }

  async function renderPracticePage() {
    const challenges = await fetchChallenges();

    return `
      <div class="container">
        <div class="page-title">
          <h2>⚔ FREE FIRE PRACTICE CHALLENGES</h2>
          <p>All posted challenges are available to <b>EVERYONE</b>. No specific opponent/team selection.</p>
        </div>

        <div class="cards" style="margin-bottom:20px">
          <div class="card" style="grid-column:1/-1">
            <h3 style="margin-top:0">CREATE PRACTICE CHALLENGE</h3>
            <p style="color:#888;font-size:12px;margin-top:4px">
              Your team information is taken from your approved team profile.
            </p>

            <form id="practiceForm">
              <div class="grid-3">
                <div class="field">
                  <label>Game</label>
                  <input value="FREE FIRE" disabled />
                </div>
                <div class="field">
                  <label>Mode</label>
                  <input value="CLASH SQUAD" disabled />
                </div>
                <div class="field">
                  <label>Challenge Audience</label>
                  <input value="EVERYONE" disabled />
                </div>
              </div>

              <div class="grid-3">
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
                <div class="field">
                  <label>Match Time *</label>
                  <input id="practiceTime" type="datetime-local" required />
                </div>
              </div>

              <div class="grid-2">
                <div class="field">
                  <label>Contact / WhatsApp Number *</label>
                  <input id="practiceContact" required value="${esc(currentProfile?.phone || "")}" placeholder="03XXXXXXXXX" />
                </div>
                <div class="field">
                  <label>Additional Notes</label>
                  <input id="practiceNotes" maxlength="250" placeholder="Example: Serious competitive teams only." />
                </div>
              </div>

              <div class="status-line">
                Posting account: <b>${esc(currentTeam?.name || "Your Team")}</b>
              </div>

              <button class="btn btn-primary" type="submit" style="margin-top:14px">POST OPEN CHALLENGE</button>
            </form>
          </div>
        </div>

        <div class="cards">
          ${challenges.map(challengeCard).join("") || `<div class="empty" style="grid-column:1/-1">No open challenges.</div>`}
        </div>
      </div>
    `;
  }

  function bindPracticePage() {
    document.getElementById("practiceForm")?.addEventListener("submit", submitPractice);
    bindCardActions();
  }

  async function submitPractice(e) {
    e.preventDefault();

    try {
      await ensureClient();
      if (!currentTeam) throw new Error("Approved team profile not found.");

      const payload = {
        p_team_id: currentTeam.id,
        p_team_name: currentTeam.name,
        p_team_logo_url: currentTeam.logo_url || null,
        p_match_type: document.getElementById("practiceMatchType").value,
        p_match_time: new Date(document.getElementById("practiceTime").value).toISOString(),
        p_format: document.getElementById("practiceFormat").value,
        p_contact: cleanPhone(document.getElementById("practiceContact").value),
        p_notes: document.getElementById("practiceNotes").value.trim()
      };

      if (!payload.p_match_time || Number.isNaN(new Date(payload.p_match_time).getTime())) {
        throw new Error("Choose a valid match time.");
      }

      const { data, error } = await supabase.rpc("create_practice_challenge", payload);
      if (error) throw error;

      showToast("Practice challenge posted for EVERYONE.");
      e.target.reset();
      document.getElementById("practiceContact").value = currentProfile?.phone || "";

      // Call the secure server-side WhatsApp function.
      await sendWhatsAppNotification({
        type: "practice_challenge",
        record_id: data
      });

      await loadPage();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not post challenge.", "error");
    }
  }

  async function renderRecruitPage() {
    return `
      <div class="container">
        <div class="page-title">
          <h2>👥 FREE FIRE RECRUITMENT</h2>
          <p>Create a professional requirement post for your team or publish your own player profile.</p>
        </div>

        <div class="card">
          <h3 style="margin-top:0">CREATE RECRUITMENT POST</h3>

          <form id="recruitForm">
            <div class="field">
              <label>Listing Type *</label>
              <select id="recruitType" required>
                <option value="TEAM_RECRUITMENT">TEAM RECRUITMENT — We need players</option>
                <option value="PLAYER_RECRUITMENT">PLAYER RECRUITMENT — I am looking for a team</option>
              </select>
            </div>

            <div id="teamRecruitFields">
              <div class="grid-2">
                <div class="field">
                  <label>Team Name</label>
                  <input id="recruitTeamName" value="${esc(currentTeam?.name || "")}" disabled />
                </div>
                <div class="field">
                  <label>Players Needed</label>
                  <select id="recruitPlayersNeeded">
                    <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option>
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
                <div class="hint">Use Ctrl/keyboard multi-select on desktop. On mobile, tap and hold where supported.</div>
              </div>
            </div>

            <div id="playerRecruitFields" class="hidden">
              <div class="grid-2">
                <div class="field">
                  <label>Player IGN *</label>
                  <input id="playerIgn" maxlength="40" placeholder="Free Fire in-game name" />
                </div>
                <div class="field">
                  <label>Free Fire UID *</label>
                  <input id="playerUid" maxlength="20" placeholder="Your UID" />
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

            <div class="grid-3">
              <div class="field">
                <label>Availability *</label>
                <input id="recruitAvailability" required placeholder="Example: 5 PM – 11 PM" />
              </div>
              <div class="field">
                <label>Age Requirement / Age *</label>
                <input id="recruitAge" required placeholder="Example: 16+ or 18" />
              </div>
              <div class="field">
                <label>Contact / WhatsApp *</label>
                <input id="recruitContact" required value="${esc(currentProfile?.phone || "")}" placeholder="03XXXXXXXXX" />
              </div>
            </div>

            <div class="grid-2">
              <div class="field">
                <label>Experience (Optional)</label>
                <input id="recruitExperience" maxlength="160" placeholder="Example: 2 years competitive CS" />
              </div>
              <div class="field">
                <label>Extra Details</label>
                <textarea id="recruitNotes" maxlength="500" placeholder="Requirements, trial details, preferred timings, etc."></textarea>
              </div>
            </div>

            <button class="btn btn-blue" type="submit">POST RECRUITMENT</button>
          </form>
        </div>
      </div>
    `;
  }

  function bindRecruitPage() {
    document.getElementById("recruitType")?.addEventListener("change", toggleRecruitType);
    document.getElementById("recruitForm")?.addEventListener("submit", submitRecruitment);
    toggleRecruitType();
  }

  function toggleRecruitType() {
    const type = document.getElementById("recruitType")?.value;
    const teamFields = document.getElementById("teamRecruitFields");
    const playerFields = document.getElementById("playerRecruitFields");

    const teamMode = type === "TEAM_RECRUITMENT";
    teamFields?.classList.toggle("hidden", !teamMode);
    playerFields?.classList.toggle("hidden", teamMode);

    const playerIgn = document.getElementById("playerIgn");
    const playerUid = document.getElementById("playerUid");
    if (playerIgn) playerIgn.required = !teamMode;
    if (playerUid) playerUid.required = !teamMode;
  }

  async function submitRecruitment(e) {
    e.preventDefault();

    try {
      await ensureClient();

      const type = document.getElementById("recruitType").value;
      const contact = cleanPhone(document.getElementById("recruitContact").value);

      if (!/^\+92\d{10}$/.test(contact)) {
        throw new Error("Use a valid Pakistan mobile number.");
      }

      let lookingFor = [];
      let playerIgn = null;
      let playerUid = null;
      let experience = document.getElementById("recruitExperience").value.trim();

      if (type === "TEAM_RECRUITMENT") {
        lookingFor = [...document.getElementById("recruitLookingFor").selectedOptions].map(o => o.value);
        if (!lookingFor.length) throw new Error("Select at least one role.");
        if (!currentTeam) throw new Error("Your approved team profile was not found.");
      } else {
        playerIgn = document.getElementById("playerIgn").value.trim();
        playerUid = document.getElementById("playerUid").value.trim();
        const role = document.getElementById("playerRole").value;
        lookingFor = [role];

        if (!playerIgn || !playerUid) {
          throw new Error("Player IGN and UID are required.");
        }
      }

      const { data, error } = await supabase.rpc("create_recruitment_post", {
        p_team_id: currentTeam?.id || null,
        p_team_name: currentTeam?.name || playerIgn,
        p_team_logo_url: currentTeam?.logo_url || null,
        p_listing_type: type,
        p_looking_for: lookingFor,
        p_players_needed: type === "TEAM_RECRUITMENT"
          ? Number(document.getElementById("recruitPlayersNeeded").value)
          : 1,
        p_availability: document.getElementById("recruitAvailability").value.trim(),
        p_age_requirement: document.getElementById("recruitAge").value.trim(),
        p_contact: contact,
        p_experience: experience || null,
        p_player_ign: playerIgn,
        p_player_uid: playerUid,
        p_notes: document.getElementById("recruitNotes").value.trim() || null
      });

      if (error) throw error;

      showToast("Recruitment post created.");
      await sendWhatsAppNotification({
        type: "recruitment",
        record_id: data
      });

      e.target.reset();
      document.getElementById("recruitContact").value = currentProfile?.phone || "";
      toggleRecruitType();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not create recruitment post.", "error");
    }
  }

  async function renderMyPosts() {
    const [ch, rr] = await Promise.all([
      supabase
        .from("practice_challenges")
        .select("*")
        .eq("team_id", currentTeam?.id || "__none__")
        .order("created_at", { ascending:false }),
      supabase
        .from("recruitment_posts")
        .select("*")
        .eq("team_id", currentTeam?.id || "__none__")
        .order("created_at", { ascending:false })
    ]);

    if (ch.error) throw ch.error;
    if (rr.error) throw rr.error;

    return `
      <div class="container">
        <div class="page-title">
          <h2>MY POSTS</h2>
          <p>Manage your team's practice challenges and recruitment posts.</p>
        </div>

        <div class="section-gap">
          <h3>Practice Challenges</h3>
          <div class="cards">
            ${(ch.data || []).map(challengeCard).join("") || `<div class="empty" style="grid-column:1/-1">No practice posts yet.</div>`}
          </div>
        </div>

        <div class="section-gap">
          <h3>Recruitment</h3>
          <div class="cards">
            ${(rr.data || []).map(recruitCard).join("") || `<div class="empty" style="grid-column:1/-1">No recruitment posts yet.</div>`}
          </div>
        </div>
      </div>
    `;
  }

  function bindCardActions() {
    document.querySelectorAll("[data-contact]").forEach(btn => {
      btn.addEventListener("click", () => {
        const phone = cleanPhone(btn.dataset.contact || "");
        if (!phone) {
          showToast("No contact number available.", "error");
          return;
        }
        window.open(`https://wa.me/${phone.replace("+","")}`, "_blank", "noopener");
      });
    });

    document.querySelectorAll("[data-details]").forEach(btn => {
      btn.addEventListener("click", () => {
        const data = JSON.parse(btn.dataset.details);
        const body = `
          <div class="info-grid">
            ${Object.entries(data)
              .filter(([k]) => !["id","team_id","team_logo_url"].includes(k) && data[k] !== null && data[k] !== "")
              .map(([k,v]) => `
                <div class="info">
                  <small>${esc(k.replaceAll("_"," "))}</small>
                  <strong>${esc(Array.isArray(v) ? v.join(" • ") : String(v))}</strong>
                </div>
              `).join("")}
          </div>
        `;
        openModal("Post Details", body);
      });
    });
  }

  async function sendWhatsAppNotification(payload) {
    try {
      const { error } = await supabase.functions.invoke(WHATSAPP_FUNCTION, {
        body: payload
      });

      if (error) {
        console.warn("WhatsApp notification was not delivered:", error);
        showToast("Post saved, but WhatsApp notification could not be sent.", "error");
      }
    } catch (error) {
      console.warn("WhatsApp function error:", error);
      showToast("Post saved, but WhatsApp notification is currently unavailable.", "error");
    }
  }

  async function openPublicList(type) {
    try {
      await ensureClient();
      if (type === "practice") {
        await fetchChallenges();
        openModal("⚔ Open Practice Challenges", `
          <div class="cards">
            ${state.challenges.map(challengeCard).join("") || `<div class="empty" style="grid-column:1/-1">No open challenges.</div>`}
          </div>
        `);
      } else {
        await fetchRecruitment();
        openModal("👥 Recruitment", `
          <div class="cards">
            ${state.recruitment.map(recruitCard).join("") || `<div class="empty" style="grid-column:1/-1">No recruitment posts.</div>`}
          </div>
        `);
      }
      bindCardActions();
    } catch (error) {
      showToast(error.message || "Unable to load public list.", "error");
    }
  }

  /* -------------------- ADMIN -------------------- */

  async function renderAdmin() {
    const [reg, teams, ch, rr] = await Promise.all([
      supabase.from("profiles").select("*").neq("role","admin").order("created_at",{ascending:false}).limit(200),
      supabase.from("teams").select("*").order("created_at",{ascending:false}).limit(200),
      supabase.from("practice_challenges").select("*").order("created_at",{ascending:false}).limit(200),
      supabase.from("recruitment_posts").select("*").order("created_at",{ascending:false}).limit(200)
    ]);

    if (reg.error) throw reg.error;
    if (teams.error) throw teams.error;
    if (ch.error) throw ch.error;
    if (rr.error) throw rr.error;

    state.registrations = reg.data || [];
    state.teams = teams.data || [];
    state.challenges = ch.data || [];
    state.recruitment = rr.data || [];

    const pending = state.registrations.filter(x => x.status === "pending").length;

    return `
      <div class="container">
        <div class="page-title">
          <h2>ADMIN CONTROL CENTER</h2>
          <p>Full management of registrations, teams, practice, recruitment, bans and platform content.</p>
        </div>

        <div class="stat-grid" style="margin-bottom:20px">
          <div class="stat"><small>PENDING REGISTRATIONS</small><strong>${pending}</strong></div>
          <div class="stat"><small>TEAMS</small><strong>${state.teams.length}</strong></div>
          <div class="stat"><small>PRACTICE POSTS</small><strong>${state.challenges.length}</strong></div>
          <div class="stat"><small>RECRUITMENT POSTS</small><strong>${state.recruitment.length}</strong></div>
        </div>

        <div class="admin-shell">
          <aside class="admin-side">
            <button class="${adminSection==="registrations"?"active":""}" data-admin-section="registrations">Registrations</button>
            <button class="${adminSection==="teams"?"active":""}" data-admin-section="teams">Teams</button>
            <button class="${adminSection==="practice"?"active":""}" data-admin-section="practice">Practice</button>
            <button class="${adminSection==="recruitment"?"active":""}" data-admin-section="recruitment">Recruitment</button>
          </aside>

          <section class="admin-main">
            ${renderAdminSection()}
          </section>
        </div>
      </div>
    `;
  }

  function renderAdminSection() {
    if (adminSection === "teams") {
      return `
        <div class="card">
          <h3 style="margin-top:0">Teams</h3>
          ${tableTeams()}
        </div>
      `;
    }

    if (adminSection === "practice") {
      return `
        <div class="card">
          <h3 style="margin-top:0">Practice Challenges</h3>
          ${tablePractice()}
        </div>
      `;
    }

    if (adminSection === "recruitment") {
      return `
        <div class="card">
          <h3 style="margin-top:0">Recruitment Posts</h3>
          ${tableRecruitment()}
        </div>
      `;
    }

    return `
      <div class="card">
        <h3 style="margin-top:0">Pending / Member Registrations</h3>
        ${tableRegistrations()}
      </div>
    `;
  }

  function tableRegistrations() {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Member</th><th>Team</th><th>Role</th><th>Phone</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${state.registrations.map(row => `
              <tr>
                <td>${esc(row.display_name)}</td>
                <td>${esc(row.team_name || "—")}</td>
                <td>${esc(row.role)}</td>
                <td>${esc(row.phone || "—")}</td>
                <td><span class="badge ${row.status==="approved"?"green":"red"}">${esc(row.status)}</span></td>
                <td>
                  <div class="card-actions">
                    ${row.status === "pending"
                      ? `<button class="btn btn-green btn-small" data-approve="${esc(row.id)}">APPROVE</button>
                         <button class="btn btn-danger btn-small" data-reject="${esc(row.id)}">REJECT</button>`
                      : `<button class="btn btn-dark btn-small" data-toggle-ban="${esc(row.id)}" data-next-status="${row.status==="banned"?"approved":"banned"}">${row.status==="banned"?"UNBAN":"BAN"}</button>`}
                  </div>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="6">No registrations found.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function tableTeams() {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Team</th><th>Status</th><th>Created</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${state.teams.map(t => `
              <tr>
                <td>
                  <div style="display:flex;gap:10px;align-items:center">
                    ${t.logo_url ? `<img class="mini-logo" src="${esc(t.logo_url)}">` : `<div class="mini-logo placeholder-logo">7U</div>`}
                    <strong>${esc(t.name)}</strong>
                  </div>
                </td>
                <td><span class="badge ${t.status==="active"?"green":"red"}">${esc(t.status)}</span></td>
                <td>${fmtDate(t.created_at)}</td>
                <td>
                  <button class="btn btn-dark btn-small" data-team-status="${esc(t.id)}" data-next-team-status="${t.status==="banned"?"active":"banned"}">
                    ${t.status==="banned"?"UNBAN":"BAN"}
                  </button>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="4">No teams found.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function tablePractice() {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Team</th><th>Match</th><th>Format</th><th>Time</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${state.challenges.map(c => `
              <tr>
                <td>${esc(c.team_name)}</td>
                <td>${esc(c.match_type)}</td>
                <td>${esc(c.format)}</td>
                <td>${fmtDate(c.match_time)}</td>
                <td><span class="badge ${c.status==="open"?"green":"red"}">${esc(c.status)}</span></td>
                <td>
                  <button class="btn btn-dark btn-small" data-challenge-status="${esc(c.id)}" data-next-challenge-status="${c.status==="open"?"closed":"open"}">
                    ${c.status==="open"?"CLOSE":"REOPEN"}
                  </button>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="6">No challenges found.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function tableRecruitment() {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Team/Player</th><th>Type</th><th>Looking For</th><th>Availability</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${state.recruitment.map(r => `
              <tr>
                <td>${esc(r.team_name || r.player_ign || "—")}</td>
                <td>${esc(r.listing_type)}</td>
                <td>${esc(Array.isArray(r.looking_for) ? r.looking_for.join(", ") : r.looking_for || "—")}</td>
                <td>${esc(r.availability || "—")}</td>
                <td><span class="badge ${r.status==="open"?"green":"red"}">${esc(r.status)}</span></td>
                <td>
                  <button class="btn btn-dark btn-small" data-recruit-status="${esc(r.id)}" data-next-recruit-status="${r.status==="open"?"closed":"open"}">
                    ${r.status==="open"?"CLOSE":"REOPEN"}
                  </button>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="6">No recruitment posts found.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function bindAdmin() {
    document.querySelectorAll("[data-admin-section]").forEach(btn => {
      btn.addEventListener("click", async () => {
        adminSection = btn.dataset.adminSection;
        renderAppShell();
      });
    });

    document.querySelectorAll("[data-approve]").forEach(btn => {
      btn.addEventListener("click", () => changeProfileStatus(btn.dataset.approve, "approved"));
    });

    document.querySelectorAll("[data-reject]").forEach(btn => {
      btn.addEventListener("click", () => changeProfileStatus(btn.dataset.reject, "rejected"));
    });

    document.querySelectorAll("[data-toggle-ban]").forEach(btn => {
      btn.addEventListener("click", () => changeProfileStatus(btn.dataset.toggleBan, btn.dataset.nextStatus));
    });

    document.querySelectorAll("[data-team-status]").forEach(btn => {
      btn.addEventListener("click", () => changeTeamStatus(btn.dataset.teamStatus, btn.dataset.nextTeamStatus));
    });

    document.querySelectorAll("[data-challenge-status]").forEach(btn => {
      btn.addEventListener("click", () => changeChallengeStatus(btn.dataset.challengeStatus, btn.dataset.nextChallengeStatus));
    });

    document.querySelectorAll("[data-recruit-status]").forEach(btn => {
      btn.addEventListener("click", () => changeRecruitStatus(btn.dataset.recruitStatus, btn.dataset.nextRecruitStatus));
    });
  }

  async function changeProfileStatus(id, status) {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ status })
        .eq("id", id);

      if (error) throw error;
      showToast(`Member status changed to ${status}.`);
      renderAppShell();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not update member.", "error");
    }
  }

  async function changeTeamStatus(id, status) {
    try {
      const { error } = await supabase
        .from("teams")
        .update({ status })
        .eq("id", id);

      if (error) throw error;
      showToast(`Team status changed to ${status}.`);
      renderAppShell();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not update team.", "error");
    }
  }

  async function changeChallengeStatus(id, status) {
    try {
      const { error } = await supabase
        .from("practice_challenges")
        .update({ status })
        .eq("id", id);

      if (error) throw error;
      showToast(`Challenge status changed to ${status}.`);
      renderAppShell();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not update challenge.", "error");
    }
  }

  async function changeRecruitStatus(id, status) {
    try {
      const { error } = await supabase
        .from("recruitment_posts")
        .update({ status })
        .eq("id", id);

      if (error) throw error;
      showToast(`Recruitment status changed to ${status}.`);
      renderAppShell();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not update recruitment post.", "error");
    }
  }

  // Home action buttons
  document.addEventListener("click", (e) => {
    const p = e.target.closest("[data-page-home]");
    if (!p || !currentUser) return;
    currentPage = p.dataset.pageHome;
    renderAppShell();
  });

  // Final startup
  (async () => {
    if (!supabaseReady) {
      renderAuthShell();
      showToast("Add your Supabase URL and publishable key in script.js.", "error");
      return;
    }

    await refreshSession();
  })();

})();
