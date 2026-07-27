namespace ReagentScannerAgent.Worker.Models;

public sealed class AgentOptions
{
    public const string SectionName = "Station";

    public string StationId { get; set; } = "";

    public string ApiBaseUrl { get; set; } = "";

    public string ApiToken { get; set; } = "";

    public string DatabasePath { get; set; } = "data\\reagent-scanner.db";

    public string QueueFilePath { get; set; } = "data\\offline-queue.json";

    public int HeartbeatIntervalSeconds { get; set; } = 60;

    public int SyncIntervalSeconds { get; set; } = 15;

    public int CatalogSyncIntervalSeconds { get; set; } = 3600;

    public int QueueLockTimeoutSeconds { get; set; } = 300;

    public bool EnableConsoleInput { get; set; } = true;
}
