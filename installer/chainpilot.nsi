; Windows installer for the desktop app. Built by tools/build-windows.js, which passes:
;   PRODUCT_NAME PRODUCT_ID VERSION PUBLISHER SITE_URL STAGE_DIR OUT_FILE
; Installs for the current user only (no administrator rights needed) into
; %LOCALAPPDATA%\Programs\<name>: a Node.js runtime plus the app's JavaScript.
; The user's data (%LOCALAPPDATA%\<name>) is kept on uninstall unless they choose otherwise.

Unicode true
SetCompressor /SOLID lzma
ManifestDPIAware true
RequestExecutionLevel user

!include "MUI2.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!include "FileFunc.nsh"

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}"
!define LAUNCHER "$INSTDIR\runtime\node.exe"
!define LAUNCH_ARGS '"$INSTDIR\app\desktop\main.js"'

Name "${PRODUCT_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT_NAME}"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
BrandingText "${PRODUCT_NAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "${PUBLISHER}"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "This installs ${PRODUCT_NAME} ${VERSION} for your Windows account.$\r$\n$\r$\n${PRODUCT_NAME} automates a compounding betting plan for Aviator. It does not predict rounds or improve the odds, and you can lose money. You must be 18 or older.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open ${PRODUCT_NAME} now"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
!define MUI_FINISHPAGE_LINK "User guide and strategy explained"
!define MUI_FINISHPAGE_LINK_LOCATION "${SITE_URL}guide.html"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "license.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "${PRODUCT_NAME} needs Windows 10 or 11." /SD IDOK
    Abort
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "${PRODUCT_NAME} needs 64-bit Windows." /SD IDOK
    Abort
  ${EndIf}
FunctionEnd

; A running copy keeps node.exe locked, so its files can't be replaced or removed.
; (Labels are per section; each section inserts this once.)
!macro WAIT_UNTIL_CLOSED
  IfFileExists "$INSTDIR\runtime\node.exe" 0 closed
  retry_close:
    ClearErrors
    Delete "$INSTDIR\runtime\node.exe"
    IfErrors 0 closed
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${PRODUCT_NAME} is running. Quit it (Help, then Quit, or close its windows) and press Retry." /SD IDCANCEL IDRETRY retry_close
    Abort
  closed:
!macroend

Function LaunchApp
  ExecShell "" "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
FunctionEnd

Section "Install"
  !insertmacro WAIT_UNTIL_CLOSED
  ; Replace the program files completely, so files removed in this version don't linger.
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  SetOutPath "$INSTDIR"
  File /r "${STAGE_DIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Shortcuts start in the app folder with the log console minimised; the control panel opens in its own window.
  SetOutPath "$INSTDIR\app"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}.lnk" "${LAUNCHER}" '${LAUNCH_ARGS}' "$INSTDIR\icon.ico" 0 SW_SHOWMINIMIZED "" "${PRODUCT_NAME}"
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "${LAUNCHER}" '${LAUNCH_ARGS}' "$INSTDIR\icon.ico" 0 SW_SHOWMINIMIZED "" "${PRODUCT_NAME}"

  ; Installed apps list (Settings > Apps)
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "${SITE_URL}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0
SectionEnd

Section "Uninstall"
  !insertmacro WAIT_UNTIL_CLOSED
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\THIRD-PARTY-NOTICES.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  MessageBox MB_YESNO|MB_ICONQUESTION "Also delete your ${PRODUCT_NAME} settings, bet logs, license key and the game window's saved login from this computer?$\r$\n$\r$\nChoose No if you may install ${PRODUCT_NAME} again." /SD IDNO IDNO keep
    RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}"
  keep:
SectionEnd
