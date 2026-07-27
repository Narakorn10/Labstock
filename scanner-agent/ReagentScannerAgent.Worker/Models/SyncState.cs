namespace ReagentScannerAgent.Worker.Models;

public enum SyncState
{
    Pending = 0,
    RetryWait = 1,
    Syncing = 2,
    Synced = 3,
    Conflict = 4,
    Rejected = 5
}
