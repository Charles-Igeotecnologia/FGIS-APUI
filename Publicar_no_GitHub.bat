@echo off
setlocal enabledelayedexpansion
title Publicar no GitHub - Projeto Apui
cd /d "%~dp0"

set "REPO_URL=https://github.com/Charles-Igeotecnologia/FGIS-APUI.git"
set "LOGFILE=%~dp0publicar_log.txt"

echo ============================================
echo   Publicar Projeto Apui no GitHub
echo ============================================
echo Rodando... isso pode levar alguns segundos.
echo Tudo o que acontecer sera gravado em:
echo %LOGFILE%
echo (o arquivo abre sozinho no Bloco de Notas ao final)
echo ============================================
echo.

(
    echo ============================================
    echo   Log de publicacao - %date% %time%
    echo ============================================
    echo Pasta local : %cd%
    echo Repositorio : %REPO_URL%
    echo.

    where git
    echo [errorlevel do "where git": !errorlevel!]
    if not !errorlevel!==0 (
        echo ERRO: Git nao foi encontrado no PATH deste computador.
        echo Instale em https://git-scm.com/download/win e tente novamente.
        goto :FIM
    )

    echo.
    if not exist ".git" (
        echo Inicializando repositorio Git local...
        git init
        git branch -M main
    ) else (
        echo Repositorio Git local ja existe nesta pasta, reaproveitando.
    )

    echo.
    git remote get-url origin
    if !errorlevel!==0 (
        echo Atualizando URL do remoto "origin"...
        git remote set-url origin "%REPO_URL%"
    ) else (
        echo Adicionando remoto "origin"...
        git remote add origin "%REPO_URL%"
    )

    echo.
    echo Adicionando arquivos (respeitando o .gitignore)...
    git add -A

    echo.
    git diff --cached --quiet
    if !errorlevel!==0 (
        echo Nenhuma mudanca nova para commitar.
    ) else (
        set "COMMITMSG=Atualizacao do FGIS Apui - %date% %time%"
        echo Commitando com a mensagem: !COMMITMSG!
        git commit -m "!COMMITMSG!"
        echo [errorlevel do commit: !errorlevel!]
    )

    echo.
    echo Buscando historico do repositorio remoto...
    git fetch origin
    echo [errorlevel do fetch: !errorlevel!]

    git show-ref --verify --quiet refs/remotes/origin/main
    if !errorlevel!==0 (
        echo O remoto ja possui commits em "main". Mesclando automaticamente...
        git pull origin main --allow-unrelated-histories --no-edit
        echo [errorlevel do pull: !errorlevel!]
    ) else (
        echo Remoto ainda nao tem commits em "main" ^(ou main nao existe ainda no remoto^).
    )

    echo.
    echo Enviando para o GitHub...
    git push -u origin main
    echo [errorlevel do push: !errorlevel!]

    echo.
    echo ============================================
    echo FIM DO SCRIPT
    echo ============================================

    :FIM
) > "%LOGFILE%" 2>&1

echo.
echo Processo finalizado. Abrindo o log no Bloco de Notas...
start "" notepad "%LOGFILE%"
echo.
pause
