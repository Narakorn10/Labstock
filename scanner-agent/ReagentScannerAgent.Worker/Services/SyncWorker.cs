using ReagentScannerAgent.Worker.Models;

namespace ReagentScannerAgent.Worker.Services;

public sealed class SyncWorker
{
    private readonly QueueStore _queueStore;
    private readonly StationApiClient _apiClient;
    private readonly AgentOptions _options;
    private readonly string _workerInstanceId = $"{Environment.MachineName}-{Guid.NewGuid():N}";

    public SyncWorker(
        QueueStore queueStore,
        StationApiClient apiClient,
        AgentOptions options)
    {
        _queueStore = queueStore;
        _apiClient = apiClient;
        _options = options;
    }

    public async Task RunAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(5, _options.SyncIntervalSeconds)));

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await _queueStore.RecoverExpiredLocksAsync(stoppingToken);
            var pending = await _queueStore.GetReadyForSyncAsync(10, stoppingToken);

            foreach (var record in pending)
            {
                var lockedRecord = await _queueStore.TryStartSyncAsync(record.LocalQueueId, _workerInstanceId, stoppingToken);
                if (lockedRecord is null)
                {
                    continue;
                }

                try
                {
                    var result = await _apiClient.SyncWithdrawalAsync(lockedRecord, stoppingToken);
                    await _queueStore.MarkResultAsync(lockedRecord, result, stoppingToken);

                    Console.WriteLine(
                        $"Sync result for {lockedRecord.IdempotencyKey}: {result.Status} ({result.Message})");
                }
                catch (StationApiException ex) when (IsRetryableHttpStatus(ex.StatusCode))
                {
                    await _queueStore.MarkRetryAsync(lockedRecord, ex, ex.StatusCode, ex.ErrorCode, stoppingToken);
                    Console.WriteLine(
                        $"Retry scheduled for {lockedRecord.IdempotencyKey}; HTTP {ex.StatusCode}: {ex.Message}");
                }
                catch (HttpRequestException ex)
                {
                    await _queueStore.MarkRetryAsync(lockedRecord, ex, null, "NETWORK_ERROR", stoppingToken);
                    Console.WriteLine(
                        $"Retry scheduled for {lockedRecord.IdempotencyKey}; network error: {ex.Message}");
                }
                catch (TaskCanceledException ex) when (!stoppingToken.IsCancellationRequested)
                {
                    await _queueStore.MarkRetryAsync(lockedRecord, ex, 408, "TIMEOUT", stoppingToken);
                    Console.WriteLine(
                        $"Retry scheduled for {lockedRecord.IdempotencyKey}; timeout: {ex.Message}");
                }
                catch (StationApiException ex)
                {
                    var result = new SyncResponse
                    {
                        Status = ex.StatusCode is 401 or 403 ? "REJECTED" : "CONFLICT",
                        ErrorCode = ex.ErrorCode,
                        Message = ex.Message
                    };
                    await _queueStore.MarkResultAsync(lockedRecord, result, stoppingToken);
                    Console.WriteLine(
                        $"Terminal sync result for {lockedRecord.IdempotencyKey}; HTTP {ex.StatusCode}: {ex.Message}");
                }
                catch (Exception ex)
                {
                    await _queueStore.MarkRetryAsync(lockedRecord, ex, null, "UNEXPECTED_ERROR", stoppingToken);
                    Console.WriteLine(
                        $"Retry scheduled for {lockedRecord.IdempotencyKey}; unexpected error: {ex.Message}");
                }
            }
        }
    }

    private static bool IsRetryableHttpStatus(int statusCode) =>
        statusCode is 408 or 429 or 500 or 502 or 503 or 504;
}
