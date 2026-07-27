namespace ReagentScannerAgent.Worker.Models;

public sealed class WithdrawalItem
{
    public string LocalEventId { get; set; } = "";

    public string ItemId { get; set; } = "";

    public string LotNo { get; set; } = "";

    public decimal Quantity { get; set; }

    public string? ExpiryDate { get; set; }

    public string RawBarcode { get; set; } = "";
}
