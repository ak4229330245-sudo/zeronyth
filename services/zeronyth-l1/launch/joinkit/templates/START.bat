@echo off
chcp 65001 >nul
title ZERONYTH 参加アプリ
cd /d "%~dp0"
rem 1) Node.js があればそれを使う。無ければ公式サイトから自動で取得（このフォルダ内だけ。PCには何もインストールしません）
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if not exist "runtime\node.exe" (
    echo Node.js を準備しています（初回だけ・約30MB）...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\get-node.ps1"
    if errorlevel 1 ( echo Node.js の準備に失敗しました。インターネット接続を確認してください。 & pause & exit /b 1 )
  )
  set "NODE=%~dp0runtime\node.exe"
)
echo ZERONYTH 参加アプリを起動します。ブラウザに状態ページが開きます。
echo このウィンドウを閉じると停止します。
start "" /low /b /wait "%NODE%" app\zeronyth-participant.mjs
pause
