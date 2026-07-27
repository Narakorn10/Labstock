using System.Text.Json.Serialization;

namespace ReagentScannerAgent.Worker.Models;

public sealed class SyncResponse
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = "";

    [JsonPropertyName("server_transaction_id")]
    public string? ServerTransactionId { get; set; }

    [JsonPropertyName("duplicate")]
    public bool Duplicate { get; set; }

    [JsonPropertyName("error_code")]
    public string? ErrorCode { get; set; }

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";
}
