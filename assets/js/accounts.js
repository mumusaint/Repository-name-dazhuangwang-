const STORAGE_ACCOUNTS = "dazhuang_accounts";
const STORAGE_CURRENT = "dazhuang_current_user";

function getAllAccounts() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_ACCOUNTS) || "{}");
  } catch {
    return {};
  }
}

function saveAllAccounts(accounts) {
  localStorage.setItem(STORAGE_ACCOUNTS, JSON.stringify(accounts));
}

function getCurrentUser() {
  return localStorage.getItem(STORAGE_CURRENT) || null;
}

function setCurrentUser(username) {
  if (username) localStorage.setItem(STORAGE_CURRENT, username);
  else localStorage.removeItem(STORAGE_CURRENT);
}

function createAccount(username) {
  const accounts = getAllAccounts();
  if (accounts[username]) return false;
  accounts[username] = { owned: [], team: [], createdAt: Date.now() };
  saveAllAccounts(accounts);
  return true;
}

function accountExists(username) {
  return !!getAllAccounts()[username];
}

function getAccountData(username) {
  return getAllAccounts()[username] || null;
}

function updateAccount(username, data) {
  const accounts = getAllAccounts();
  if (!accounts[username]) return;
  accounts[username] = { ...accounts[username], ...data };
  saveAllAccounts(accounts);
}

function login(username) {
  if (!accountExists(username)) return false;
  setCurrentUser(username);
  syncOwnedToLegacy(getAccountData(username).owned || []);
  syncTeamToLegacy(getAccountData(username).team || []);
  return true;
}

function logout() {
  persistCurrentAccount();
  setCurrentUser(null);
}

function persistCurrentAccount() {
  const user = getCurrentUser();
  if (!user) return;
  updateAccount(user, {
    owned: getOwnedRaw(),
    team: getTeamRaw(),
  });
}

function syncOwnedToLegacy(owned) {
  localStorage.setItem(STORAGE_OWNED, JSON.stringify(owned));
}

function syncTeamToLegacy(team) {
  localStorage.setItem(STORAGE_TEAM, JSON.stringify(team));
}

function getOwnedRaw() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_OWNED) || "[]");
  } catch {
    return [];
  }
}

function getTeamRaw() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_TEAM) || "[]");
  } catch {
    return [];
  }
}

function setOwnedWithAccount(list) {
  localStorage.setItem(STORAGE_OWNED, JSON.stringify(list));
  const user = getCurrentUser();
  if (user) updateAccount(user, { owned: list });
}

function setTeamWithAccount(list) {
  localStorage.setItem(STORAGE_TEAM, JSON.stringify(list));
  const user = getCurrentUser();
  if (user) updateAccount(user, { team: list });
}

async function importAccountsFromFile() {
  try {
    const res = await fetch(`${getSiteBase()}/accounts.json`);
    if (!res.ok) return;
    const data = await res.json();
    const accounts = getAllAccounts();
    let changed = false;
    for (const [name, acc] of Object.entries(data)) {
      const revision = acc.updatedAt || acc.owned?.length || 0;
      if (!accounts[name]) {
        accounts[name] = {
          owned: acc.owned || [],
          team: acc.team || [],
          settings: acc.settings || {},
          createdAt: Date.now(),
          imported: true,
          serverRevision: revision,
        };
        changed = true;
        continue;
      }
      if (accounts[name].imported && accounts[name].serverRevision !== revision) {
        accounts[name].owned = acc.owned || [];
        accounts[name].settings = { ...accounts[name].settings, ...(acc.settings || {}) };
        accounts[name].serverRevision = revision;
        changed = true;
      }
    }
    if (changed) saveAllAccounts(accounts);
  } catch (e) {
    console.warn("accounts.json 未加载", e);
  }
}

async function initAccounts() {
  await importAccountsFromFile();
  const user = getCurrentUser();
  if (user && accountExists(user)) {
    const acc = getAccountData(user);
    syncOwnedToLegacy(acc.owned || []);
    syncTeamToLegacy(acc.team || []);
    return user;
  }
  if (accountExists("mumu")) {
    login("mumu");
    return "mumu";
  }
  return null;
}

function renderAccountBadge() {
  const user = getCurrentUser();
  const el = document.getElementById("account-badge");
  if (!el) return;
  el.innerHTML = user
    ? `<a href="${siteUrl("login/index.html")}" class="account-link">账号 ${user}</a>`
    : `<a href="${siteUrl("login/index.html")}" class="account-link">登录</a>`;
}
