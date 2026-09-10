using System.Globalization;
using ReagentScannerAgent.Worker.Models;

namespace ReagentScannerAgent.Worker.Services;

// Keyboard-wedge barcode scanners submit their scan as text followed by Enter.
public sealed class ConsoleWithdrawalInput
{
    private readonly QueueStore _queueStore;
    private readonly CatalogStore _catalogStore;
    private readonly StationApiClient _stationApiClient;

    public ConsoleWithdrawalInput(QueueStore queueStore, CatalogStore catalogStore, StationApiClient stationApiClient)
    {
        _queueStore = queueStore;
        _catalogStore = catalogStore;
        _stationApiClient = stationApiClient;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        PrintBanner();

        while (!cancellationToken.IsCancellationRequested)
        {
            var username = ReadRequired("ผู้เบิก (username): ", cancellationToken);
            var pin = ReadRequired("PIN ผู้เบิก: ", cancellationToken);
            if (username is null || pin is null)
            {
                return;
            }

            UserAuthorizationResponse authorization;
            try
            {
                authorization = await _stationApiClient.AuthorizeUserAsync(username, pin, cancellationToken);
            }
            catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
            {
                Console.WriteLine($"ยืนยันผู้เบิกไม่สำเร็จ: {exception.Message}");
                continue;
            }

            var sessionId = Guid.NewGuid().ToString("N");
            var items = new List<WithdrawalItem>();
            Console.WriteLine("สแกน barcode แล้วกด Enter หรือพิมพ์ confirm, cancel, status");

            while (!cancellationToken.IsCancellationRequested)
            {
                Console.Write($"[{items.Count} รายการ] > ");
                var scan = Console.ReadLine()?.Trim();
                if (scan is null)
                {
                    return;
                }

                if (scan.Equals("cancel", StringComparison.OrdinalIgnoreCase))
                {
                    items.Clear();
                    Console.WriteLine("ยกเลิกรายการใน session นี้แล้ว");
                    break;
                }

                if (scan.Equals("status", StringComparison.OrdinalIgnoreCase))
                {
                    var metrics = await _queueStore.GetMetricsAsync(cancellationToken);
                    Console.WriteLine($"คิว: รอ={metrics.PendingSync + metrics.RetryWait + metrics.Syncing}, ปัญหา={metrics.Conflict + metrics.Rejected}, สำเร็จ={metrics.Synced}");
                    continue;
                }

                if (scan.Equals("confirm", StringComparison.OrdinalIgnoreCase))
                {
                    if (items.Count == 0)
                    {
                        Console.WriteLine("ยังไม่มีรายการให้ยืนยัน");
                        continue;
                    }

                    var record = new QueueRecord
                    {
                        IdempotencyKey = Guid.NewGuid().ToString("N"),
                        LocalQueueId = Guid.NewGuid().ToString("N"),
                        LocalSessionId = sessionId,
                        Username = authorization.Username,
                        UserAuthorizationToken = authorization.AuthorizationToken,
                        OccurredAt = DateTimeOffset.UtcNow,
                        Items = items
                    };
                    await _queueStore.SaveAsync(record, cancellationToken);
                    Console.WriteLine($"บันทึกการเบิกใน SQLite แล้ว ({items.Count} รายการ) ระบบจะ sync อัตโนมัติ");
                    break;
                }

                if (string.IsNullOrWhiteSpace(scan))
                {
                    continue;
                }

                var item = await ReadScannedItemAsync(scan, cancellationToken);
                if (item is not null)
                {
                    items.Add(item);
                    Console.WriteLine($"เพิ่ม: {item.ItemId}, lot {item.LotNo}, จำนวน {item.Quantity}");
                }
            }
        }
    }

    private async Task<WithdrawalItem?> ReadScannedItemAsync(string barcode, CancellationToken cancellationToken)
    {
        var gs1 = Gs1UdiParser.Parse(barcode);
        if (gs1 is not null && !string.IsNullOrWhiteSpace(gs1.Lot))
        {
            var reagent = await _catalogStore.FindByGtinAsync(gs1.Gtin, cancellationToken);
            if (reagent is not null)
            {
                return ReadGs1Item(barcode, reagent, gs1, cancellationToken);
            }

            Console.WriteLine($"ไม่พบ GTIN {gs1.Gtin} ใน master data cache; กรุณากรอกข้อมูลเอง");
        }

        // V2 is deliberately limited to the old manual-input gap. It never
        // runs for GS1 payloads and never changes the legacy GS1/manual path.
        if (gs1 is null)
        {
            var v2 = await _catalogStore.FindByV2Async(barcode, cancellationToken);
            if (v2 is not null)
            {
                return ReadV2Item(barcode, v2, cancellationToken);
            }
        }

        return ReadItem(barcode, cancellationToken);
    }

    private static WithdrawalItem? ReadV2Item(string barcode, V2BarcodeMatch match, CancellationToken cancellationToken)
    {
        Console.WriteLine($"QR V2: {match.Reagent.Name} ({match.Reagent.ItemId}), lot {match.LotNo ?? "-"}, expiry {match.ExpiryDate ?? "-"}");
        var quantityText = ReadRequired("จำนวน: ", cancellationToken);
        if (quantityText is null || !TryParseQuantity(quantityText, out var quantity))
        {
            Console.WriteLine("จำนวนต้องมากกว่า 0");
            return null;
        }

        return new WithdrawalItem
        {
            LocalEventId = Guid.NewGuid().ToString("N"),
            ItemId = match.Reagent.ItemId,
            LotNo = match.LotNo ?? ReadRequired("Lot: ", cancellationToken) ?? "",
            Quantity = quantity,
            ExpiryDate = match.ExpiryDate,
            RawBarcode = barcode
        };
    }

    private static WithdrawalItem? ReadGs1Item(string barcode, CatalogReagent reagent, Gs1UdiData gs1, CancellationToken cancellationToken)
    {
        Console.WriteLine($"GS1: {reagent.Name} ({reagent.ItemId}), lot {gs1.Lot}, expiry {gs1.ExpiryDate ?? "-"}");
        var quantityText = ReadRequired("จำนวน: ", cancellationToken);
        if (quantityText is null || !TryParseQuantity(quantityText, out var quantity))
        {
            Console.WriteLine("จำนวนต้องมากกว่า 0");
            return null;
        }

        return new WithdrawalItem
        {
            LocalEventId = Guid.NewGuid().ToString("N"),
            ItemId = reagent.ItemId,
            LotNo = gs1.Lot!,
            Quantity = quantity,
            ExpiryDate = gs1.ExpiryDate,
            RawBarcode = barcode
        };
    }

    private static WithdrawalItem? ReadItem(string barcode, CancellationToken cancellationToken)
    {
        var itemId = ReadRequired("รหัสน้ำยา (item_id): ", cancellationToken);
        var lotNo = ReadRequired("Lot: ", cancellationToken);
        var quantityText = ReadRequired("จำนวน: ", cancellationToken);
        if (itemId is null || lotNo is null || quantityText is null)
        {
            return null;
        }

        if (!TryParseQuantity(quantityText, out var quantity))
        {
            Console.WriteLine("จำนวนต้องมากกว่า 0");
            return null;
        }

        Console.Write("วันหมดอายุ YYYY-MM-DD (เว้นว่างได้): ");
        var expiryDate = Console.ReadLine()?.Trim();
        if (!string.IsNullOrWhiteSpace(expiryDate) && !DateOnly.TryParseExact(expiryDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
        {
            Console.WriteLine("รูปแบบวันหมดอายุไม่ถูกต้อง");
            return null;
        }

        return new WithdrawalItem
        {
            LocalEventId = Guid.NewGuid().ToString("N"),
            ItemId = itemId,
            LotNo = lotNo,
            Quantity = quantity,
            ExpiryDate = string.IsNullOrWhiteSpace(expiryDate) ? null : expiryDate,
            RawBarcode = barcode
        };
    }

    private static bool TryParseQuantity(string value, out decimal quantity) =>
        (decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out quantity) ||
         decimal.TryParse(value, NumberStyles.Number, CultureInfo.CurrentCulture, out quantity)) && quantity > 0;

    private static string? ReadRequired(string prompt, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            Console.Write(prompt);
            var value = Console.ReadLine()?.Trim();
            if (value is null)
            {
                return null;
            }

            if (!string.IsNullOrWhiteSpace(value))
            {
                return value;
            }

            Console.WriteLine("ต้องระบุข้อมูลนี้");
        }

        return null;
    }

    private static void PrintBanner()
    {
        Console.WriteLine();
        Console.WriteLine("=== Reagent Scanner Agent ===");
        Console.WriteLine("คำสั่ง: confirm = ยืนยัน, cancel = ยกเลิก session, status = ดูคิว");
        Console.WriteLine();
    }
}
