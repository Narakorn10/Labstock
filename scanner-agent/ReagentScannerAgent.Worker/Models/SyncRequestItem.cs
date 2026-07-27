using System.Text.Json.Serialization;

namespace ReagentScannerAgent.Worker.Models;

public sealed class SyncRequestItem
{
    [JsonPropertyName("local_event_id")]
    public string LocalEventId { get; set; } = "";

    [JsonPropertyName("item_id")]
    public string ItemId { get; set; } = "";

    [JsonPropertyName("lot_no")]
    public string LotNo { get; set; } = "";

    [JsonPropertyName("quantity")]
    public decimal Quantity { get; set; }

    [JsonPropertyName("expiry_date")]
    public string? ExpiryDate { get; set; }

    [JsonPropertyName("raw_barcode")]
    public string RawBarcode { get; set; } = "";
}
