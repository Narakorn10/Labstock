using ReagentScannerAgent.Worker.Models;

namespace ReagentScannerAgent.Worker.Services;

public sealed class CatalogSyncWorker
{
    private readonly CatalogStore _catalogStore;
    private readonly StationApiClient _stationApiClient;
    private readonly AgentOptions _options;

    public CatalogSyncWorker(CatalogStore catalogStore, StationApiClient stationApiClient, AgentOptions options)
    {
        _catalogStore = catalogStore;
        _stationApiClient = stationApiClient;
        _options = options;
    }

    public async Task RunAsync(CancellationToken stoppingToken)
    {
        await SyncOnceAsync(stoppingToken);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(300, _options.CatalogSyncIntervalSeconds)));
        while (await timer.WaitForNextTickAsync(stoppingToken)) await SyncOnceAsync(stoppingToken);
    }

    private async Task SyncOnceAsync(CancellationToken cancellationToken)
    {
        try
        {
            var catalog = await _stationApiClient.GetCatalogAsync(cancellationToken);
            await _catalogStore.ReplaceAsync(catalog, cancellationToken);
            Console.WriteLine($"Master data cache updated: {catalog.Reagents.Count} items.");
        }
        catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
        {
            Console.WriteLine($"Master data cache update skipped: {exception.Message}");
        }
    }
}
