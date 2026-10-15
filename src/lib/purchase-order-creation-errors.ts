// Leaf module (imports nothing): PurchaseOrderCreationError.
// api-response.ts needs it, and purchase-order-suggestions.ts reaches api-response.ts through scoped-db.ts,
// so keeping the class in purchase-order-creation.ts (which imports the suggestions) would create an import cycle.

export class PurchaseOrderCreationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}
