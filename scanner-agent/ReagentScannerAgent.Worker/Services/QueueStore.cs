using System.Globalization;
using System.Text.Json;
using ReagentScannerAgent.Worker.Models;

namespace ReagentScannerAgent.Worker.Services;

public sealed class QueueStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly AgentOptions _options;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public QueueStore(AgentOptions options) => _options = options;

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        await WithDatabaseAsync(database =>
        {
            database.Execute("""
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = NORMAL;
                CREATE TABLE IF NOT EXISTS withdrawal_queue (
                    local_queue_id TEXT PRIMARY KEY,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    local_session_id TEXT NOT NULL,
                    username TEXT NOT NULL,
                    user_authorization_token TEXT NOT NULL DEFAULT '',
                    occurred_at TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    state INTEGER NOT NULL,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    error_code TEXT,
                    last_error TEXT,
                    next_retry_at TEXT,
                    last_attempt_at TEXT,
                    lock_expires_at TEXT,
                    synced_at TEXT,
                    server_transaction_id TEXT,
                    server_response_json TEXT,
                    items_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_withdrawal_queue_ready
                    ON withdrawal_queue(state, next_retry_at, created_at);
                """);

            EnsureColumn(database, "user_authorization_token", "TEXT NOT NULL DEFAULT ''");

            ImportLegacyQueueIfNeeded(database);
            return 0;
        }, cancellationToken);
    }

    public Task<IReadOnlyList<QueueRecord>> GetReadyForSyncAsync(int limit, CancellationToken cancellationToken) =>
        WithDatabaseAsync<IReadOnlyList<QueueRecord>>(database =>
        {
            var now = Sql(DateTimeOffset.UtcNow);
            var rows = database.Query($"""
                SELECT * FROM withdrawal_queue
                WHERE state IN ({(int)SyncState.Pending}, {(int)SyncState.RetryWait})
                  AND (next_retry_at IS NULL OR next_retry_at <= {now})
                  AND (lock_expires_at IS NULL OR lock_expires_at <= {now})
                ORDER BY created_at
                LIMIT {Math.Max(1, limit)};
                """);
            return rows.Select(MapRecord).ToList();
        }, cancellationToken);

    public Task<QueueRecord?> TryStartSyncAsync(string queueId, string workerInstanceId, CancellationToken cancellationToken) =>
        WithDatabaseAsync<QueueRecord?>(database =>
        {
            _ = workerInstanceId;
            var now = DateTimeOffset.UtcNow;
            var rows = database.Query($"SELECT * FROM withdrawal_queue WHERE local_queue_id = {Sql(queueId)} LIMIT 1;");
            if (rows.Count == 0)
            {
                return null;
            }

            var record = MapRecord(rows[0]);
            if (record.State is not (SyncState.Pending or SyncState.RetryWait) ||
                record.NextRetryAt > now || record.LockExpiresAt > now)
            {
                return null;
            }

            record.State = SyncState.Syncing;
            record.AttemptCount++;
            record.LastAttemptAt = now;
            record.LockExpiresAt = now.AddSeconds(Math.Max(30, _options.QueueLockTimeoutSeconds));
            record.UpdatedAt = now;
            Upsert(database, record);
            return record;
        }, cancellationToken);

    public Task MarkResultAsync(QueueRecord record, SyncResponse response, CancellationToken cancellationToken) =>
        UpdateExistingAsync(record.LocalQueueId, existing =>
        {
            existing.State = response.Status switch
            {
                "SYNCED" => SyncState.Synced,
                "CONFLICT" => SyncState.Conflict,
                "REJECTED" => SyncState.Rejected,
                _ => SyncState.RetryWait
            };
            existing.ErrorCode = response.ErrorCode;
            existing.LastError = response.Message;
            existing.ServerTransactionId = response.ServerTransactionId;
            existing.ServerResponseJson = JsonSerializer.Serialize(response, JsonOptions);
            existing.SyncedAt = existing.State == SyncState.Synced ? DateTimeOffset.UtcNow : null;
            existing.NextRetryAt = null;
            existing.LockExpiresAt = null;
        }, cancellationToken);

    public Task MarkRetryAsync(QueueRecord record, Exception exception, int? httpStatus, string? errorCode, CancellationToken cancellationToken) =>
        UpdateExistingAsync(record.LocalQueueId, existing =>
        {
            existing.State = SyncState.RetryWait;
            existing.ErrorCode = errorCode;
            existing.LastError = exception.Message;
            existing.ServerResponseJson = JsonSerializer.Serialize(new { httpStatus, errorCode, error = exception.Message }, JsonOptions);
            existing.NextRetryAt = DateTimeOffset.UtcNow.Add(GetRetryDelay(existing.AttemptCount));
            existing.LockExpiresAt = null;
        }, cancellationToken);

    public Task RecoverExpiredLocksAsync(CancellationToken cancellationToken) => WithDatabaseAsync(database =>
    {
        var now = Sql(DateTimeOffset.UtcNow);
        database.Execute($"""
            UPDATE withdrawal_queue
            SET state = {(int)SyncState.RetryWait}, next_retry_at = {now}, lock_expires_at = NULL, updated_at = {now}
            WHERE state = {(int)SyncState.Syncing} AND lock_expires_at IS NOT NULL AND lock_expires_at <= {now};
            """);
        return 0;
    }, cancellationToken);

    public Task<QueueMetrics> GetMetricsAsync(CancellationToken cancellationToken) => WithDatabaseAsync(database =>
    {
        var counts = database.Query("SELECT state, COUNT(*) AS count FROM withdrawal_queue GROUP BY state;")
            .ToDictionary(row => ParseInt(row["state"]), row => ParseInt(row["count"]));
        return new QueueMetrics
        {
            PendingSync = GetCount(counts, SyncState.Pending), RetryWait = GetCount(counts, SyncState.RetryWait),
            Syncing = GetCount(counts, SyncState.Syncing), Synced = GetCount(counts, SyncState.Synced),
            Conflict = GetCount(counts, SyncState.Conflict), Rejected = GetCount(counts, SyncState.Rejected)
        };
    }, cancellationToken);

    public Task SaveAsync(QueueRecord record, CancellationToken cancellationToken) => WithDatabaseAsync(database =>
    {
        record.PayloadHash = string.IsNullOrWhiteSpace(record.PayloadHash)
            ? StationApiClient.ComputePayloadHash(StationApiClient.MapRequest(record))
            : record.PayloadHash;
        record.UpdatedAt = DateTimeOffset.UtcNow;
        Upsert(database, record);
        return 0;
    }, cancellationToken);

    private Task UpdateExistingAsync(string queueId, Action<QueueRecord> update, CancellationToken cancellationToken) =>
        WithDatabaseAsync(database =>
        {
            var rows = database.Query($"SELECT * FROM withdrawal_queue WHERE local_queue_id = {Sql(queueId)} LIMIT 1;");
            if (rows.Count > 0)
            {
                var record = MapRecord(rows[0]);
                update(record);
                record.UpdatedAt = DateTimeOffset.UtcNow;
                Upsert(database, record);
            }
            return 0;
        }, cancellationToken);

    private async Task<T> WithDatabaseAsync<T>(Func<NativeSqlite, T> action, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            using var database = new NativeSqlite(GetDatabasePath());
            return action(database);
        }
        finally
        {
            _gate.Release();
        }
    }

    private string GetDatabasePath()
    {
        var path = Path.IsPathRooted(_options.DatabasePath)
            ? _options.DatabasePath
            : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, _options.DatabasePath));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        return path;
    }

    private void ImportLegacyQueueIfNeeded(NativeSqlite database)
    {
        var rowCount = database.Query("SELECT COUNT(*) AS count FROM withdrawal_queue;");
        if (rowCount.Count > 0 && ParseInt(rowCount[0]["count"]) > 0)
        {
            return;
        }

        var legacyPath = Path.IsPathRooted(_options.QueueFilePath)
            ? _options.QueueFilePath
            : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, _options.QueueFilePath));
        if (!File.Exists(legacyPath))
        {
            return;
        }

        var records = JsonSerializer.Deserialize<List<QueueRecord>>(File.ReadAllText(legacyPath), JsonOptions) ?? [];
        if (records.Count == 0)
        {
            return;
        }

        database.Execute("BEGIN IMMEDIATE;");
        try
        {
            foreach (var record in records)
            {
                Upsert(database, record);
            }

            database.Execute("COMMIT;");
        }
        catch
        {
            database.Execute("ROLLBACK;");
            throw;
        }
    }

    private static void Upsert(NativeSqlite database, QueueRecord record) => database.Execute($"""
        INSERT INTO withdrawal_queue (
            local_queue_id, idempotency_key, local_session_id, username, user_authorization_token, occurred_at, payload_hash,
            state, attempt_count, error_code, last_error, next_retry_at, last_attempt_at,
            lock_expires_at, synced_at, server_transaction_id, server_response_json, items_json,
            created_at, updated_at)
        VALUES (
            {Sql(record.LocalQueueId)}, {Sql(record.IdempotencyKey)}, {Sql(record.LocalSessionId)},
            {Sql(record.Username)}, {Sql(record.UserAuthorizationToken)}, {Sql(record.OccurredAt)}, {Sql(record.PayloadHash)}, {(int)record.State},
            {record.AttemptCount}, {Sql(record.ErrorCode)}, {Sql(record.LastError)}, {Sql(record.NextRetryAt)},
            {Sql(record.LastAttemptAt)}, {Sql(record.LockExpiresAt)}, {Sql(record.SyncedAt)},
            {Sql(record.ServerTransactionId)}, {Sql(record.ServerResponseJson)},
            {Sql(JsonSerializer.Serialize(record.Items, JsonOptions))}, {Sql(record.CreatedAt)}, {Sql(record.UpdatedAt)})
        ON CONFLICT(local_queue_id) DO UPDATE SET
            idempotency_key=excluded.idempotency_key, local_session_id=excluded.local_session_id,
            username=excluded.username, user_authorization_token=excluded.user_authorization_token,
            occurred_at=excluded.occurred_at, payload_hash=excluded.payload_hash,
            state=excluded.state, attempt_count=excluded.attempt_count, error_code=excluded.error_code,
            last_error=excluded.last_error, next_retry_at=excluded.next_retry_at,
            last_attempt_at=excluded.last_attempt_at, lock_expires_at=excluded.lock_expires_at,
            synced_at=excluded.synced_at, server_transaction_id=excluded.server_transaction_id,
            server_response_json=excluded.server_response_json, items_json=excluded.items_json,
            updated_at=excluded.updated_at;
        """);

    private static QueueRecord MapRecord(Dictionary<string, string?> row) => new()
    {
        LocalQueueId = row["local_queue_id"] ?? "", IdempotencyKey = row["idempotency_key"] ?? "",
        LocalSessionId = row["local_session_id"] ?? "", Username = row["username"] ?? "",
        UserAuthorizationToken = row.GetValueOrDefault("user_authorization_token") ?? "",
        OccurredAt = ParseDate(row["occurred_at"]) ?? DateTimeOffset.UtcNow,
        PayloadHash = row["payload_hash"] ?? "", State = (SyncState)ParseInt(row["state"]),
        AttemptCount = ParseInt(row["attempt_count"]), ErrorCode = row["error_code"],
        LastError = row["last_error"], NextRetryAt = ParseDate(row["next_retry_at"]),
        LastAttemptAt = ParseDate(row["last_attempt_at"]), LockExpiresAt = ParseDate(row["lock_expires_at"]),
        SyncedAt = ParseDate(row["synced_at"]), ServerTransactionId = row["server_transaction_id"],
        ServerResponseJson = row["server_response_json"], CreatedAt = ParseDate(row["created_at"]) ?? DateTimeOffset.UtcNow,
        UpdatedAt = ParseDate(row["updated_at"]) ?? DateTimeOffset.UtcNow,
        Items = JsonSerializer.Deserialize<List<WithdrawalItem>>(row["items_json"] ?? "[]", JsonOptions) ?? []
    };

    private static string Sql(string? value) => value is null ? "NULL" : $"'{value.Replace("'", "''")}'";

    private static void EnsureColumn(NativeSqlite database, string columnName, string definition)
    {
        var columns = database.Query("PRAGMA table_info(withdrawal_queue);");
        if (!columns.Any(column => string.Equals(column.GetValueOrDefault("name"), columnName, StringComparison.Ordinal)))
        {
            database.Execute($"ALTER TABLE withdrawal_queue ADD COLUMN {columnName} {definition};");
        }
    }
    private static string Sql(DateTimeOffset value) => Sql(value.ToString("O", CultureInfo.InvariantCulture));
    private static string Sql(DateTimeOffset? value) => value is null ? "NULL" : Sql(value.Value);
    private static int ParseInt(string? value) => int.TryParse(value, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0;
    private static DateTimeOffset? ParseDate(string? value) => DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed) ? parsed : null;
    private static int GetCount(Dictionary<int, int> counts, SyncState state) => counts.GetValueOrDefault((int)state);

    private static TimeSpan GetRetryDelay(int attemptCount) => TimeSpan.FromSeconds(attemptCount switch
    {
        <= 1 => 5, 2 => 15, 3 => 30, 4 => 60, 5 => 300, _ => 900
    } + Random.Shared.Next(0, 3));
}
