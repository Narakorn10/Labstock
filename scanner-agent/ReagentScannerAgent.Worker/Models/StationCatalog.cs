using System.Text.Json.Serialization;

namespace ReagentScannerAgent.Worker.Models;

public sealed class StationCatalog
{
    [JsonPropertyName("reagents")]
    public List<CatalogReagent> Reagents { get; set; } = [];

    [JsonPropertyName("v2Patterns")]
    public List<BarcodePatternV2> V2Patterns { get; set; } = [];
}

public sealed class BarcodePatternV2
{
    [JsonPropertyName("id")]
    public long Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("mapping_mode")]
    public string MappingMode { get; set; } = "CAPTURED_IDENTIFIER";

    [JsonPropertyName("fixed_item_id")]
    public string? FixedItemId { get; set; }

    [JsonPropertyName("regex_pattern")]
    public string RegexPattern { get; set; } = "";

    [JsonPropertyName("item_id_group")]
    public int? ItemIdGroup { get; set; }

    [JsonPropertyName("lot_no_group")]
    public int? LotNoGroup { get; set; }

    [JsonPropertyName("exp_date_group")]
    public int? ExpDateGroup { get; set; }
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
