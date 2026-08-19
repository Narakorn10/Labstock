using System.Text.RegularExpressions;
using ReagentScannerAgent.Worker.Models;

namespace ReagentScannerAgent.Worker.Services;

public sealed class CatalogStore
{
    private readonly AgentOptions _options;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public CatalogStore(AgentOptions options) => _options = options;

    public Task InitializeAsync(CancellationToken cancellationToken) => WithDatabaseAsync(database =>
    {
        database.Execute("""
            CREATE TABLE IF NOT EXISTS catalog_reagents (
                item_id TEXT PRIMARY KEY,
                normalized_lookup TEXT NOT NULL,
                name TEXT NOT NULL,
                unit TEXT,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_catalog_reagents_lookup ON catalog_reagents(normalized_lookup);
            CREATE TABLE IF NOT EXISTS catalog_barcode_v2 (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                mapping_mode TEXT NOT NULL,
                fixed_item_id TEXT,
                regex_pattern TEXT NOT NULL,
                item_id_group INTEGER,
                lot_no_group INTEGER,
                exp_date_group INTEGER,
                updated_at TEXT NOT NULL
            );
            """);
        return 0;
    }, cancellationToken);

    public Task ReplaceAsync(StationCatalog catalog, CancellationToken cancellationToken) => WithDatabaseAsync(database =>
    {
        database.Execute("BEGIN IMMEDIATE;");
        try
        {
            database.Execute("DELETE FROM catalog_reagents;");
            foreach (var reagent in catalog.Reagents.Where(reagent => !string.IsNullOrWhiteSpace(reagent.ItemId)))
            {
                var lookup = NormalizeLookupValue(string.IsNullOrWhiteSpace(reagent.QrCode) ? reagent.ItemId : reagent.QrCode);
                database.Execute($"""
                    INSERT INTO catalog_reagents (item_id, normalized_lookup, name, unit, updated_at)
                    VALUES ({Sql(reagent.ItemId)}, {Sql(lookup)}, {Sql(reagent.Name)}, {Sql(reagent.Unit)}, {Sql(DateTimeOffset.UtcNow)});
                    """);
            }
            database.Execute("DELETE FROM catalog_barcode_v2;");
            foreach (var pattern in catalog.V2Patterns.Where(pattern => !string.IsNullOrWhiteSpace(pattern.RegexPattern)))
            {
                database.Execute($"""
                    INSERT INTO catalog_barcode_v2 (
                        id, name, mapping_mode, fixed_item_id, regex_pattern,
                        item_id_group, lot_no_group, exp_date_group, updated_at
                    ) VALUES (
                        {pattern.Id}, {Sql(pattern.Name)}, {Sql(pattern.MappingMode)},
                        {Sql(pattern.FixedItemId)}, {Sql(pattern.RegexPattern)},
                        {Sql(pattern.ItemIdGroup)}, {Sql(pattern.LotNoGroup)}, {Sql(pattern.ExpDateGroup)},
                        {Sql(DateTimeOffset.UtcNow)}
                    );
                    """);
            }
            database.Execute("COMMIT;");
        }
        catch
        {
            database.Execute("ROLLBACK;");
            throw;
        }
        return 0;
    }, cancellationToken);

    public Task<CatalogReagent?> FindByGtinAsync(string gtin, CancellationToken cancellationToken) => WithDatabaseAsync(database =>
    {
        var key = NormalizeLookupValue(gtin);
        var rows = database.Query($"SELECT item_id, name, unit FROM catalog_reagents WHERE normalized_lookup = {Sql(key)} LIMIT 1;");
        if (rows.Count == 0) return null;
        var row = rows[0];
        return new CatalogReagent { ItemId = row["item_id"] ?? "", Name = row["name"] ?? "", Unit = row["unit"] };
    }, cancellationToken);

    public Task<V2BarcodeMatch?> FindByV2Async(string barcode, CancellationToken cancellationToken) => WithDatabaseAsync(database =>
    {
        var patterns = database.Query("SELECT id, name, mapping_mode, fixed_item_id, regex_pattern, item_id_group, lot_no_group, exp_date_group FROM catalog_barcode_v2 ORDER BY id DESC;");
        foreach (var pattern in patterns)
        {
            try
            {
                var regex = new Regex(pattern["regex_pattern"] ?? "", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(250));
                var match = regex.Match(barcode);
                if (!match.Success) continue;

                var itemId = string.Equals(pattern["mapping_mode"], "FIXED_REAGENT", StringComparison.OrdinalIgnoreCase)
                    ? pattern["fixed_item_id"]
                    : ReadGroup(match, pattern["item_id_group"]);
                if (string.IsNullOrWhiteSpace(itemId)) continue;

                var key = NormalizeLookupValue(itemId);
                var reagentRows = database.Query($"SELECT item_id, name, unit FROM catalog_reagents WHERE normalized_lookup = {Sql(key)} OR LOWER(item_id) = LOWER({Sql(itemId)}) LIMIT 1;");
                if (reagentRows.Count == 0) continue;

                var reagentRow = reagentRows[0];
                return new V2BarcodeMatch
                {
                    PatternId = long.TryParse(pattern["id"], out var id) ? id : 0,
                    PatternName = pattern["name"] ?? "",
                    Reagent = new CatalogReagent
                    {
                        ItemId = reagentRow["item_id"] ?? "",
                        Name = reagentRow["name"] ?? "",
                        Unit = reagentRow["unit"]
                    },
                    LotNo = ReadGroup(match, pattern["lot_no_group"]),
                    ExpiryDate = BarcodeExpiryDateNormalizer.Normalize(ReadGroup(match, pattern["exp_date_group"]))
                };
            }
            catch (RegexMatchTimeoutException)
            {
                // Fail closed and continue to the manual-input path.
            }
            catch (ArgumentException)
            {
                // Invalid/unsupported cached regex cannot become a match.
            }
        }

        return null;
    }, cancellationToken);

    private async Task<T> WithDatabaseAsync<T>(Func<NativeSqlite, T> action, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var path = Path.IsPathRooted(_options.DatabasePath)
                ? _options.DatabasePath
                : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, _options.DatabasePath));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            using var database = new NativeSqlite(path);
            return action(database);
        }
        finally
        {
            _gate.Release();
        }
    }

    private static string NormalizeLookupValue(string value) => value.Trim()
        .Replace("]d2", "", StringComparison.OrdinalIgnoreCase)
        .Where(char.IsLetterOrDigit)
        .Aggregate("", (current, character) => current + character)
        .TrimStart('0')
        .ToLowerInvariant();

    private static string Sql(string? value) => value is null ? "NULL" : $"'{value.Replace("'", "''")}'";
    private static string Sql(int? value) => value is null ? "NULL" : value.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
    private static string Sql(DateTimeOffset value) => Sql(value.ToString("O"));

    private static string? ReadGroup(Match match, string? groupText)
    {
        if (!int.TryParse(groupText, out var groupIndex) || groupIndex <= 0 || groupIndex >= match.Groups.Count)
        {
            return null;
        }

        var value = match.Groups[groupIndex].Value.Trim();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }
}

public sealed class V2BarcodeMatch
{
    public long PatternId { get; init; }
    public string PatternName { get; init; } = "";
    public CatalogReagent Reagent { get; init; } = new();
    public string? LotNo { get; init; }
    public string? ExpiryDate { get; init; }
}
