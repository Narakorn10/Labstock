using System.Globalization;

namespace ReagentScannerAgent.Worker.Services;

/// <summary>
/// Converts expiry values captured by a V2 barcode pattern to the date-only
/// format accepted by the station API. Invalid or ambiguous values are
/// rejected instead of being forwarded as a value that could be stored as the
/// wrong date or make the sync request fail.
/// </summary>
public static class BarcodeExpiryDateNormalizer
{
    public static string? Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;

        var digits = new string(value.Where(char.IsDigit).ToArray());
        return digits.Length switch
        {
            8 => NormalizeEightDigits(digits),
            6 => NormalizeSixDigits(digits),
            _ => null
        };
    }

    private static string? NormalizeEightDigits(string value)
    {
        var candidates = new List<DateOnly>(capacity: 2);

        if ((value.StartsWith("19", StringComparison.Ordinal) || value.StartsWith("20", StringComparison.Ordinal)) &&
            TryCreateDate(value[..4], value[4..6], value[6..8], out var yearFirstDate))
        {
            candidates.Add(yearFirstDate);
        }

        var dayFirstYear = value[4..8];
        if ((dayFirstYear.StartsWith("19", StringComparison.Ordinal) || dayFirstYear.StartsWith("20", StringComparison.Ordinal)) &&
            TryCreateDate(value[4..8], value[2..4], value[..2], out var dayFirstDate))
        {
            candidates.Add(dayFirstDate);
        }

        var distinctCandidates = candidates.Distinct().ToList();
        return distinctCandidates.Count == 1
            ? distinctCandidates[0].ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : null;
    }

    private static string? NormalizeSixDigits(string value)
    {
        var candidates = new List<DateOnly>(capacity: 2);

        // YYMMDD: this is the GS1 date representation.
        if (TryCreateDate(TwoDigitYear(value[..2]), value[2..4], value[4..6], out var yearFirstDate))
        {
            candidates.Add(yearFirstDate);
        }

        // DDMMYY: used by some vendor labels.
        if (TryCreateDate(TwoDigitYear(value[4..6]), value[2..4], value[..2], out var dayFirstDate))
        {
            candidates.Add(dayFirstDate);
        }

        // If both interpretations are valid, guessing could persist the
        // wrong expiry date. The operator can complete the old manual path.
        var distinctCandidates = candidates.Distinct().ToList();
        return distinctCandidates.Count == 1
            ? distinctCandidates[0].ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : null;
    }

    private static string TwoDigitYear(string value)
    {
        var year = int.Parse(value, CultureInfo.InvariantCulture);
        return (year >= 70 ? 1900 + year : 2000 + year).ToString("0000", CultureInfo.InvariantCulture);
    }

    private static bool TryCreateDate(string yearText, string monthText, string dayText, out DateOnly date)
    {
        date = default;
        if (!int.TryParse(yearText, NumberStyles.None, CultureInfo.InvariantCulture, out var year) ||
            !int.TryParse(monthText, NumberStyles.None, CultureInfo.InvariantCulture, out var month) ||
            !int.TryParse(dayText, NumberStyles.None, CultureInfo.InvariantCulture, out var day))
        {
            return false;
        }

        try
        {
            date = new DateOnly(year, month, day);
            return true;
        }
        catch (ArgumentOutOfRangeException)
        {
            return false;
        }
    }
}
