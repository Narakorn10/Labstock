using System.Text.Json;
using ReagentScannerAgent.Worker.Models;
using ReagentScannerAgent.Worker.Services;

var options = LoadOptions();
var queueStore = new QueueStore(options);
var httpClient = new HttpClient
{
    BaseAddress = new Uri(EnsureTrailingSlash(options.ApiBaseUrl)),
    Timeout = TimeSpan.FromSeconds(30)
};
var stationApiClient = new StationApiClient(httpClient, options);
var syncWorker = new SyncWorker(queueStore, stationApiClient, options);
var heartbeatWorker = new HeartbeatWorker(options, queueStore, stationApiClient);
var catalogStore = new CatalogStore(options);
var catalogSyncWorker = new CatalogSyncWorker(catalogStore, stationApiClient, options);
var consoleWithdrawalInput = new ConsoleWithdrawalInput(queueStore, catalogStore, stationApiClient);

using var cancellationSource = new CancellationTokenSource();
Console.CancelKeyPress += (_, eventArgs) =>
{
    eventArgs.Cancel = true;
    cancellationSource.Cancel();
};

await queueStore.InitializeAsync(cancellationSource.Token);
await catalogStore.InitializeAsync(cancellationSource.Token);
await queueStore.RecoverExpiredLocksAsync(cancellationSource.Token);

Console.WriteLine($"ReagentScannerAgent.Worker started for station {options.StationId}");
var backgroundTasks = new List<Task>
{
    syncWorker.RunAsync(cancellationSource.Token),
    heartbeatWorker.RunAsync(cancellationSource.Token),
    catalogSyncWorker.RunAsync(cancellationSource.Token)
};

if (options.EnableConsoleInput)
{
    backgroundTasks.Add(consoleWithdrawalInput.RunAsync(cancellationSource.Token));
}

await Task.WhenAll(backgroundTasks);

static string EnsureTrailingSlash(string value)
{
    if (string.IsNullOrWhiteSpace(value))
    {
        throw new InvalidOperationException("Station.ApiBaseUrl is required.");
    }

    return value.EndsWith('/') ? value : $"{value}/";
}

static AgentOptions LoadOptions()
{
    var appSettingsPath = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
    var json = File.ReadAllText(appSettingsPath);
    using var document = JsonDocument.Parse(json);

    if (!document.RootElement.TryGetProperty(AgentOptions.SectionName, out var section))
    {
        throw new InvalidOperationException("Station section is missing from appsettings.json.");
    }

    var options = section.Deserialize<AgentOptions>() ?? new AgentOptions();
    options.StationId = Environment.GetEnvironmentVariable("REAGENT_SCANNER_STATION_ID") ?? options.StationId;
    options.ApiBaseUrl = Environment.GetEnvironmentVariable("REAGENT_SCANNER_API_BASE_URL") ?? options.ApiBaseUrl;
    options.ApiToken = Environment.GetEnvironmentVariable("REAGENT_SCANNER_API_TOKEN") ?? options.ApiToken;
    return options;
}
