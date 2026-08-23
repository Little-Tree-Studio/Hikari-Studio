using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
#if HIKARI_CEFSHARP
using CefSharp;
using CefSharp.WinForms;
#endif

namespace Hikari.GameLauncher;

internal sealed record LauncherConfig(
    string ProjectId,
    string Name,
    int Width = 1280,
    int Height = 720,
    string Version = "1.0.0",
    string BrowserMode = "cefsharp"
);

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var config = LoadConfig();
        var entry = Path.Combine(AppContext.BaseDirectory, "game", "index.html");
        if (!File.Exists(entry)) return ShowStartupError(config.Name, "游戏入口文件不存在。", entry);

#if HIKARI_CEFSHARP
        var subprocessExitCode = CefSharp.BrowserSubprocess.SelfHost.Main(args);
        if (subprocessExitCode >= 0) return subprocessExitCode;
        try
        {
            var settings = new CefSettings
            {
                CachePath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "HikariGames",
                    SafeFolderName(config.ProjectId),
                    "cef-cache"),
                BrowserSubprocessPath = Environment.ProcessPath,
            };
            Cef.Initialize(settings, performDependencyCheck: false, browserProcessHandler: null);
            ApplicationConfiguration.Initialize();
            Application.Run(new GameWindow(config, entry));
            Cef.Shutdown();
            return 0;
        }
        catch (Exception exception)
        {
            return ShowStartupError(config.Name, "CefSharp 内置浏览器启动失败。", exception.Message);
        }
#else
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = new Uri(entry).AbsoluteUri,
                UseShellExecute = true,
            });
            return 0;
        }
        catch (Exception exception)
        {
            return ShowStartupError(config.Name, "系统默认浏览器启动失败。", exception.Message);
        }
#endif
    }

    private static LauncherConfig LoadConfig()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "launcher.json");
        if (!File.Exists(path)) return new LauncherConfig("hikari-game", "Hikari Game");
        try
        {
            return JsonSerializer.Deserialize(File.ReadAllText(path), LauncherJsonContext.Default.LauncherConfig)
                ?? new LauncherConfig("hikari-game", "Hikari Game");
        }
        catch
        {
            return new LauncherConfig("hikari-game", "Hikari Game");
        }
    }

    private static int ShowStartupError(string title, string message, string details)
    {
        var text = $"{message}\n\n{details}";
#if HIKARI_CEFSHARP
        MessageBox.Show(text, title, MessageBoxButtons.OK, MessageBoxIcon.Error);
#else
        try { Process.Start(new ProcessStartInfo("msg.exe", $"* /TIME:30 {JsonSerializer.Serialize(text)}") { UseShellExecute = false }); }
        catch { /* The launcher remains silent when Windows messaging is unavailable. */ }
#endif
        return 1;
    }

    private static string SafeFolderName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var normalized = new string(value.Select(character => invalid.Contains(character) ? '-' : character).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(normalized) ? "hikari-game" : normalized;
    }
}

[JsonSourceGenerationOptions(PropertyNameCaseInsensitive = true)]
[JsonSerializable(typeof(LauncherConfig))]
internal partial class LauncherJsonContext : JsonSerializerContext;

#if HIKARI_CEFSHARP
internal sealed class GameWindow : Form
{
    private readonly ChromiumWebBrowser _browser;

    public GameWindow(LauncherConfig config, string entry)
    {
        Text = config.Name;
        ClientSize = new Size(Math.Max(960, config.Width), Math.Max(540, config.Height));
        MinimumSize = new Size(800, 500);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(17, 23, 25);
        _browser = new ChromiumWebBrowser(new Uri(entry).AbsoluteUri) { Dock = DockStyle.Fill };
        _browser.MenuHandler = new DisabledMenuHandler();
        Controls.Add(_browser);
    }
}

internal sealed class DisabledMenuHandler : IContextMenuHandler
{
    public void OnBeforeContextMenu(IWebBrowser browserControl, IBrowser browser, IFrame frame, IContextMenuParams parameters, IMenuModel model) => model.Clear();
    public bool OnContextMenuCommand(IWebBrowser browserControl, IBrowser browser, IFrame frame, IContextMenuParams parameters, CefMenuCommand commandId, CefEventFlags eventFlags) => false;
    public void OnContextMenuDismissed(IWebBrowser browserControl, IBrowser browser, IFrame frame) { }
    public bool RunContextMenu(IWebBrowser browserControl, IBrowser browser, IFrame frame, IContextMenuParams parameters, IMenuModel model, IRunContextMenuCallback callback) => false;
}
#endif
