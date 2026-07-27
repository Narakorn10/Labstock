using ReagentScannerAgent.Worker.Models;

namespace ReagentScannerAgent.Worker.Services;

public sealed class HeartbeatWorker
{
    private readonly AgentOptions _options;
    private readonly QueueStore _queueStore;
    private readonly StationApiClient _stationApiClient;

    public HeartbeatWorker(AgentOptions options, QueueStore queueStore, StationApiClient stationApiClient)
    {
        _options = options;
        _queueStore = queueStore;
        _stationApiClient = stationApiClient;
    }

    public async Task RunAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(15, _options.HeartbeatIntervalSeconds)));

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            var metrics = await _queueStore.GetMetricsAsync(stoppingToken);
            try
            {
                await _stationApiClient.SendHeartbeatAsync(metrics, stoppingToken);
                Console.WriteLine($"Heartbeat sent for station {_options.StationId}.");
            }
            catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
            {
                Console.Error.WriteLine($"Heartbeat failed for station {_options.StationId}: {exception.Message}");
            }
        }
    }
}
