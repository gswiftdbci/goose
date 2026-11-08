@echo off
set GOOSED_HOST=127.0.0.1
set GOOSED_PORT=3284
set /p GOOSE_SERVER_SECRET_KEY=<"C:\Users\nepha\GooseRemote\dibputer.secret"
set WEBUI_PORT=3285
node "%~dp0web-test-server.js"
