// Shared rent / electric due maths — used by Dues & Payments, Reports and Final Settlement
// so every screen agrees on what a room owes.

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export const recType = (rec) => rec.packageName || rec.paymentType || '';

// Which month a bill belongs to ("2026-09"): the Billing Month chosen on the receipt,
// or (older receipts) the month it was issued.
export const billMonthKey = (rec) => rec.monthYear || (rec.receiptDate ? ym(new Date(rec.receiptDate)) : '');

export const monthLabel = (key) => {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
};

// Fraction of a receipt that is RENT (a Final Bill also bundles electric / advance).
export const rentShare = (rec) => {
  const t = recType(rec);
  if (t === 'rent') return 1;
  if (t !== 'final') return 0;
  const total = rec.totalAmount || 0;
  if (!(total > 0)) return 0;
  const rent = rec.rentComponent != null
    ? rec.rentComponent
    : Math.max(0, total - (rec.electricAmount || 0) - (rec.advanceComponent || 0));
  return Math.min(1, rent / total);
};

/**
 * Rent owed by one room, kept as separate pieces so old and new never get mixed up:
 *   previousBalance    – unpaid balance of bills for EARLIER months (part payments)
 *   currentBillBalance – unpaid balance of a bill already raised for THIS month
 *   newRent            – this month's rent, when it is due and no bill exists for it yet
 *   rentDue            – previousBalance + currentBillBalance + newRent (total pending)
 *   paidThisMonth      – rent actually received this month (all installments)
 * Installments never add to anything here: only the root bill carries a balance.
 */
export function computeRentDue({ roomNumber, fixedRent, paidThrough, today = new Date(), receipts }) {
  const curKey = ym(today);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

  const roots = receipts.filter(r => r.roomNumber === roomNumber && !r.parentReceiptId && r.isPartPayment && rentShare(r) > 0);

  const items = roots
    .filter(r => (r.balanceDue || 0) > 0)
    .map(r => ({ receipt: r, monthKey: billMonthKey(r), balance: r2((r.balanceDue || 0) * rentShare(r)) }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const previousItems = items.filter(i => i.monthKey < curKey);
  const currentItems  = items.filter(i => i.monthKey >= curKey);
  const previousBalance    = r2(previousItems.reduce((s, i) => s + i.balance, 0));
  const currentBillBalance = r2(currentItems.reduce((s, i) => s + i.balance, 0));

  const owedByDate = fixedRent > 0 && (!paidThrough || paidThrough <= monthEnd);
  const alreadyBilledThisMonth = roots.some(r => billMonthKey(r) === curKey);
  const newRent = owedByDate && !alreadyBilledThisMonth ? fixedRent : 0;

  const paidThisMonth = r2(receipts
    .filter(r => r.roomNumber === roomNumber && rentShare(r) > 0 && r.receiptDate && ym(new Date(r.receiptDate)) === curKey)
    .reduce((s, r) => s + (r.amountPaid ?? r.totalAmount ?? 0) * rentShare(r), 0));

  return {
    previousItems, currentItems,
    previousBalance, currentBillBalance, newRent,
    rentDue: r2(previousBalance + currentBillBalance + newRent),
    paidThisMonth,
    currentMonthLabel: monthLabel(curKey),
  };
}

// One electric reading: what it cost, what has been paid against it, what is left.
// Mirrors the Dues & Payments rules (waived / manual Paid-Unpaid / receipts incl. Final Bills).
export function electricReadingDue(reading, roomReceipts) {
  const waived = reading.paymentStatus === 'waived';
  const manualPaid   = !waived && reading.manualOverride && reading.paymentStatus === 'paid';
  const manualUnpaid = !waived && reading.manualOverride && reading.paymentStatus === 'unpaid';
  const total = waived ? 0 : (reading.totalAmount || 0);
  const key = `${reading.year}-${String(reading.month).padStart(2, '0')}`;
  const forThis = (rec) => rec.monthYear
    ? rec.monthYear === key
    : (rec.receiptDate && new Date(rec.receiptDate).getFullYear() === reading.year && new Date(rec.receiptDate).getMonth() + 1 === reading.month);
  const direct = (waived || manualUnpaid) ? 0 : roomReceipts
    .filter(rec => recType(rec) === 'electric' && forThis(rec))
    .reduce((s, rec) => s + (rec.amountPaid ?? rec.totalAmount ?? 0), 0);
  const inFinal = (waived || manualUnpaid) ? 0 : roomReceipts
    .filter(rec => recType(rec) === 'final' && forThis(rec) && rec.electricAmount > 0)
    .reduce((s, rec) => s + rec.electricAmount * (rec.totalAmount > 0 ? (rec.amountPaid ?? rec.totalAmount) / rec.totalAmount : 1), 0);
  const marked = (!waived && !manualUnpaid && reading.paymentStatus === 'paid') ? total : 0;
  const paid = manualUnpaid ? 0 : direct + inFinal + marked;
  const due = manualPaid ? 0 : Math.max(0, r2(total - paid));
  return { total, paid: r2(paid), due, waived };
}

export const METHODS = [
  { value: 'cash',          label: 'Cash',          mode: 'cash'   },
  { value: 'upi',           label: 'UPI',           mode: 'online' },
  { value: 'bank_transfer', label: 'Bank Transfer', mode: 'online' },
  { value: 'card',          label: 'Card',          mode: 'online' },
  { value: 'cheque',        label: 'Cheque',        mode: 'online' },
  { value: 'online_other',  label: 'Other Online',  mode: 'online' },
];
export const methodLabel = (rec) => {
  const v = rec.paymentMethod || (rec.modeOfPayment === 'online' ? 'online_other' : 'cash');
  return (METHODS.find(m => m.value === v) || METHODS[5]).label;
};
