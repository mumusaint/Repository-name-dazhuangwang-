document.addEventListener("DOMContentLoaded", async () => {
  renderHeader("login");
  await importAccountsFromFile();
  if (typeof initAccounts === "function") await initAccounts();
  refreshUI();
});

function refreshUI() {
  const user = getCurrentUser();
  document.getElementById("currentUser").textContent = user ? user : "未登录";
  document.getElementById("logoutBtn").style.display = user ? "inline-flex" : "none";

  const accounts = getAllAccounts();
  const names = Object.keys(accounts);
  if (names.length === 0) {
    document.getElementById("accountList").innerHTML =
      `<span style="color:var(--text-muted);font-size:0.85rem">暂无账号</span>`;
    return;
  }
  document.getElementById("accountList").innerHTML = names.map((name) => {
    const count = (accounts[name].owned || []).length;
    const active = name === user ? "active" : "";
    return `<div class="comp-card ${active}" style="margin-bottom:0.35rem" onclick="switchTo('${name}')">
      <div class="comp-body">
        <div class="comp-name">${name}</div>
        <div style="font-size:0.8rem;color:var(--text-muted)">持有 ${count} 名角色</div>
      </div>
    </div>`;
  }).join("");
}

function doLogin() {
  const name = document.getElementById("usernameInput").value.trim();
  if (!name) return showToast("请输入账号名", "info");
  if (!accountExists(name)) return showToast(`账号「${name}」不存在，请先创建`, "error");
  login(name);
  refreshUI();
  showToast(`已登录：${name}`, "success");
}

function switchTo(name) {
  login(name);
  refreshUI();
  showToast(`已切换到账号：${name}`, "success");
}

function doLogout() {
  logout();
  refreshUI();
  showToast("已退出登录", "info");
}

function doCreate() {
  const name = document.getElementById("newUserInput").value.trim();
  if (!name) return showToast("请输入账号名", "info");
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,16}$/.test(name)) {
    return showToast("账号名 2-16 位，支持中文、英文字母、数字、下划线", "error");
  }
  if (!createAccount(name)) return showToast("账号已存在", "error");
  login(name);
  document.getElementById("newUserInput").value = "";
  refreshUI();
  showToast(`账号「${name}」已创建并登录`, "success");
}
