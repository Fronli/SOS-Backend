import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { wallet_table, wallet_transaction_table } from '../db/schema';

type DbLike = typeof db;
type Tx = Parameters<Parameters<DbLike['transaction']>[0]>[0];

export type WalletReference = {
    type: string;
    id?: number | null;
};

export class WalletError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
        this.name = 'WalletError';
    }
}

/** Rupiah is integer-only; reject anything that is not a safe non-negative integer. */
export function assertAmount(amount: unknown, label = 'Nominal'): number {
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || !Number.isSafeInteger(amount)) {
        throw new WalletError(400, `${label} harus berupa integer rupiah yang valid.`);
    }
    return amount;
}

export async function getOrCreateWallet(tx: Tx, userId: number) {
    const [existing] = await tx
        .select()
        .from(wallet_table)
        .where(eq(wallet_table.user_id, userId))
        .limit(1);
    if (existing) return existing;

    await tx
        .insert(wallet_table)
        .values({ user_id: userId })
        .onConflictDoNothing({ target: wallet_table.user_id });

    const [created] = await tx
        .select()
        .from(wallet_table)
        .where(eq(wallet_table.user_id, userId))
        .limit(1);
    return created;
}

async function lockWallet(tx: Tx, userId: number) {
    await getOrCreateWallet(tx, userId);
    const [wallet] = await tx
        .select()
        .from(wallet_table)
        .where(eq(wallet_table.user_id, userId))
        .for('update');
    return wallet;
}

type LedgerType = 'TOPUP' | 'WITHDRAWAL' | 'HOLD' | 'RELEASE' | 'REFUND' | 'FEE' | 'ADJUSTMENT';

type LedgerEntry = {
    userId: number;
    type: LedgerType;
    amount: number;
    balanceAfter: number;
    heldAfter: number;
    reference: WalletReference;
    note?: string | null;
    status?: 'PENDING' | 'SUCCESS' | 'FAILED';
};

async function writeLedger(tx: Tx, entry: LedgerEntry) {
    const [row] = await tx.insert(wallet_transaction_table).values({
        user_id: entry.userId,
        type: entry.type,
        status: entry.status ?? 'SUCCESS',
        amount: entry.amount,
        balance_after: entry.balanceAfter,
        held_after: entry.heldAfter,
        reference_type: entry.reference.type,
        reference_id: entry.reference.id ?? null,
        note: entry.note ?? null,
    }).returning();
    return row;
}

/**
 * Moves `amount` from available balance to held. Used when funding an assignment.
 * Throws 402 when the balance is insufficient.
 */
export async function hold(tx: Tx, userId: number, amount: number, reference: WalletReference) {
    assertAmount(amount, 'Nominal penahanan');
    const wallet = await lockWallet(tx, userId);

    if (wallet.balance < amount) {
        throw new WalletError(402, 'Saldo tidak mencukupi untuk mendanai assignment ini.');
    }

    const [updated] = await tx
        .update(wallet_table)
        .set({
            balance: wallet.balance - amount,
            held: wallet.held + amount,
            updated_at: new Date(),
        })
        .where(eq(wallet_table.user_id, userId))
        .returning();

    await writeLedger(tx, {
        userId,
        type: 'HOLD',
        amount,
        balanceAfter: updated.balance,
        heldAfter: updated.held,
        reference,
    });
    return updated;
}

/**
 * Releases held funds from the requester to the helper.
 * When a platform fee applies, the helper receives `amount - fee` and the fee is
 * recorded as a FEE ledger row on the helper's account.
 */
export async function release(
    tx: Tx,
    fromUserId: number,
    toUserId: number,
    amount: number,
    reference: WalletReference,
    feeAmount = 0,
) {
    assertAmount(amount, 'Nominal pelepasan');
    assertAmount(feeAmount, 'Nominal fee');
    if (feeAmount > amount) {
        throw new WalletError(400, 'Fee tidak boleh melebihi nominal.');
    }

    const source = await lockWallet(tx, fromUserId);
    if (source.held < amount) {
        throw new WalletError(409, 'Dana yang ditahan tidak mencukupi untuk dilepas.');
    }

    const [updatedSource] = await tx
        .update(wallet_table)
        .set({ held: source.held - amount, updated_at: new Date() })
        .where(eq(wallet_table.user_id, fromUserId))
        .returning();

    await writeLedger(tx, {
        userId: fromUserId,
        type: 'RELEASE',
        amount,
        balanceAfter: updatedSource.balance,
        heldAfter: updatedSource.held,
        reference,
    });

    const target = await lockWallet(tx, toUserId);
    const net = amount - feeAmount;
    const [updatedTarget] = await tx
        .update(wallet_table)
        .set({ balance: target.balance + net, updated_at: new Date() })
        .where(eq(wallet_table.user_id, toUserId))
        .returning();

    await writeLedger(tx, {
        userId: toUserId,
        type: 'RELEASE',
        amount: net,
        balanceAfter: updatedTarget.balance,
        heldAfter: updatedTarget.held,
        reference,
        note: feeAmount > 0 ? `Diterima setelah fee platform ${feeAmount}` : null,
    });

    if (feeAmount > 0) {
        await writeLedger(tx, {
            userId: toUserId,
            type: 'FEE',
            amount: feeAmount,
            balanceAfter: updatedTarget.balance,
            heldAfter: updatedTarget.held,
            reference,
            note: 'Fee platform',
        });
    }

    return { source: updatedSource, target: updatedTarget };
}

/** Returns held funds to the requester's available balance. */
export async function refund(
    tx: Tx,
    userId: number,
    amount: number,
    reference: WalletReference,
    note?: string,
) {
    assertAmount(amount, 'Nominal refund');
    const wallet = await lockWallet(tx, userId);

    if (wallet.held < amount) {
        throw new WalletError(409, 'Dana yang ditahan tidak mencukupi untuk refund.');
    }

    const [updated] = await tx
        .update(wallet_table)
        .set({
            balance: wallet.balance + amount,
            held: wallet.held - amount,
            updated_at: new Date(),
        })
        .where(eq(wallet_table.user_id, userId))
        .returning();

    await writeLedger(tx, {
        userId,
        type: 'REFUND',
        amount,
        balanceAfter: updated.balance,
        heldAfter: updated.held,
        reference,
        note,
    });

    return updated;
}

/** Credits (TOPUP) or debits (WITHDRAWAL) available balance directly. */
export async function adjust(
    tx: Tx,
    userId: number,
    amount: number,
    type: 'TOPUP' | 'ADJUSTMENT' | 'WITHDRAWAL',
    reference: WalletReference,
    note?: string,
) {
    assertAmount(amount, 'Nominal penyesuaian');
    const wallet = await lockWallet(tx, userId);
    const signed = type === 'WITHDRAWAL' ? -amount : amount;
    const nextBalance = wallet.balance + signed;

    if (nextBalance < 0) {
        throw new WalletError(402, 'Saldo tidak mencukupi.');
    }

    const [updated] = await tx
        .update(wallet_table)
        .set({ balance: nextBalance, updated_at: new Date() })
        .where(eq(wallet_table.user_id, userId))
        .returning();

    await writeLedger(tx, {
        userId,
        type,
        amount,
        balanceAfter: updated.balance,
        heldAfter: updated.held,
        reference,
        note: note ?? null,
    });

    return updated;
}

export function platformFee(amount: number): number {
    const percent = Number(process.env.PLATFORM_FEE_PERCENT || 0);
    if (!Number.isFinite(percent) || percent <= 0) return 0;
    const fee = Math.floor((amount * Math.min(percent, 100)) / 100);
    return Math.max(0, Math.min(fee, amount));
}
