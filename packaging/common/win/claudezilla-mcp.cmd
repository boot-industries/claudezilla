@echo off
rem Launch the MCP server. %CLZ_RUNTIME% wins, then bun, then node.
rem `exit /b` without an argument preserves the real errorlevel; %ERRORLEVEL%
rem inside a parenthesised block would expand when the block is parsed.
setlocal
set "CLZ_ROOT=%~dp0.."
if defined CLZ_RUNTIME if exist "%CLZ_RUNTIME%" (
    "%CLZ_RUNTIME%" "%CLZ_ROOT%\lib\mcp\server.js" %*
    exit /b
)
where /q bun.exe && (
    bun "%CLZ_ROOT%\lib\mcp\server.js" %*
    exit /b
)
node "%CLZ_ROOT%\lib\mcp\server.js" %*
exit /b
