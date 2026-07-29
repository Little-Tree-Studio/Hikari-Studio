#ifndef MyAppVersion
  #define MyAppVersion "0.3.0"
#endif

#define MyAppName "Hikari Studio"
#define MyAppPublisher "Hikari Studio"
#define MyAppExeName "HikariStudio.exe"
#define WebView2Bootstrapper "MicrosoftEdgeWebview2Setup.exe"

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
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Windows Installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Files]
Source: "..\dist\HikariStudio\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\build\prerequisites\{#WebView2Bootstrapper}"; Flags: dontcopy

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

[Code]
const
  WebView2ClientId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  EdgeStableClientId = '{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}';

function HasWebView2Version(RootKey: Integer; KeyName: String): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, KeyName, 'pv', Version) and
    (Version <> '') and (Version <> '0.0.0.0');
end;

function IsWebView2Installed(): Boolean;
var
  RuntimeKey: String;
  EdgeKey: String;
begin
  RuntimeKey := 'Software\Microsoft\EdgeUpdate\Clients\' + WebView2ClientId;
  EdgeKey := 'Software\Microsoft\EdgeUpdate\Clients\' + EdgeStableClientId;
  Result := HasWebView2Version(HKCU, RuntimeKey) or
    HasWebView2Version(HKLM32, RuntimeKey) or
    HasWebView2Version(HKLM64, RuntimeKey) or
    HasWebView2Version(HKCU, EdgeKey) or
    HasWebView2Version(HKLM32, EdgeKey) or
    HasWebView2Version(HKLM64, EdgeKey);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if IsWebView2Installed() then
  begin
    Log('Microsoft Edge WebView2 Runtime is already installed.');
    exit;
  end;

  Log('Microsoft Edge WebView2 Runtime is missing; starting Evergreen bootstrapper.');
  ExtractTemporaryFile('{#WebView2Bootstrapper}');
  if not Exec(ExpandConstant('{tmp}\{#WebView2Bootstrapper}'), '/silent /install', '', SW_HIDE,
    ewWaitUntilTerminated, ResultCode) then
  begin
    Result := '无法启动 Microsoft Edge WebView2 Runtime 安装程序。请检查系统权限后重试。';
    exit;
  end;
  Log(Format('WebView2 bootstrapper exit code: %d', [ResultCode]));
  if (ResultCode <> 0) or not IsWebView2Installed() then
    Result := 'Microsoft Edge WebView2 Runtime 安装失败。请连接网络或手动安装 WebView2 Runtime 后重试。';
end;
