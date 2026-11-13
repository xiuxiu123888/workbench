@echo off
setlocal EnableExtensions
set "ROOT=d:\project\workbench"
set "LOG=%ROOT%\data\feishu-push.log"
set "NODE=D:\nvm\nodejs\node.exe"
set "TSX=%ROOT%\node_modules\tsx\dist\cli.mjs"
set "SCRIPT=%ROOT%\scripts\push-daily-feishu.ts"
cd /d "%ROOT%"
if not exist "%ROOT%\data" mkdir "%ROOT%\data"
echo ===== %date% %time% 开始推送昨日有推荐文章的网站汇总 =====>> "%LOG%"
if not exist "%NODE%" (
  echo 找不到 node: %NODE%>> "%LOG%"
  exit /b 1
)
if not exist "%TSX%" (
  echo 找不到 tsx: %TSX%>> "%LOG%"
  exit /b 1
)
"%NODE%" "%TSX%" "%SCRIPT%" --yesterday >> "%LOG%" 2>&1
set "CODE=%ERRORLEVEL%"
echo ===== %date% %time% 结束 code=%CODE% =====>> "%LOG%"
exit /b %CODE%
