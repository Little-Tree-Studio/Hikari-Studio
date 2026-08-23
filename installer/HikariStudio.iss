#ifndef MyAppVersion
  #define MyAppVersion "0.4.0-beta.1"
#endif
#ifndef MyAppNumericVersion
  #define MyAppNumericVersion "0.4.0.1"
#endif
#ifndef MyAppSourceDir
  #define MyAppSourceDir "..\dist\HikariStudio"
#endif

#define MyAppName "Hikari Studio"
#define MyAppPublisher "Hikari Studio"
#define MyAppExeName "HikariStudio.exe"

[Setup]
AppId={{7E6765BA-9222-4B22-AE60-BE835D355E73}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\dist\installer
OutputBaseFilename=Hikari-Studio-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ChangesAssociations=yes
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=HikariStudio.ico
VersionInfoVersion={#MyAppNumericVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Windows Installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppNumericVersion}

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Files]
Source: "{#MyAppSourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"

[Registry]
Root: HKA; Subkey: "Software\Classes\.hikari"; ValueType: string; ValueName: ""; ValueData: "HikariStudio.Project"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\.hikari"; ValueType: string; ValueName: "Content Type"; ValueData: "application/x-hikari-project"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\HikariStudio.Project"; ValueType: string; ValueName: ""; ValueData: "Hikari Studio 项目"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\HikariStudio.Project\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#MyAppExeName},0"
Root: HKA; Subkey: "Software\Classes\HikariStudio.Project\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}\SupportedTypes"; ValueType: string; ValueName: ".hikari"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent
