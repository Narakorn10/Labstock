using System.Text.Json.Serialization;

namespace ReagentScannerAgent.Worker.Models;

public sealed class QueueRecord
{
    public string IdempotencyKey { get; set; } = "";

    public string LocalQueueId { get; set; } = "";

    public string LocalSessionId { get; set; } = "";

    public string Username { get; set; } = "";

    public string UserAuthorizationToken { get; set; } = "";

    public DateTimeOffset OccurredAt { get; set; }

    public string PayloadHash { get; set; } = "";

    public SyncState State { get; set; } = SyncState.Pending;

    public int AttemptCount { get; set; }

    public string? ErrorCode { get; set; }

    public string? LastError { get; set; }

    public DateTimeOffset? NextRetryAt { get; set; }

    public DateTimeOffset? LastAttemptAt { get; set; }

    public DateTimeOffset? LockExpiresAt { get; set; }

    public DateTimeOffset? SyncedAt { get; set; }

    public string? ServerTransactionId { get; set; }

    public string? ServerResponseJson { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public List<WithdrawalItem> Items { get; set; } = [];

    [JsonIgnore]
    public bool IsTerminal => State is SyncState.Synced or SyncState.Conflict or SyncState.Rejected;
}
