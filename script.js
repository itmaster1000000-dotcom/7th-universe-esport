/*
  7TH UNIVERSE ESPORTS — GVG-STYLE FRONTEND
  Separate Supabase project: ESPORTS
  NOTE: this browser client uses the publishable key only.
*/

const SUPABASE_URL = 'https://otrjuqcutwlwvzyruhaq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ro_4z-4OdgFCda9pT8Z3Pg_UEnY4aTE';
const LOGO_BUCKET = 'team-logos';
const MAX_LOGO_SIZE = 3 * 1024 * 1024;

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storageKey: '7th-universe-esports-member-v1', autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
});
const adminDb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storageKey: '7th-universe-esports-admin-v1', autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
});

const state = {
  user: null,
  profile: null,
  team: null,
  teamMember: null,
  adminUser: null,
  adminOk: false,
  challenges: [],
  recruitment: [],
  registrations: [],
  teams: [],
  adminChallenges: [],
  adminRecruitment: [],
  memberSection: 'overview',
  adminSection: 'registrations'
};

const $ = (id) => document.getElementById(id);
const normalizeContact = (v) => { let n=String(v||'').replace(/\D/g,''); if(n.startsWith('00')) n=n.slice(2); if(n.startsWith('0')) n='92'+n.slice(1); return n; };
const formatContact = (v) => { const n=normalizeContact(v); if(!n) return ''; return n.startsWith('92') && n.length===12 ? `+92 ${n.slice(2,5)} ${n.slice(5,8)} ${n.slice(8)}` : `+${n}`; };
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const formatDateTime = (v) => { if(!v)return '--'; try{return new Intl.DateTimeFormat('en-PK',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v));}catch{return String(v)} };
const cleanText = (v,fallback='—') => {const s=String(v??'').trim(); return s||fallback;};

function showStatus(id, type, message){const e=$(id);if(!e)return;e.className=`status show ${type}`;e.textContent=message;}
function clearStatus(id){const e=$(id);if(!e)return;e.className='status';e.textContent='';}
function toast(message,type='success'){const e=$('toast');e.textContent=message;e.className=`show ${type}`;clearTimeout(toast.t);toast.t=setTimeout(()=>e.className='',4500);}
function openModal(title,html){$('modal').innerHTML=`<div class="modal-head"><div><div class="kicker">7TH UNIVERSE ESPORTS</div><h3 style="margin:4px 0 0;font-family:'Barlow Condensed',sans-serif;font-size:30px">${escapeHtml(title)}</h3></div><button class="close-btn" id="modal-close" type="button">×</button></div>${html}`;$('modal-backdrop').classList.add('open');$('modal-close').onclick=closeModal;}
function closeModal(){$('modal-backdrop').classList.remove('open');}
$('modal-backdrop').addEventListener('click',e=>{if(e.target.id==='modal-backdrop')closeModal();});

function openView(name){
  $('public-landing').style.display=['public','register'].includes(name)?'grid':'none';
  $('public-view').classList.toggle('hidden',name!=='public');
  $('register-view').classList.toggle('hidden',name!=='register');
  $('member-dashboard').style.display=name==='member'?'block':'none';
  $('admin-page').style.display=name==='admin'?'block':'none';
  window.scrollTo({top:0,behavior:'smooth'});
}

function renderRules(){
  const rules=[
    ['01','Use practice challenges only for genuine competitive play.'],
    ['02','Challenge audience is EVERYONE; no specific opponent is selected.'],
    ['03','Keep contact details clear and reachable before posting.'],
    ['04','Do not post fake, abusive, misleading or spam listings.'],
    ['05','Recruitment posts must clearly mention the required role.'],
    ['06','Match time must be realistic and agreed through WhatsApp/contact.'],
    ['07','One team can have a maximum of 2 website members.'],
    ['08','Leader / IGL and Sub-Leader are the official member roles.'],
    ['09','Admin may close, remove or ban any violating post/account.'],
    ['10','Respect every team, player and 7TH UNIVERSE community member.']
  ];
  $('rules-grid').innerHTML=rules.map(([n,t])=>`<div class="rule-item"><div class="rule-no">${n}</div><div class="rule-text">${t}</div></div>`).join('');
}

async function currentTeamForUser(userId){
  const {data,error}=await db.from('team_members').select('id,team_id,user_id,role,status,teams(id,name,logo_url,status,created_at)').eq('user_id',userId).in('status',['pending','approved']).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  if(!data)return {team:null,member:null};
  return {team:data.teams||null,member:data};
}

async function hydrateMemberSession(){
  const {data:{session}}=await db.auth.getSession();
  state.user=session?.user||null;
  if(!state.user){state.profile=null;state.team=null;state.teamMember=null;$('nav-logout').classList.add('hidden');openView('public');return;}
  const {data:profile,error:pe}=await db.from('profiles').select('*').eq('id',state.user.id).maybeSingle();
  if(pe)throw pe;
  state.profile=profile;
  if(!profile){await db.auth.signOut();throw new Error('Account profile is not ready yet.');}
  if(profile.role==='admin' && profile.status==='approved'){state.adminOk=true;}
  if(profile.status!=='approved' && !(profile.role==='admin'&&profile.status==='approved')){
    await db.auth.signOut();
    openView('public');
    throw new Error(profile.status==='banned'?'Your account has been banned.':'Your registration is still PENDING admin approval.');
  }
  const found=await currentTeamForUser(state.user.id);
  state.team=found.team;state.teamMember=found.member;
  $('nav-register').classList.add('hidden');$('nav-logout').classList.remove('hidden');
  if(state.profile){$('member-identity').textContent=`${state.team?.name||state.profile.team_name||'Team'} • ${state.profile.display_name||''} • ${state.profile.role==='leader'?'Team Leader / IGL':'Sub-Leader'}`;}
  $('member-status-badge').textContent=state.team?.status==='banned'?'TEAM BANNED':'APPROVED MEMBER';
  $('member-status-badge').className=`badge ${state.team?.status==='banned'?'badge-red':'badge-green'}`;
  renderTeamCard();
  renderRules();
  openView('member');
  setMemberSection(state.memberSection||'overview');
}

db.auth.onAuthStateChange(async(event)=>{
  if(['SIGNED_IN','SIGNED_OUT','TOKEN_REFRESHED'].includes(event)){
    try{await hydrateMemberSession();}catch(e){console.error(e);toast(e.message||'Session update failed.','error');}
  }
});

function renderTeamCard(){
  const box=$('my-team-card'); if(!box)return;
  const logo=state.team?.logo_url?`<img src="${escapeHtml(state.team.logo_url)}" style="width:64px;height:64px;object-fit:cover;border-radius:15px;border:1px solid rgba(81,178,255,.22)">`:`<div class="preview-icon" style="width:64px;height:64px">7U</div>`;
  box.innerHTML=`<div style="display:flex;gap:11px;align-items:center">${logo}<div><div class="kicker">Registered Team</div><div style="font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:900">${escapeHtml(state.team?.name||state.profile?.team_name||'—')}</div><div class="subtle">${escapeHtml(state.profile?.display_name||'')} • ${escapeHtml(state.profile?.role||'')}</div></div></div><div class="dashboard-note" style="margin-top:12px"><span><b>Members:</b> 2 maximum</span></div>`;
}

async function handleLogin(e){
  e.preventDefault();
  try{
    const identifier=$('login-identifier').value.trim();const password=$('login-password').value;
    if(!identifier||!password)throw new Error('Enter your email/mobile and password.');
    const credentials=identifier.includes('@')?{email:identifier.toLowerCase(),password}:{phone:normalizeContact(identifier),password};
    const {data,error}=await db.auth.signInWithPassword(credentials);if(error)throw error;
    await hydrateMemberSession();
    toast('Login successful. Welcome to 7TH UNIVERSE ESPORTS.');
  }catch(err){showStatus('login-status','error',err.message||'Login failed.');}
}

async function handleRegister(e){
  e.preventDefault();
  try{
    const team=$('register-team').value.trim();const role=$('register-role').value;const name=$('register-name').value.trim();const phone=normalizeContact($('register-contact').value);const email=$('register-email').value.trim().toLowerCase();const p=$('register-password').value;const p2=$('register-password-confirm').value;const file=$('register-logo').files?.[0]||null;
    if(!team||!name||!phone||!email)throw new Error('Complete all required fields.');
    if(!/^92\d{10}$/.test(phone))throw new Error('Use a valid Pakistan mobile number.');
    if(p.length<8)throw new Error('Password must be at least 8 characters.');
    if(p!==p2)throw new Error('Passwords do not match.');
    if(file){if(file.size>MAX_LOGO_SIZE)throw new Error('Team logo must be 3 MB or smaller.');if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error('Logo must be PNG, JPG or WEBP.');}

    const {data:existing,error:te}=await db.from('teams').select('id,name,status').ilike('name',team).limit(1).maybeSingle();if(te)throw te;
    if(existing?.status==='banned')throw new Error('This team is banned and cannot register.');
    if(existing){
      const {data:members,error:me}=await db.from('team_members').select('role,status').eq('team_id',existing.id).in('status',['pending','approved']);if(me)throw me;
      if((members||[]).length>=2)throw new Error('This team already has the maximum 2 website members.');
      if((members||[]).some(x=>x.role===role))throw new Error(`This team already has a ${role==='leader'?'Team Leader / IGL':'Sub-Leader'}.`);
    }

    const {data,error}=await db.auth.signUp({email,password:p,options:{data:{display_name:name,phone,team_name:team,requested_role:role}}});
    if(error)throw error;
    if(!data.user)throw new Error('Registration could not be created.');

    /* The database trigger created in REGISTRATION_FIX.sql creates the pending
       profile/team/team_member record from auth metadata. We intentionally do
       not duplicate that insert here. */
    if(file && data.session){
      try{const logoUrl=await uploadLogo(data.user.id,file);await db.from('teams').update({logo_url:logoUrl}).eq('name',team);}catch(uploadError){console.warn('Logo upload failed:',uploadError);}
    }

    if(data.session)await db.auth.signOut();
    $('register-form').reset();
    openView('public');
    $('register-status').className='status';
    showStatus('login-status','ok','Registration submitted successfully. Your account is now PENDING for admin approval.');
  }catch(err){showStatus('register-status','error',err.message||'Registration failed.');}
}

async function uploadLogo(userId,file){const ext=file.name.split('.').pop().toLowerCase();const path=`${userId}/${crypto.randomUUID()}.${ext}`;const {error}=await db.storage.from(LOGO_BUCKET).upload(path,file,{upsert:false,contentType:file.type,cacheControl:'3600'});if(error)throw error;return db.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;}

async function forgotPassword(){
  const email=prompt('Enter your registered email address:');if(!email)return;
  const {error}=await db.auth.resetPasswordForEmail(email.trim().toLowerCase(),{redirectTo:window.location.origin});
  if(error)toast(error.message,'error');else toast('Password reset email sent if the account exists.');
}

function setMemberSection(name){
  const valid=['overview','practice','recruitment','my-posts'];const section=valid.includes(name)?name:'overview';state.memberSection=section;
  document.querySelectorAll('.member-view').forEach(x=>x.classList.toggle('active',x.id===`member-section-${section}`));
  document.querySelectorAll('[data-member-section]').forEach(x=>x.classList.toggle('active',x.dataset.memberSection===section));
  if(section==='practice')loadChallenges();
  if(section==='recruitment')loadRecruitment();
  if(section==='my-posts')loadMyPosts();
}

async function loadChallenges(){const {data,error}=await db.from('practice_challenges').select('*').eq('status','open').order('match_time',{ascending:true}).limit(100);if(error)throw error;state.challenges=data||[];$('live-challenge-list').innerHTML=state.challenges.map(challengeCard).join('')||'<div class="empty">No open practice challenges right now.</div>';}
async function loadRecruitment(){const {data,error}=await db.from('recruitment_posts').select('*').eq('status','open').order('created_at',{ascending:false}).limit(100);if(error)throw error;state.recruitment=data||[];$('live-recruitment-list').innerHTML=state.recruitment.map(recruitmentCard).join('')||'<div class="empty">No active recruitment posts right now.</div>';}

function challengeCard(c){return `<div class="challenge-card"><div class="meta-row"><div><div class="name">${escapeHtml(c.team_name)}</div><div class="subtle">FREE FIRE • CLASH SQUAD</div></div><span class="badge badge-green">EVERYONE</span></div><div class="pill-wrap"><span class="pill">${escapeHtml(c.match_type)}</span><span class="pill">${escapeHtml(c.format)}</span><span class="pill">OPEN</span></div><div class="challenge-time">${escapeHtml(formatDateTime(c.match_time))}</div>${c.notes?`<div class="subtle" style="margin-top:8px">${escapeHtml(c.notes)}</div>`:''}<div class="contact-line"><span style="color:#6e8ba4;font-size:9px">${escapeHtml(formatContact(c.contact))}</span><button class="contact-link" data-contact="${escapeHtml(c.contact)}">WHATSAPP</button></div></div>`;}
function recruitmentCard(r){const roles=Array.isArray(r.looking_for)?r.looking_for.join(' • '):cleanText(r.looking_for);return `<div class="challenge-card"><div class="meta-row"><div><div class="name">${escapeHtml(r.team_name||r.player_ign||'PLAYER')}</div><div class="subtle">FREE FIRE • ${escapeHtml(String(r.listing_type||'').replaceAll('_',' '))}</div></div><span class="badge badge-blue">OPEN</span></div><div class="pill-wrap"><span class="pill">${escapeHtml(roles)}</span>${r.players_needed?`<span class="pill">${escapeHtml(r.players_needed)} NEEDED</span>`:''}</div><div class="info-grid" style="margin-top:10px"><div class="info"><small>Availability</small><b>${escapeHtml(r.availability||'—')}</b></div><div class="info"><small>Age</small><b>${escapeHtml(r.age_requirement||'—')}</b></div></div>${r.notes?`<div class="subtle" style="margin-top:8px">${escapeHtml(r.notes)}</div>`:''}<div class="contact-line"><span style="color:#6e8ba4;font-size:9px">${escapeHtml(formatContact(r.contact))}</span><button class="contact-link" data-contact="${escapeHtml(r.contact)}">CONTACT</button></div></div>`;}

async function submitChallenge(e){e.preventDefault();try{if(!state.team)throw new Error('Approved team membership is required.');const tm=$('challenge-time').value;const d=new Date(tm);if(Number.isNaN(d.getTime()))throw new Error('Select a valid match time.');const contact=normalizeContact($('challenge-contact').value);if(!/^92\d{10}$/.test(contact))throw new Error('Use a valid Pakistan contact number.');const {error}=await db.rpc('create_practice_challenge',{p_team_id:state.team.id,p_team_name:state.team.name,p_team_logo_url:state.team.logo_url||null,p_match_type:$('challenge-match-type').value,p_match_time:d.toISOString(),p_format:$('challenge-format').value,p_contact:contact,p_notes:$('challenge-notes').value.trim()||null});if(error)throw error;showStatus('challenge-status','ok','Practice challenge posted for EVERYONE.');$('challenge-form').reset();$('challenge-contact').value=state.profile.phone||'';await loadChallenges();}catch(err){showStatus('challenge-status','error',err.message||'Could not post challenge.');}}

function toggleRecruitmentMode(){const teamMode=$('recruitment-type').value==='TEAM_RECRUITMENT';$('team-recruit-fields').classList.toggle('hidden',!teamMode);$('player-recruit-fields').classList.toggle('hidden',teamMode);$('player-ign').required=!teamMode;$('player-uid').required=!teamMode;}
async function submitRecruitment(e){e.preventDefault();try{const type=$('recruitment-type').value;const contact=normalizeContact($('recruit-contact').value);if(!/^92\d{10}$/.test(contact))throw new Error('Use a valid Pakistan contact number.');let lookingFor=[];let playerIgn=null;let playerUid=null;if(type==='TEAM_RECRUITMENT'){if(!state.team)throw new Error('Approved team membership is required.');lookingFor=[...$('recruit-looking-for').selectedOptions].map(o=>o.value);if(!lookingFor.length)throw new Error('Select at least one role.');}else{playerIgn=$('player-ign').value.trim();playerUid=$('player-uid').value.trim();lookingFor=[$('player-role').value];if(!playerIgn||!playerUid)throw new Error('Player IGN and UID are required.');}const {error}=await db.rpc('create_recruitment_post',{p_team_id:state.team?.id||null,p_team_name:state.team?.name||playerIgn,p_team_logo_url:state.team?.logo_url||null,p_listing_type:type,p_looking_for:lookingFor,p_players_needed:type==='TEAM_RECRUITMENT'?Number($('recruit-players-needed').value):1,p_availability:$('recruit-availability').value.trim(),p_age_requirement:$('recruit-age').value.trim(),p_contact:contact,p_experience:$('recruit-experience').value.trim()||null,p_player_ign:playerIgn,p_player_uid:playerUid,p_notes:$('recruit-notes').value.trim()||null});if(error)throw error;showStatus('recruitment-status','ok','Recruitment post published successfully.');$('recruitment-form').reset();$('recruit-contact').value=state.profile.phone||'';toggleRecruitmentMode();await loadRecruitment();}catch(err){showStatus('recruitment-status','error',err.message||'Could not publish recruitment.');}}

async function loadMyPosts(){if(!state.team){$('my-posts-list').innerHTML='<div class="empty">No approved team attached.</div>';return;}const [a,b]=await Promise.all([db.from('practice_challenges').select('*').eq('team_id',state.team.id).order('created_at',{ascending:false}).limit(20),db.from('recruitment_posts').select('*').eq('team_id',state.team.id).order('created_at',{ascending:false}).limit(20)]);if(a.error)throw a.error;if(b.error)throw b.error;const rows=[...(a.data||[]).map(x=>({kind:'PRACTICE',data:x})),...(b.data||[]).map(x=>({kind:'RECRUITMENT',data:x}))].sort((x,y)=>new Date(y.data.created_at)-new Date(x.data.created_at));$('my-posts-list').innerHTML=rows.map(x=>`<div class="challenge-card"><div class="meta-row"><strong>${escapeHtml(x.kind)}</strong><span class="badge ${x.data.status==='open'?'badge-green':'badge-gray'}">${escapeHtml(x.data.status)}</span></div><div style="margin-top:7px;font-size:12px;color:#b7cadc">${escapeHtml(x.data.team_name||x.data.player_ign||'—')}</div><div class="subtle">Created ${escapeHtml(formatDateTime(x.data.created_at))}</div></div>`).join('')||'<div class="empty">No posts yet.</div>';}

/* ---------------- ADMIN ---------------- */
async function openAdmin(){openView('admin');const {data:{session}}=await adminDb.auth.getSession();state.adminUser=session?.user||null;if(!state.adminUser){$('admin-login-view').classList.remove('hidden');$('admin-dashboard').classList.add('hidden');return;}const p=await adminDb.from('profiles').select('*').eq('id',state.adminUser.id).maybeSingle();if(p.error)throw p.error;if(!p.data||p.data.role!=='admin'||p.data.status!=='approved'){await adminDb.auth.signOut();state.adminOk=false;throw new Error('This account is not an approved admin.');}state.adminOk=true;$('admin-login-view').classList.add('hidden');$('admin-dashboard').classList.remove('hidden');$('admin-session-label').textContent=`Authenticated • ${p.data.display_name||state.adminUser.email||''}`;loadAdminSection(state.adminSection);}
async function handleAdminLogin(e){e.preventDefault();try{const {data,error}=await adminDb.auth.signInWithPassword({email:$('admin-email').value.trim().toLowerCase(),password:$('admin-password').value});if(error)throw error;state.adminUser=data.user;await openAdmin();toast('Admin login successful.');}catch(err){showStatus('admin-login-status','error',err.message||'Admin login failed.');}}
async function loadAdminSection(section){state.adminSection=section;document.querySelectorAll('.admin-panel-view').forEach(x=>x.classList.toggle('active',x.id===`admin-section-${section}`));document.querySelectorAll('.admin-tab').forEach(x=>x.classList.toggle('active',x.dataset.adminSection===section));if(section==='registrations')return loadAdminRegistrations();if(section==='teams')return loadAdminTeams();if(section==='practice')return loadAdminPractice();if(section==='recruitment')return loadAdminRecruitment();}
async function loadAdminRegistrations(){const {data,error}=await adminDb.from('profiles').select('*').neq('role','admin').order('created_at',{ascending:false}).limit(300);if(error)throw error;state.registrations=data||[];const pending=state.registrations.filter(p=>p.status==='pending');$('pending-registration-table').innerHTML=pending.map(p=>`<tr><td><strong>${escapeHtml(p.display_name)}</strong><div class="subtle">${escapeHtml(p.phone||'')}</div></td><td>${escapeHtml(p.team_name||'—')}</td><td>${escapeHtml(p.role==='leader'?'Leader / IGL':'Sub-Leader')}</td><td><span class="badge badge-red">PENDING</span></td><td><div class="admin-actions"><button class="btn btn-green btn-small" data-approve="${p.id}">APPROVE</button><button class="btn btn-red btn-small" data-reject="${p.id}">REJECT</button></div></td></tr>`).join('')||'<tr><td colspan="5"><div class="empty">No pending registrations.</div></td></tr>';}
async function loadAdminTeams(){const {data,error}=await adminDb.from('teams').select('*').order('created_at',{ascending:false}).limit(300);if(error)throw error;state.teams=data||[];const q=($('admin-team-search').value||'').trim().toLowerCase();const filtered=state.teams.filter(t=>!q||String(t.name).toLowerCase().includes(q));const counts=await Promise.all(filtered.map(async t=>{const r=await adminDb.from('team_members').select('id',{count:'exact',head:true}).eq('team_id',t.id).in('status',['pending','approved']);return {id:t.id,count:r.count||0};}));const map=Object.fromEntries(counts.map(x=>[x.id,x.count]));$('all-teams-table').innerHTML=filtered.map(t=>`<tr><td><div class="member-cell">${t.logo_url?`<img class="mini-logo" src="${escapeHtml(t.logo_url)}">`:`<div class="mini-logo ph">7U</div>`}<strong>${escapeHtml(t.name)}</strong></div></td><td>${map[t.id]||0} / 2</td><td><span class="badge ${t.status==='active'?'badge-green':'badge-red'}">${escapeHtml(t.status)}</span></td><td><button class="btn btn-dark btn-small" data-team-toggle="${t.id}" data-next="${t.status==='active'?'banned':'active'}">${t.status==='active'?'BAN':'UNBAN'}</button></td></tr>`).join('')||'<tr><td colspan="4">No teams found.</td></tr>';}
async function loadAdminPractice(){const {data,error}=await adminDb.from('practice_challenges').select('*').order('created_at',{ascending:false}).limit(300);if(error)throw error;state.adminChallenges=data||[];$('admin-practice-table').innerHTML=state.adminChallenges.map(c=>`<tr><td>${escapeHtml(c.team_name)}</td><td>${escapeHtml(c.match_type)}</td><td>${escapeHtml(c.format)}</td><td>${escapeHtml(formatDateTime(c.match_time))}</td><td><span class="badge ${c.status==='open'?'badge-green':'badge-gray'}">${escapeHtml(c.status)}</span></td><td><button class="btn btn-dark btn-small" data-challenge-toggle="${c.id}" data-next="${c.status==='open'?'closed':'open'}">${c.status==='open'?'CLOSE':'REOPEN'}</button></td></tr>`).join('')||'<tr><td colspan="6">No challenges.</td></tr>';}
async function loadAdminRecruitment(){const {data,error}=await adminDb.from('recruitment_posts').select('*').order('created_at',{ascending:false}).limit(300);if(error)throw error;state.adminRecruitment=data||[];$('admin-recruitment-table').innerHTML=state.adminRecruitment.map(r=>`<tr><td>${escapeHtml(r.team_name||r.player_ign||'—')}</td><td>${escapeHtml(String(r.listing_type||'').replaceAll('_',' '))}</td><td>${escapeHtml(Array.isArray(r.looking_for)?r.looking_for.join(', '):cleanText(r.looking_for))}</td><td><span class="badge ${r.status==='open'?'badge-green':'badge-gray'}">${escapeHtml(r.status)}</span></td><td><button class="btn btn-dark btn-small" data-recruit-toggle="${r.id}" data-next="${r.status==='open'?'closed':'open'}">${r.status==='open'?'CLOSE':'REOPEN'}</button></td></tr>`).join('')||'<tr><td colspan="5">No recruitment posts.</td></tr>';}

async function approveMember(id,status){try{const {data:profile,error:pe}=await adminDb.from('profiles').select('id,team_name,role').eq('id',id).maybeSingle();if(pe)throw pe;if(!profile)throw new Error('Registration not found.');const {error}=await adminDb.from('profiles').update({status}).eq('id',id);if(error)throw error;const team=await adminDb.from('teams').select('id').ilike('name',profile.team_name).maybeSingle();if(team.data?.id){await adminDb.from('team_members').update({status}).eq('user_id',id).eq('team_id',team.data.id);}toast(`Registration ${status}.`);await loadAdminRegistrations();}catch(err){showStatus('admin-status','error',err.message||'Could not update registration.');}}
async function toggleTeam(id,status){try{const {error}=await adminDb.from('teams').update({status}).eq('id',id);if(error)throw error;toast(`Team ${status}.`);await loadAdminTeams();}catch(err){showStatus('admin-status','error',err.message||'Could not update team.');}}
async function togglePost(table,id,status){try{const {error}=await adminDb.from(table).update({status}).eq('id',id);if(error)throw error;toast(`Post ${status}.`);if(table==='practice_challenges')await loadAdminPractice();else await loadAdminRecruitment();}catch(err){showStatus('admin-status','error',err.message||'Could not update post.');}}

/* ---------------- Events ---------------- */
$('login-form').addEventListener('submit',handleLogin);
$('register-form').addEventListener('submit',handleRegister);
$('forgot-password').addEventListener('click',forgotPassword);
$('challenge-form').addEventListener('submit',submitChallenge);
$('recruitment-form').addEventListener('submit',submitRecruitment);
$('recruitment-type').addEventListener('change',toggleRecruitmentMode);
$('nav-register').addEventListener('click',()=>openView('register'));
$('back-login').addEventListener('click',()=>openView('public'));
$('nav-admin').addEventListener('click',()=>openAdmin().catch(e=>toast(e.message||'Admin access failed.','error')));
$('nav-logout').addEventListener('click',async()=>{await db.auth.signOut();await adminDb.auth.signOut();location.reload();});
$('admin-login-form').addEventListener('submit',handleAdminLogin);
$('admin-back').addEventListener('click',()=>openView('public'));
$('admin-logout').addEventListener('click',async()=>{await adminDb.auth.signOut();state.adminUser=null;state.adminOk=false;openView('public');toast('Admin logged out.');});

document.querySelectorAll('[data-member-section]').forEach(btn=>btn.addEventListener('click',()=>setMemberSection(btn.dataset.memberSection)));
document.querySelectorAll('[data-admin-section]').forEach(btn=>btn.addEventListener('click',()=>loadAdminSection(btn.dataset.adminSection).catch(e=>showStatus('admin-status','error',e.message||'Admin section failed.'))));

document.addEventListener('click',async(e)=>{
  const contact=e.target.closest('[data-contact]');if(contact){const n=normalizeContact(contact.dataset.contact);if(n)window.open(`https://wa.me/${n}`,'_blank','noopener');}
  const approve=e.target.closest('[data-approve]');if(approve)await approveMember(approve.dataset.approve,'approved');
  const reject=e.target.closest('[data-reject]');if(reject)await approveMember(reject.dataset.reject,'rejected');
  const team=e.target.closest('[data-team-toggle]');if(team)await toggleTeam(team.dataset.teamToggle,team.dataset.next);
  const ch=e.target.closest('[data-challenge-toggle]');if(ch)await togglePost('practice_challenges',ch.dataset.challengeToggle,ch.dataset.next);
  const rec=e.target.closest('[data-recruit-toggle]');if(rec)await togglePost('recruitment_posts',rec.dataset.recruitToggle,rec.dataset.next);
});
$('admin-team-search').addEventListener('input',()=>loadAdminTeams().catch(e=>showStatus('admin-status','error',e.message||'Search failed.')));

toggleRecruitmentMode();
renderRules();

(async()=>{try{await hydrateMemberSession();}catch(e){console.log('Public state:',e.message);openView('public');$('nav-register').classList.remove('hidden');$('nav-logout').classList.add('hidden');}})();
