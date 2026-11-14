@echo off
chcp 65001 >nul
title RelBrain - serveur local
cd /d "%~dp0"
if not exist node_modules (
  echo Installation des dependances, une seule fois...
  call npm install
)
start "" http://localhost:3005
call npm run dev
pause
