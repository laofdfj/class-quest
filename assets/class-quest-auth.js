/* Class Quest account and cloud layer */
const SUPABASE_URL = "https://mpjvlixwhztzoouyjghu.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_OnKfDj8ZLZwnh4QY6YeHeQ_Y11K5xqa";
const cloud = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let currentTeacher = null;
let studentMode = false;
let studentSession = null;
let studentView = null;
let preStudentData = null;
let cloudReady = false;
let cloudConflict = false;
let cloudSaveTimer = null;
let cloudSaving = false;
let lastCloudUpdatedAt = null;
let cloudChannel = null;

function generateClassCode(data = d) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    code = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
  } while ((data.classes || []).some(item => item.code === code));
  return code;
}
function ensureClassCodes(data) {
  (data.classes || []).forEach(item => { if (!item.code) item.code = generateClassCode(data); });
  return data;
}
function setAuthMessage(message, error = true) {
  const el = document.getElementById("authMessage");
  if (!el) return;
  el.textContent = message || "";
  el.style.color = error ? "#a45c81" : "#4f9a7b";
}
function selectAuthTab(tab) {
  const teacher = tab === "teacher";
  document.getElementById("teacherAuth").hidden = !teacher;
  document.getElementById("studentAuth").hidden = teacher;
  document.getElementById("teacherTab").classList.toggle("active", teacher);
  document.getElementById("studentTab").classList.toggle("active", !teacher);
  setAuthMessage("");
}
function showAuth(tab = "teacher") {
  document.body.classList.remove("teacher-mode", "student-mode");
  document.getElementById("authScreen").hidden = false;
  document.getElementById("studentPortal").hidden = true;
  selectAuthTab(tab);
}
async function setTeacherSession(user) {
  currentTeacher = user;
  studentMode = false;
  studentSession = null;
  studentView = null;
  document.body.classList.remove("student-mode");
  document.body.classList.add("teacher-mode");
  document.getElementById("authScreen").hidden = true;
  document.getElementById("studentPortal").hidden = true;
  cloudReady = false;
  cloudConflict = false;
  KEY = "classquest-data-v1:" + user.id;

  let localData = read();
  let legacyData = null;
  try { legacyData = JSON.parse(localStorage.getItem("classquest-data-v1") || "null"); } catch (_) {}
  if (!localData.classes.length && !localData.students.length &&
      legacyData && (legacyData.classes?.length || legacyData.students?.length)) {
    localData = normalizeStudentStats(legacyData);
  }

  const { data: remote, error } = await cloud.from("teacher_workspaces")
    .select("data,updated_at").eq("teacher_id", user.id).maybeSingle();
  if (error) {
    setAuthMessage("Не удалось загрузить облачные данные: " + error.message);
    document.getElementById("cloudStatus").textContent = "Облако недоступно";
    return;
  }

  let needsSave = false;
  if (remote?.data) {
    d = normalizeStudentStats(remote.data);
    const before = (d.classes || []).filter(item => !item.code).length;
    ensureClassCodes(d);
    needsSave = before > 0;
    lastCloudUpdatedAt = remote.updated_at;
    localStorage.setItem(KEY, JSON.stringify(d));
  } else {
    d = ensureClassCodes(localData);
    lastCloudUpdatedAt = null;
    localStorage.setItem(KEY, JSON.stringify(d));
  }

  cloudReady = true;
  render();
  showPage("home");
  document.getElementById("cloudStatus").textContent = "☁ Синхронизация включена";
  subscribeWorkspace();
  if (!remote?.data || needsSave) await saveWorkspace();
}
async function saveWorkspace() {
  if (!currentTeacher || studentMode || !cloudReady || cloudConflict) return;
  cloudSaving = true;
  const now = new Date().toISOString();
  const payload = {
    teacher_id: currentTeacher.id,
    data: d,
    class_codes: (d.classes || []).map(item => item.code).filter(Boolean),
    updated_at: now
  };
  let result;
  if (lastCloudUpdatedAt) {
    result = await cloud.from("teacher_workspaces")
      .update({ data: payload.data, class_codes: payload.class_codes, updated_at: now })
      .eq("teacher_id", currentTeacher.id).eq("updated_at", lastCloudUpdatedAt)
      .select("updated_at").maybeSingle();
  } else {
    result = await cloud.from("teacher_workspaces").insert(payload).select("updated_at").maybeSingle();
  }
  cloudSaving = false;
  if (result.error) {
    document.getElementById("cloudStatus").textContent = "Ошибка облака";
    msg("Не удалось сохранить в облако: " + result.error.message);
    return;
  }
  if (!result.data) {
    cloudConflict = true;
    document.getElementById("cloudStatus").textContent = "Изменения на другом устройстве";
    msg("Данные изменились на другом устройстве. Обнови страницу, чтобы загрузить актуальную версию.");
    return;
  }
  lastCloudUpdatedAt = result.data.updated_at;
  document.getElementById("cloudStatus").textContent = "☁ Сохранено";
}
function queueCloudSave() {
  if (!currentTeacher || studentMode || !cloudReady || cloudConflict) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => saveWorkspace(), 500);
}
async function reloadWorkspaceFromCloud() {
  if (!currentTeacher || studentMode || cloudSaving || cloudSaveTimer) return;
  const { data, error } = await cloud.from("teacher_workspaces")
    .select("data,updated_at").eq("teacher_id", currentTeacher.id).maybeSingle();
  if (error || !data) return;
  d = normalizeStudentStats(data.data);
  ensureClassCodes(d);
  lastCloudUpdatedAt = data.updated_at;
  cloudConflict = false;
  localStorage.setItem(KEY, JSON.stringify(d));
  render();
  document.getElementById("cloudStatus").textContent = "☁ Обновлено с другого устройства";
}
function subscribeWorkspace() {
  if (cloudChannel) cloud.removeChannel(cloudChannel);
  cloudChannel = cloud.channel("teacher-workspace-" + currentTeacher.id)
    .on("postgres_changes", {
      event: "UPDATE", schema: "public", table: "teacher_workspaces",
      filter: "teacher_id=eq." + currentTeacher.id
    }, payload => {
      if (cloudSaving || !payload.new?.updated_at || payload.new.updated_at === lastCloudUpdatedAt) return;
      reloadWorkspaceFromCloud();
    }).subscribe();
}
async function teacherLogin() {
  const email = document.getElementById("teacherEmail").value.trim();
  const password = document.getElementById("teacherPassword").value;
  if (!email || !password) return setAuthMessage("Введи email и пароль.");
  setAuthMessage("Входим…", false);
  const { data, error } = await cloud.auth.signInWithPassword({ email, password });
  if (error) return setAuthMessage(error.message);
  await setTeacherSession(data.user);
}
async function teacherRegister() {
  const email = document.getElementById("teacherEmail").value.trim();
  const password = document.getElementById("teacherPassword").value;
  if (!email || password.length < 8) return setAuthMessage("Укажи email и пароль не короче 8 символов.");
  setAuthMessage("Создаём аккаунт…", false);
  const { data, error } = await cloud.auth.signUp({ email, password });
  if (error) return setAuthMessage(error.message);
  if (data.session) await setTeacherSession(data.user);
  else setAuthMessage("Аккаунт создан. Подтверди email по ссылке из письма, затем войди.", false);
}
async function studentLogin() {
  const classCodeValue = document.getElementById("studentClassCode").value.trim().toUpperCase();
  const name = document.getElementById("studentName").value.trim().toLocaleLowerCase("ru-RU");
  if (!classCodeValue || !name) return setAuthMessage("Введи код класса и имя.");
  setAuthMessage("Ищем твой кабинет…", false);
  const { data, error } = await cloud.functions.invoke("student-portal", {
    body: { action: "login", classCode: classCodeValue, name }
  });
  if (error) return setAuthMessage(error.message || "Не удалось войти.");
  if (data?.error) return setAuthMessage(data.error);
  preStudentData = structuredClone(d);
  studentSession = { classCode: classCodeValue, name };
  renderStudentPortal(data);
}
function renderStudentPortal(snapshot) {
  studentMode = true;
  studentView = snapshot;
  d = {
    settings: { cap: 50, budget: snapshot.settings?.budget ?? 1500 },
    classes: [snapshot.class], students: [snapshot.student],
    ledger: snapshot.ledger || [], orders: snapshot.orders || [],
    actions: [], prizes: snapshot.prizes || []
  };
  document.body.classList.remove("teacher-mode");
  document.body.classList.add("student-mode");
  document.getElementById("authScreen").hidden = true;
  document.getElementById("studentPortal").hidden = false;

  const student = snapshot.student;
  const achievements = achievementList(student);
  const unlocked = achievements.filter(item => item.progress >= item.goal).length;
  document.getElementById("studentWelcome").textContent = "Привет, " + student.name + "! 🐾";
  document.getElementById("studentClassName").textContent = snapshot.class.name + " · твой личный кабинет";
  document.getElementById("studentStats").innerHTML =
    '<div class="stat"><small>Баланс</small><strong>' + student.balance + ' XP</strong></div>' +
    '<div class="stat"><small>Всего заработано</small><strong>' + earnedXP(student) + ' XP</strong></div>' +
    '<div class="stat"><small>Достижения</small><strong>' + unlocked + ' / ' + achievements.length + '</strong></div>';

  document.getElementById("studentAchievementCount").textContent = unlocked + " открыто из " + achievements.length;
  document.getElementById("studentAchievements").innerHTML = achievements.map(item => {
    const done = item.progress >= item.goal;
    const pct = Math.min(100, Math.round(item.progress / item.goal * 100));
    return '<article class="achievement-card ' + (done ? "" : "locked") + '">' +
      '<img src="' + catSticker(item.sticker) + '" alt=""><div class="achievement-info"><b>' + safe(item.title) +
      '</b><p>' + safe(item.desc) + '</p><small>' + (done ? "Открыто!" : Math.min(item.progress, item.goal) + " / " + item.goal) +
      '</small><div class="achievement-progress"><i style="width:' + pct + '%"></i></div></div>' +
      '<span class="achievement-state">' + (done ? "✓" : "🔒") + "</span></article>";
  }).join("");

  document.getElementById("studentBalance").textContent = "Баланс: " + student.balance + " XP";
  document.getElementById("studentProducts").innerHTML = (snapshot.prizes || []).map((prize, index) =>
    '<div class="product ' + (prize[5] === 0 ? "unavailable" : "") + '">' +
    (prize[6] ? '<img class="product-photo" src="' + safe(prize[6]) + '" alt="' + safe(prize[1]) + '">' :
      '<div class="emoji-art">' + safe(prize[0] || "🎁") + "</div>") +
    "<h4>" + safe(prize[1]) + "</h4><p>" + safe(prize[2]) + "</p><b>" + prize[3] + " XP</b>" +
    '<div class="muted">' + (prize[5] === -1 ? "∞ без ограничений" : prize[5] === 0 ? "Нет в наличии" : "Осталось: " + prize[5]) + "</div>" +
    '<button class="btn" ' + (prize[5] === 0 || student.balance < prize[3] ? "disabled" : "") +
    ' onclick="studentBuy(' + index + ')">Купить</button></div>'
  ).join("") || '<p class="muted">Пока нет призов.</p>';

  const history = (snapshot.ledger || []).slice(0, 20);
  document.getElementById("studentHistory").innerHTML = history.map(entry =>
    '<div class="row"><div class="avatar">🐾</div><div class="rowinfo"><b>' + safe(entry.reason || "Изменение XP") +
    "</b><small>" + new Date(entry.date).toLocaleString("ru-RU") + "</small></div><span class=\"xp " +
    (entry.points < 0 ? "negative" : "") + '\">' + (entry.points > 0 ? "+" : "") + entry.points + " XP</span></div>"
  ).join("") || '<div class="student-history-empty">История пока пуста.</div>';
}
function openPurchaseConfirm(title, description, onConfirm) {
  const back = document.getElementById("modal");
  const form = document.getElementById("form");
  const save = document.getElementById("save");
  document.getElementById("modtitle").textContent = title;
  form.innerHTML = '<div class="purchase-confirm"><p>' + safe(description) +
    '</p><p class="muted">После подтверждения XP спишутся, а заказ появится у преподавателя.</p></div>';
  document.getElementById("cancel").textContent = "Отмена";
  save.textContent = "Купить";
  back.classList.add("show");
  save.onclick = () => {
    back.classList.remove("show");
    save.textContent = "Сохранить";
    document.getElementById("cancel").textContent = "Отмена";
    onConfirm();
  };
}
async function studentBuy(index) {
  const prize = studentView?.prizes?.[index];
  if (!prize || !studentView?.student) return;
  openPurchaseConfirm("Подтвердить покупку", prize[1] + " · " + prize[3] + " XP", async () => {
    const { data, error } = await cloud.functions.invoke("student-portal", {
      body: { action: "purchase", classCode: studentSession.classCode, name: studentSession.name, prizeIndex: index }
    });
    if (error) return msg(error.message || "Не удалось оформить покупку");
    if (data?.error) return msg(data.error);
    renderStudentPortal(data);
    msg("Заказ отправлен преподавателю!");
  });
}
async function refreshStudent() {
  if (!studentSession) return;
  const { data, error } = await cloud.functions.invoke("student-portal", {
    body: { action: "refresh", classCode: studentSession.classCode, name: studentSession.name }
  });
  if (error || data?.error) return msg(data?.error || error.message || "Не удалось обновить данные");
  renderStudentPortal(data);
  msg("Данные обновлены");
}
function logoutStudent() {
  studentMode = false;
  studentSession = null;
  studentView = null;
  if (currentTeacher) {
    d = preStudentData || d;
    document.body.classList.remove("student-mode");
    document.body.classList.add("teacher-mode");
    document.getElementById("studentPortal").hidden = true;
    render();
    showPage("home");
  } else {
    d = preStudentData || normalizeStudentStats(structuredClone(initial));
    showAuth("student");
  }
}
async function logoutTeacher() {
  await cloud.auth.signOut();
  currentTeacher = null;
  cloudReady = false;
  cloudConflict = false;
  lastCloudUpdatedAt = null;
  if (cloudChannel) cloud.removeChannel(cloudChannel);
  showAuth("teacher");
}
async function initAuth() {
  document.getElementById("teacherTab").onclick = () => selectAuthTab("teacher");
  document.getElementById("studentTab").onclick = () => selectAuthTab("student");
  document.getElementById("teacherLogin").onclick = teacherLogin;
  document.getElementById("teacherRegister").onclick = teacherRegister;
  document.getElementById("studentLogin").onclick = studentLogin;
  document.getElementById("studentLogout").onclick = logoutStudent;
  document.getElementById("studentRefresh").onclick = refreshStudent;
  document.getElementById("teacherLogout").onclick = logoutTeacher;
  const { data } = await cloud.auth.getSession();
  if (data.session?.user) await setTeacherSession(data.session.user);
  else showAuth("teacher");
}
initAuth();
