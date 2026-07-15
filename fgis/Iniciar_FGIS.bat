@echo off
setlocal enabledelayedexpansion
title FGIS Apui - Launcher
cd /d "%~dp0"

echo ============================================
echo   FGIS Apui - Planejador de Voo Inteligente
echo ============================================
echo.

REM --- Detectar o comando Python disponivel no sistema ---
where python >nul 2>nul
if %errorlevel%==0 (
    set "PYCMD=python"
) else (
    where py >nul 2>nul
    if %errorlevel%==0 (
        set "PYCMD=py"
    ) else (
        echo ERRO: Python nao foi encontrado no PATH deste computador.
        echo Instale o Python ^(python.org^) e tente novamente,
        echo ou verifique se a opcao "Add python.exe to PATH" foi marcada na instalacao.
        echo.
        pause
        exit /b 1
    )
)

echo Iniciando servidor local com "%PYCMD% server.py"...
start "FGIS Apui - Servidor (nao feche sem necessidade)" cmd /k %PYCMD% server.py

echo Aguardando o servidor subir...
timeout /t 2 /nobreak >nul

echo Abrindo o FGIS no navegador (http://localhost:8001)...
start "" http://localhost:8001

echo.
echo ============================================
echo Pronto! O FGIS deve abrir automaticamente no navegador.
echo.
echo Para ENCERRAR o servidor, feche a janela
echo "FGIS Apui - Servidor (nao feche sem necessidade)".
echo ============================================
echo.
pause
