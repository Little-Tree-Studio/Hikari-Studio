using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Hikari.GameLauncher;

internal sealed record LauncherConfig(
    string ProjectId,
    string Name,
    int Width = 1280,
    int Height = 720,
    string Version = "1.0.0"
);

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new GameWindow(LoadConfig()));
    }

    private static LauncherConfig LoadConfig()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "launcher.json");
        if (!File.Exists(path)) return new LauncherConfig("hikari-game", "Hikari Game");
        try
        {
            return JsonSerializer.Deserialize<LauncherConfig>(File.ReadAllText(path), new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            }) ?? new LauncherConfig("hikari-game", "Hikari Game");
        }
        catch
        {
            return new LauncherConfig("hikari-game", "Hikari Game");
        }
    }
}

internal sealed class GameWindow : Form
{
    private readonly LauncherConfig _config;
    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill };

    public GameWindow(LauncherConfig config)
    {
        _config = config;
        Text = config.Name;
        ClientSize = new Size(Math.Max(960, config.Width), Math.Max(540, config.Height));
        MinimumSize = new Size(800, 500);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(17, 23, 25);
        Controls.Add(_webView);
        Shown += OnShown;
    }

    private async void OnShown(object? sender, EventArgs args)
    {
        Shown -= OnShown;
        try
        {
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "HikariGames",
                SafeFolderName(_config.ProjectId));
            Directory.CreateDirectory(userData);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
            await _webView.EnsureCoreWebView2Async(environment);
            _webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _webView.CoreWebView2.Settings.IsZoomControlEnabled = false;
            _webView.CoreWebView2.NewWindowRequested += (_, eventArgs) => eventArgs.Handled = true;

            var entry = Path.Combine(AppContext.BaseDirectory, "game", "index.html");
            if (!File.Exists(entry)) throw new FileNotFoundException("游戏入口文件不存在", entry);
            _webView.Source = new Uri(entry);
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, $"游戏启动失败。\n\n{exception.Message}\n\n请确认已安装 Microsoft Edge WebView2 Runtime。", _config.Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private static string SafeFolderName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var normalized = new string(value.Select(character => invalid.Contains(character) ? '-' : character).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(normalized) ? "hikari-game" : normalized;
    }
}
