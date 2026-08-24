#ifndef MyAppVersion
  #define MyAppVersion "0.4.0-beta.1"
#endif
#ifndef MyAppNumericVersion
  #define MyAppNumericVersion "0.4.0.1"
#endif
#ifndef MyAppSourceDir
  #define MyAppSourceDir "..\dist\SlideStudio"
#endif

#define MyAppName "Slide Studio"
#define MyAppPublisher "Slide Studio"
#define MyAppExeName "SlideStudio.exe"

[Setup]
AppId={{247F6A64-DA34-4A07-866B-57B53F97C43A}
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
OutputBaseFilename=Slide-Studio-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ChangesAssociations=yes
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=SlideStudio.ico
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
Root: HKA; Subkey: "Software\Classes\.slide"; ValueType: string; ValueName: ""; ValueData: "SlideStudio.Project"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\.slide"; ValueType: string; ValueName: "Content Type"; ValueData: "application/x-slide-project"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\SlideStudio.Project"; ValueType: string; ValueName: ""; ValueData: "Slide Studio 项目"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SlideStudio.Project\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#MyAppExeName},0"
Root: HKA; Subkey: "Software\Classes\SlideStudio.Project\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}\SupportedTypes"; ValueType: string; ValueName: ".slide"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent
