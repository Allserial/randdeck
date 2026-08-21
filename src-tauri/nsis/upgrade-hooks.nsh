!macro NSIS_HOOK_PREINSTALL
  ; v0.5 used the display name as its NSIS identity. Remove that installation
  ; before writing the renamed RandDeck identity, while leaving app data intact.
  ReadRegStr $R8 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\掷数台" "UninstallString"
  ReadRegStr $R9 HKCU "Software\zhishutai\掷数台" ""

  ${If} $R8 != ""
    ${If} $R9 != ""
      ExecWait '$R8 /S _?=$R9' $R7
    ${Else}
      ExecWait '$R8 /S' $R7
    ${EndIf}

    ${If} $R7 != 0
      Abort "Unable to remove the legacy installation (exit code $R7)."
    ${EndIf}
  ${EndIf}

  ; Clean up a partially migrated installation if a previous upgrade was
  ; interrupted after copying files but before replacing registration data.
  Delete "$INSTDIR\zhishutai.exe"
  Delete "$SMPROGRAMS\掷数台.lnk"
  Delete "$DESKTOP\掷数台.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\掷数台"
  DeleteRegKey /ifempty HKCU "Software\zhishutai\掷数台"
  DeleteRegKey /ifempty HKCU "Software\zhishutai"
!macroend
