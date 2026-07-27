using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ReagentScannerAgent.Worker.Models;

namespace ReagentScannerAgent.Worker.Services;

public sealed class StationApiClient
{
    private readonly HttpClient _httpClient;
    private readonly AgentOptions _options;

    public StationApiClient(HttpClient httpClient, AgentOptions options)
    {
        _httpClient = httpClient;
        _options = options;
    }

    public async Task<SyncResponse> SyncWithdrawalAsync(QueueRecord record, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/stations/sync-withdrawal");
        request.Headers.Authorization = new("Bearer", _options.ApiToken);
        request.Headers.Add("x-station-id", _options.StationId);
        request.Headers.Add("x-agent-version", "0.1.0");

        var payload = JsonSerializer.Serialize(MapRequest(record));
        request.Content = new StringContent(payload, Encoding.UTF8, "application/json");

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        var parsed = ParseResponse(body);

        if (response.StatusCode is HttpStatusCode.OK or HttpStatusCode.Conflict)
        {
            return parsed;
        }

        throw new StationApiException(
            (int)response.StatusCode,
            parsed.Message,
            parsed.ErrorCode);
    }

    public async Task<UserAuthorizationResponse> AuthorizeUserAsync(string username, string pin, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/stations/authorize-user");
        request.Headers.Authorization = new("Bearer", _options.ApiToken);
        request.Headers.Add("x-station-id", _options.StationId);
        request.Content = new StringContent(JsonSerializer.Serialize(new { username, pin }), Encoding.UTF8, "application/json");

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new StationApiException((int)response.StatusCode, ParseResponse(body).Message, null);
        }

        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;
        var authorizationToken = root.GetProperty("authorization_token").GetString();
        var verifiedUsername = root.GetProperty("username").GetString();
        if (string.IsNullOrWhiteSpace(authorizationToken) || string.IsNullOrWhiteSpace(verifiedUsername))
        {
            throw new InvalidOperationException("Station API returned an invalid user authorization.");
        }

        return new UserAuthorizationResponse(verifiedUsername, authorizationToken);
    }

    public async Task<StationCatalog> GetCatalogAsync(CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "api/stations/catalog");
        request.Headers.Authorization = new("Bearer", _options.ApiToken);
        request.Headers.Add("x-station-id", _options.StationId);
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new StationApiException((int)response.StatusCode, ParseResponse(body).Message, null);
        }

        return JsonSerializer.Deserialize<StationCatalog>(body)
            ?? throw new InvalidOperationException("Station API returned an invalid master data catalog.");
    }

    public async Task SendHeartbeatAsync(QueueMetrics metrics, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/stations/heartbeat");
        request.Headers.Authorization = new("Bearer", _options.ApiToken);
        request.Headers.Add("x-station-id", _options.StationId);
        request.Headers.Add("x-agent-version", "0.1.0");
        var payload = JsonSerializer.Serialize(new
        {
            agent_version = "0.1.0",
            queue_pending = metrics.PendingSync + metrics.RetryWait + metrics.Syncing,
            queue_conflict = metrics.Conflict + metrics.Rejected,
            last_scan_at = (string?)null
        });
        request.Content = new StringContent(payload, Encoding.UTF8, "application/json");

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new StationApiException((int)response.StatusCode, body, null);
        }
    }

    public static string ComputePayloadHash(SyncRequest request)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(request);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(json));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    public static SyncRequest MapRequest(QueueRecord record)
    {
        return new SyncRequest
        {
            IdempotencyKey = record.IdempotencyKey,
            LocalQueueId = record.LocalQueueId,
            LocalSessionId = record.LocalSessionId,
            AuthorizationToken = record.UserAuthorizationToken,
            OccurredAt = record.OccurredAt.UtcDateTime.ToString("O"),
            Items = record.Items.Select(item => new SyncRequestItem
            {
                LocalEventId = item.LocalEventId,
                ItemId = item.ItemId,
                LotNo = item.LotNo,
                Quantity = item.Quantity,
                ExpiryDate = item.ExpiryDate,
                RawBarcode = item.RawBarcode
            }).ToList()
        };
    }

    private static SyncResponse ParseResponse(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return new SyncResponse
            {
                Status = "RETRY_WAIT",
                Message = "Station API returned an empty response."
            };
        }

        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;

        return new SyncResponse
        {
            Status = root.TryGetProperty("status", out var status) ? status.GetString() ?? "" : "",
            ServerTransactionId = root.TryGetProperty("server_transaction_id", out var tx) ? tx.GetString() : null,
            Duplicate = root.TryGetProperty("duplicate", out var duplicate) && duplicate.ValueKind == JsonValueKind.True,
            ErrorCode = root.TryGetProperty("error_code", out var errorCode) ? errorCode.GetString() : null,
            Message =
                root.TryGetProperty("message", out var message) ? message.GetString() ?? "" :
                root.TryGetProperty("error", out var error) ? error.GetString() ?? "" :
                "Station API returned an unknown response."
        };
    }
}
