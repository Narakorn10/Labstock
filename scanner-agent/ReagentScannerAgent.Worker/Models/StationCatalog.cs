using System.Text.Json.Serialization;

namespace ReagentScannerAgent.Worker.Models;

public sealed class StationCatalog
{
    [JsonPropertyName("reagents")]
    public List<CatalogReagent> Reagents { get; set; } = [];
}

public sealed class CatalogReagent
{
    [JsonPropertyName("itemId")]
    public string ItemId { get; set; } = "";

    [JsonPropertyName("qrCode")]
    public string? QrCode { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("unit")]
    public string? Unit { get; set; }
}
