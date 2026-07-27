namespace ReagentScannerAgent.Worker.Services;

public sealed class StationApiException : Exception
{
    public StationApiException(int statusCode, string message, string? errorCode = null)
        : base(message)
    {
        StatusCode = statusCode;
        ErrorCode = errorCode;
    }

    public int StatusCode { get; }

    public string? ErrorCode { get; }
}
