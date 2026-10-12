// Leaf module (imports nothing): the confirm-failure types and CountConfirmError.
// api-response.ts needs CountConfirmError, and count-work-orders.ts reaches api-response.ts through scoped-db.ts,
// so keeping the class in count-work-orders.ts would create an import cycle.

export type ConfirmFailureReason = "INACTIVE" | "NOT_PENDING" | "QTY_MISMATCH" | "LOT_INVALID" | "INSUFFICIENT";
export type ConfirmFailure = { itemId: string; name: string | null; reason: ConfirmFailureReason; requiredQty: number | null; requestedQty: number; available: number };
export type ConfirmRemaining = { itemId: string; name: string; requiredQty: number };

// Raised when nothing could be dispensed; carries the per-item reasons so the UI can explain what to do next.
export class CountConfirmError extends Error {
  constructor(message: string, readonly failed: ConfirmFailure[], readonly remaining: ConfirmRemaining[]) {
    super(message);
    this.name = "CountConfirmError";
  }
}
