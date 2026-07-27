using System.Globalization;
using System.Text.RegularExpressions;

namespace ReagentScannerAgent.Worker.Services;

public sealed record Gs1UdiData(string Gtin, string? Lot, string? ExpiryDate, string? ManufactureDate, string? Serial, string RawBarcode);

// C# port of the GS1 branch in src/lib/barcode-parser.ts.
public static class Gs1UdiParser
{
    private static readonly Regex HumanReadableAi = new(@"\((01|10|11|17|21|240)\)([^()]*)", RegexOptions.Compiled);
    private static readonly string[] SupportedAis = ["01", "10", "11", "17", "21", "240"];

    public static Gs1UdiData? Parse(string rawBarcode)
    {
        if (string.IsNullOrWhiteSpace(rawBarcode)) return null;

        var elements = new Dictionary<string, string>();
        void Add(string ai, string? value)
        {
            var clean = value?.Trim();
            if (!string.IsNullOrWhiteSpace(clean) && !elements.ContainsKey(ai)) elements[ai] = clean;
        }

        foreach (Match match in HumanReadableAi.Matches(rawBarcode)) Add(match.Groups[1].Value, match.Groups[2].Value);
        ParseDigitalLink(rawBarcode, Add);

        var compact = Regex.Replace(rawBarcode.Trim(), @"^\][a-zA-Z0-9]{2}", "");
        compact = Regex.Replace(compact, @"\((01|10|11|17|21|240)\)", "$1");
        compact = Regex.Replace(compact, @"\s", "");
        foreach (var segment in Regex.Split(compact, @"\x1D|<GS>|\|", RegexOptions.IgnoreCase)) ParseCompactSegment(segment, Add);

        if (!elements.TryGetValue("01", out var gtin)) return null;
        return new Gs1UdiData(gtin, elements.GetValueOrDefault("10"), FormatGs1Date(elements.GetValueOrDefault("17")),
            FormatGs1Date(elements.GetValueOrDefault("11")), elements.GetValueOrDefault("21"), rawBarcode);
    }

    private static void ParseDigitalLink(string rawBarcode, Action<string, string?> add)
    {
        if (!Uri.TryCreate(rawBarcode, UriKind.Absolute, out var uri)) return;
        var parts = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var index = 0; index + 1 < parts.Length; index += 1)
        {
            if (SupportedAis.Contains(parts[index], StringComparer.Ordinal)) add(parts[index], Uri.UnescapeDataString(parts[index + 1]));
        }

        foreach (var part in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = part.Split('=', 2);
            if (pair.Length == 2 && SupportedAis.Contains(pair[0], StringComparer.Ordinal)) add(pair[0], Uri.UnescapeDataString(pair[1]));
        }
    }

    private static void ParseCompactSegment(string segment, Action<string, string?> add)
    {
        var cursor = 0;
        while (cursor < segment.Length)
        {
            var ai3 = cursor + 3 <= segment.Length ? segment.Substring(cursor, 3) : "";
            var ai = cursor + 2 <= segment.Length ? segment.Substring(cursor, 2) : "";
            if (ai == "01" && cursor + 16 <= segment.Length && Regex.IsMatch(segment.Substring(cursor + 2, 14), "^\\d{14}$"))
            {
                add(ai, segment.Substring(cursor + 2, 14)); cursor += 16;
            }
            else if ((ai == "11" || ai == "17") && cursor + 8 <= segment.Length && IsValidGs1Date(segment.Substring(cursor + 2, 6)))
            {
                add(ai, segment.Substring(cursor + 2, 6)); cursor += 8;
            }
            else if (ai3 == "240" || ai == "10" || ai == "21")
            {
                var code = ai3 == "240" ? ai3 : ai;
                var start = cursor + code.Length;
                var remaining = segment.Substring(start);
                var boundary = FindFixedAiBoundary(remaining);
                add(code, boundary > 0 ? remaining.Substring(0, boundary) : remaining);
                if (boundary <= 0) break;
                cursor = start + boundary;
            }
            else break;
        }
    }

    private static int FindFixedAiBoundary(string value)
    {
        for (var index = 1; index < value.Length; index += 1)
        {
            var ai = value.Substring(index, Math.Min(2, value.Length - index));
            if ((ai == "11" || ai == "17") && index + 8 <= value.Length && IsValidGs1Date(value.Substring(index + 2, 6))) return index;
        }
        return -1;
    }

    private static bool IsValidGs1Date(string value) => DateOnly.TryParseExact(value, "yyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
    private static string? FormatGs1Date(string? value) => IsValidGs1Date(value ?? "")
        ? DateOnly.ParseExact(value!, "yyMMdd", CultureInfo.InvariantCulture).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
        : null;
}
