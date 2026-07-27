using System.Runtime.InteropServices;
using System.Text;

namespace ReagentScannerAgent.Worker.Services;

internal sealed class NativeSqlite : IDisposable
{
    private const int Ok = 0;
    private const int OpenReadWrite = 0x00000002;
    private const int OpenCreate = 0x00000004;
    private const int OpenFullMutex = 0x00010000;

    private readonly IntPtr _database;

    public NativeSqlite(string path)
    {
        var result = sqlite3_open_v2(ToUtf8(path), out _database, OpenReadWrite | OpenCreate | OpenFullMutex, IntPtr.Zero);
        if (result != Ok)
        {
            throw new InvalidOperationException($"Cannot open SQLite database: {GetErrorMessage()}");
        }
    }

    public void Execute(string sql)
    {
        var result = sqlite3_exec(_database, ToUtf8(sql), null, IntPtr.Zero, out var errorPointer);
        if (result == Ok)
        {
            return;
        }

        var message = errorPointer == IntPtr.Zero
            ? GetErrorMessage()
            : Marshal.PtrToStringUTF8(errorPointer) ?? "Unknown SQLite error";
        if (errorPointer != IntPtr.Zero)
        {
            sqlite3_free(errorPointer);
        }

        throw new InvalidOperationException($"SQLite error {result}: {message}");
    }

    public List<Dictionary<string, string?>> Query(string sql)
    {
        var rows = new List<Dictionary<string, string?>>();
        ExecCallback callback = (_, columnCount, values, names) =>
        {
            var row = new Dictionary<string, string?>(columnCount, StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < columnCount; index++)
            {
                var namePointer = Marshal.ReadIntPtr(names, index * IntPtr.Size);
                var valuePointer = Marshal.ReadIntPtr(values, index * IntPtr.Size);
                var name = Marshal.PtrToStringUTF8(namePointer) ?? $"column_{index}";
                row[name] = valuePointer == IntPtr.Zero ? null : Marshal.PtrToStringUTF8(valuePointer);
            }

            rows.Add(row);
            return 0;
        };

        var result = sqlite3_exec(_database, ToUtf8(sql), callback, IntPtr.Zero, out var errorPointer);
        GC.KeepAlive(callback);
        if (result == Ok)
        {
            return rows;
        }

        var message = errorPointer == IntPtr.Zero
            ? GetErrorMessage()
            : Marshal.PtrToStringUTF8(errorPointer) ?? "Unknown SQLite error";
        if (errorPointer != IntPtr.Zero)
        {
            sqlite3_free(errorPointer);
        }

        throw new InvalidOperationException($"SQLite error {result}: {message}");
    }

    public void Dispose()
    {
        if (_database != IntPtr.Zero)
        {
            sqlite3_close_v2(_database);
        }
    }

    private string GetErrorMessage() => Marshal.PtrToStringUTF8(sqlite3_errmsg(_database)) ?? "Unknown SQLite error";

    private static byte[] ToUtf8(string value) => Encoding.UTF8.GetBytes(value + '\0');

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int ExecCallback(IntPtr context, int columnCount, IntPtr values, IntPtr names);

    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_open_v2(byte[] filename, out IntPtr database, int flags, IntPtr virtualFileSystem);

    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_exec(
        IntPtr database,
        byte[] sql,
        ExecCallback? callback,
        IntPtr context,
        out IntPtr errorMessage);

    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr sqlite3_errmsg(IntPtr database);

    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern void sqlite3_free(IntPtr pointer);

    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_close_v2(IntPtr database);
}
