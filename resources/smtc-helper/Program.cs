// Мост к Windows SMTC. Печатает JSON про текущий трек любого плеера и умеет
// жать кнопки транспорта. Собрать и положить smtc.exe в resources/:
//
//   dotnet publish -c Release
//   copy bin\Release\net8.0-windows10.0.19041.0\win-x64\publish\smtc.exe ..\
//
// Размер ~150 КБ при установленном .NET 8 Desktop Runtime.

using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Windows.Media.Control;
using Windows.Storage.Streams;

class Program
{
    static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        var mgr = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var s = mgr.GetCurrentSession();
        if (s == null) { Console.Write("{}"); return 0; }

        string mode = args.Length > 0 ? args[0] : "--once";

        if (mode == "--cmd" && args.Length > 1)
        {
            switch (args[1])
            {
                case "play":   await s.TryPlayAsync(); break;
                case "pause":  await s.TryPauseAsync(); break;
                case "toggle": await s.TryTogglePlayPauseAsync(); break;
                case "next":   await s.TrySkipNextAsync(); break;
                case "prev":   await s.TrySkipPreviousAsync(); break;
            }
            return 0;
        }
        if (mode == "--seek" && args.Length > 1 && double.TryParse(args[1], out var sec))
        {
            await s.TryChangePlaybackPositionAsync((long)(sec * 1e7)); // единицы по 100 нс
            return 0;
        }

        var p = await s.TryGetMediaPropertiesAsync();
        var t = s.GetTimelineProperties();
        var pb = s.GetPlaybackInfo();

        Console.Write(JsonSerializer.Serialize(new
        {
            source   = s.SourceAppUserModelId,
            title    = p.Title,
            artist   = p.Artist,
            album    = p.AlbumTitle,
            artwork  = await ThumbAsync(p.Thumbnail),
            playing  = pb.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing,
            position = t.Position.TotalSeconds,
            duration = t.EndTime.TotalSeconds,
            canSeek  = pb.Controls.IsPlaybackPositionEnabled
        }));
        return 0;
    }

    // Обложка приходит потоком — отдаём её сразу data-URL, чтобы Electron не лез в файлы
    static async Task<string> ThumbAsync(IRandomAccessStreamReference reference)
    {
        if (reference == null) return null;
        try
        {
            using var stream = await reference.OpenReadAsync();
            var bytes = new byte[stream.Size];
            using var reader = new DataReader(stream);
            await reader.LoadAsync((uint)stream.Size);
            reader.ReadBytes(bytes);
            return "data:image/png;base64," + Convert.ToBase64String(bytes);
        }
        catch { return null; }
    }
}
