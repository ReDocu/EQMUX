; NSIS 설치 훅 (tauri.conf.json bundle.windows.nsis.installerHooks)
; 콘솔 대리인(src/bin/eqmux-console.rs, B248)을 eqmux.com으로 바꿔 둔다 — 셸 페인의 `eqmux`가 이것으로 잡힌다
!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\eqmux.com"
  Rename "$INSTDIR\eqmux-console.exe" "$INSTDIR\eqmux.com"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\eqmux.com"
  RMDir "$INSTDIR"
!macroend
