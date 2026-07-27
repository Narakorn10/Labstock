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
    private static string Sql(DateTimeOffset value) => Sql(value.ToString("O"));
}
