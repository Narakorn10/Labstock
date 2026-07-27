namespace ReagentScannerAgent.Worker.Models;

public sealed class QueueMetrics
{
    public int PendingSync { get; set; }

    public int RetryWait { get; set; }

    public int Syncing { get; set; }

    public int Synced { get; set; }

    public int Conflict { get; set; }

    public int Rejected { get; set; }
}
