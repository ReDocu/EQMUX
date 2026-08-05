@echo off
rem ---------------------------------------------------------------------------
rem Gate A-2 visual-check shell wrapper.
rem
rem Usage:  $env:EQMUX_SHELL = "<absolute path to this file>" ; .\eqmux.exe
rem
rem Why a wrapper: EQMUX cannot pass ARGUMENTS to the shell. pty.rs spawns with
rem   CommandBuilder::new(&shell) -- an executable path and nothing else
rem   (EQMUX_SHELL -> pwsh -> Windows PowerShell -> cmd). So "print the fixture
rem   as soon as the window opens" cannot be expressed as a shell argument.
rem
rem KEEP THIS FILE ASCII-ONLY. cmd.exe reads .cmd in the OEM codepage (949 on
rem   this machine), not UTF-8. A previous version had Korean comments and the
rem   Korean text inside the pwsh -Command string; the codepage mangled it,
rem   the quoting broke, and cmd tried to execute the fragments. All Korean
rem   text now lives in a2-visual.ps1, which pwsh reads as UTF-8.
rem ---------------------------------------------------------------------------
pwsh -NoLogo -NoExit -File "%~dp0a2-visual.ps1"
