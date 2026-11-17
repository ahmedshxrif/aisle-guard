// A hard spending cap. Money is reserved before a model call and settled after it, so two
// conversations arriving together can never both spend the last of the budget.

export interface Reservation {
  id: number;
  month: string;
  amountUsd: number;
}

export interface BudgetOptions {
  monthlyCapUsd: number;
  /** Share of the cap that is never spent, as a safety margin. */
  reserveShare?: number;
  now?: () => Date;
}

export class BudgetGuard {
  #cap: number;
  #now: () => Date;
  #month = "";
  #settled = 0;
  #held = new Map<number, number>();
  #nextId = 1;

  constructor({ monthlyCapUsd, reserveShare = 0.1, now = () => new Date() }: BudgetOptions) {
    if (!(monthlyCapUsd > 0)) throw new RangeError("monthlyCapUsd must be greater than 0");
    this.#cap = monthlyCapUsd * (1 - reserveShare);
    this.#now = now;
  }

  #rollOver(): string {
    const month = this.#now().toISOString().slice(0, 7);
    if (month !== this.#month) {
      this.#month = month;
      this.#settled = 0;
      this.#held.clear();
    }
    return month;
  }

  /** Money already spent or currently reserved this month. */
  committedUsd(): number {
    this.#rollOver();
    let held = 0;
    for (const amount of this.#held.values()) held += amount;
    return this.#settled + held;
  }

  remainingUsd(): number {
    return Math.max(0, this.#cap - this.committedUsd());
  }

  /** Reserve money for one call. Returns null when the cap would be exceeded: the caller must not call the model. */
  tryReserve(estimateUsd: number): Reservation | null {
    const month = this.#rollOver();
    if (this.committedUsd() + estimateUsd > this.#cap) return null;
    const id = this.#nextId++;
    this.#held.set(id, estimateUsd);
    return { id, month, amountUsd: estimateUsd };
  }

  /** Replace the reservation with what the call really cost. */
  settle(reservation: Reservation, actualUsd: number): void {
    this.#rollOver();
    if (this.#held.delete(reservation.id)) this.#settled += actualUsd;
  }

  /** Release a reservation when the call never happened. */
  release(reservation: Reservation): void {
    this.#held.delete(reservation.id);
  }
}
