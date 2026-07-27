using System.Text.Json.Serialization;

namespace ReagentScannerAgent.Worker.Models;

public sealed class SyncRequest
{
    [JsonPropertyName("schema_version")]
    public int SchemaVersion { get; set; } = 1;

    [JsonPropertyName("idempotency_key")]
    public string IdempotencyKey { get; set; } = "";

    [JsonPropertyName("local_queue_id")]
    public string LocalQueueId { get; set; } = "";

    [JsonPropertyName("local_session_id")]
    public string LocalSessionId { get; set; } = "";

    [JsonPropertyName("authorization_token")]
    public string AuthorizationToken { get; set; } = "";

    [JsonPropertyName("occurred_at")]
    public string OccurredAt { get; set; } = "";

    [JsonPropertyName("items")]
    public List<SyncRequestItem> Items { get; set; } = [];
}
