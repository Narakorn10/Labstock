import type { Reagent } from "@/lib/api-client";

export const NEAR_EXPIRY_DAYS = 30;

export interface WatchLot {
  itemId: string;
  name: string;
  lotNo: string;
  expDate: string;
  daysLeft: number;
}

export interface MobileFocusStats {
  expiredLots: number;
  belowMin: number;
  nearExpiryLots: number;
  /** Expired lots first (oldest first), then lots expiring within NEAR_EXPIRY_DAYS (soonest first). */
  watchList: WatchLot[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const toDayNumber = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
};

export const toLocalDateString = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

/**
 * Focus numbers for the mobile home screen. Uses the same rules as the desktop dashboard:
 * low = quantity <= minThreshold, expired = expDate before today, near expiry = within 30 days.
 * The lookup API only returns lots that still have stock, so an expired lot with no stock left is not counted.
 * `today` is a local YYYY-MM-DD string so the result does not depend on the device time zone.
 */
export function getMobileFocusStats(reagents: Reagent[], today: string): MobileFocusStats {
  const todayNumber = toDayNumber(today);
  const empty: MobileFocusStats = { expiredLots: 0, belowMin: 0, nearExpiryLots: 0, watchList: [] };
  if (todayNumber === null) return empty;

  let expiredLots = 0;
  let nearExpiryLots = 0;
  let belowMin = 0;
  const watchList: WatchLot[] = [];

  for (const reagent of reagents) {
    if (reagent.quantity <= reagent.minThreshold) belowMin += 1;

    for (const lot of reagent.lots) {
      const expNumber = toDayNumber(lot.expDate);
      if (expNumber === null) continue;

      const daysLeft = expNumber - todayNumber;
      if (daysLeft < 0) {
        expiredLots += 1;
      } else if (daysLeft <= NEAR_EXPIRY_DAYS) {
        nearExpiryLots += 1;
      } else {
        continue;
      }

      watchList.push({ itemId: reagent.itemId, name: reagent.name, lotNo: lot.lotNo, expDate: lot.expDate, daysLeft });
    }
  }

  watchList.sort((a, b) => a.daysLeft - b.daysLeft);
  return { expiredLots, belowMin, nearExpiryLots, watchList };
}
