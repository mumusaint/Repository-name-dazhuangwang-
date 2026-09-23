# 推送「打桩网」到 GitHub 并创建仓库
# 运行:  powershell -ExecutionPolicy Bypass -File push-to-github.ps1

$ErrorActionPreference = "Stop"

# ====== 配置(按需修改) ======
$RepoName      = "dazhuangwang"   # 仓库名,建议用英文
$IsPrivate     = $false            # $true=私有; $false=公开(GitHub Pages 免费版需公开)
$ManualRepoUrl = ""                # 不装 gh 时:手动在 https://github.com/new 建空仓库后,把 HTTPS 地址填这里
# ==============================

Set-Location "c:\Users\赵杭生\Desktop\打桩网"

# 0. 检查 git 身份
if (-not (git config user.name) -or -not (git config user.email)) {
    Write-Host "未配置 git 提交身份,请先运行:" -ForegroundColor Red
    Write-Host "  git config --global user.name  `"你的名字`""
    Write-Host "  git config --global user.email `"你的邮箱`""
    exit 1
}

# 1. 初始化 git
if (-not (Test-Path ".git")) {
    git init
    Write-Host "[1/4] git 初始化完成" -ForegroundColor Green
} else {
    Write-Host "[1/4] 已是 git 仓库,跳过 init" -ForegroundColor Green
}
git branch -M main 2>$null

# 2. 暂存并提交
git add -A
if (git status --porcelain) {
    git commit -m "feat: 打桩网静态站点,适配 GitHub Pages 部署"
    Write-Host "[2/4] 已提交" -ForegroundColor Green
} else {
    Write-Host "[2/4] 无变更可提交" -ForegroundColor Yellow
}

# 3. 创建/关联远程仓库并推送
if (Get-Command gh -ErrorAction SilentlyContinue) {
    Write-Host "[3/4] 检测到 gh CLI,自动创建仓库 $RepoName 并推送..." -ForegroundColor Cyan
    if ($IsPrivate) { $vis = "--private" } else { $vis = "--public" }
    gh repo create $RepoName $vis --source=. --remote=origin --push
} else {
    if (-not $ManualRepoUrl) {
        Write-Host "[3/4] 未安装 gh CLI 且未填写 `$ManualRepoUrl" -ForegroundColor Red
        Write-Host "  方案A(推荐): 先装 gh 再重跑本脚本:" -ForegroundColor Yellow
        Write-Host "      winget install --id GitHub.cli --source winget"
        Write-Host "      gh auth login"
        Write-Host "  方案B: 浏览器打开 https://github.com/new 建一个空仓库(不要勾选 README/.gitignore/License)," -ForegroundColor Yellow
        Write-Host "      复制 HTTPS 地址(形如 https://github.com/用户名/dazhuangwang.git),"
        Write-Host "      填到脚本顶部 `$ManualRepoUrl 变量,再重跑本脚本"
        exit 1
    }
    git remote remove origin 2>$null
    git remote add origin $ManualRepoUrl
    Write-Host "[3/4] 已关联远程仓库" -ForegroundColor Green
    git push -u origin main
}

# 4. 结果提示
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "[4/4] 推送成功!" -ForegroundColor Green
    Write-Host "      GitHub Pages 部署将由 .github/workflows/deploy.yml 自动触发。" -ForegroundColor Cyan
    Write-Host "      首次需到 仓库 Settings -> Pages -> Source 选「GitHub Actions」。" -ForegroundColor Cyan
    Write-Host "      部署完成后访问地址形如: https://<你的用户名>.github.io/dazhuangwang/" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "[4/4] 推送失败,请查看上面的错误信息" -ForegroundColor Red
    Write-Host "      常见原因: 未登录(gh auth login)/ 仓库地址错 / 需 Personal Access Token 认证" -ForegroundColor Yellow
}
