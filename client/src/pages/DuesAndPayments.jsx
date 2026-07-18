import { useHostel } from '../context/HostelContext';
import React, { useEffect, useState, useCallback } from 'react';
import { membersAPI, receiptsAPI, electricAPI, roomsAPI, whatsapp as wa } from '../utils/api';
import { useToast } from '../context/ToastContext';

const fmt   = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const fmtM  = (n) => `₹${(n||0).toLocaleString('en-IN')}`;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Small colored dot + label showing a room's electric bill status for the current month.
function StatusDot({ status }) {
  const map = {
    paid:    { color: '#27ae60', label: 'Paid' },
    partial: { color: '#f39c12', label: 'Part Paid' },
    unpaid:  { color: '#c0392b', label: 'Unpaid' },
    waived:  { color: '#8e44ad', label: 'Waived' },
  };
  const s = map[status] || map.unpaid;
  return (
    <span title={s.label} style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:'0.65rem',color:s.color,fontWeight:700}}>
      <span style={{width:7,height:7,borderRadius:'50%',background:s.color,display:'inline-block'}} />
      {s.label}
    </span>
  );
}

export default function DuesAndPayments() {
  const { hostelSwitchCount } = useHostel();
  const [tab, setTab]         = useState('dues');
  const [members, setMembers] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [electric, setElectric] = useState([]);
  const [rooms, setRooms]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const toast = useToast();

  // Electric waive modal (moved here from the Electric page — waive right from the dues row)
  const [waiveTarget, setWaiveTarget] = useState(null); // the electric reading being waived
  const [waiveReason, setWaiveReason] = useState('');
  const [waiveSaving, setWaiveSaving] = useState(false);

  // Full electric history modal for a room
  const [elecHistoryRoom, setElecHistoryRoom] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      membersAPI.getAll({ limit: 500 }),
      receiptsAPI.getAll({ limit: 1000 }),
      electricAPI.getAll(),
      roomsAPI.getAll(),
    ]).then(([mR, rR, eR, roR]) => {
      setMembers(mR.data?.data || mR.data || []);
      setReceipts(rR.data?.data || rR.data || []);
      setElectric(eR.data?.data || eR.data || []);
      setRooms(Array.isArray(roR.data) ? roR.data : (roR.data?.data || []));
    }).catch(() => toast('Failed to load', 'error'))
      .finally(() => setLoading(false));
  }, [hostelSwitchCount]);

  useEffect(() => { load(); }, [load]);

  const today  = new Date();
  const now    = today;
  const curMon = now.getMonth() + 1;
  const curYr  = now.getFullYear();
  const monthEndDay = new Date(curYr, curMon, 0).getDate(); // 30 or 31 (or 28/29 for Feb)

  // ── Print helper ──────────────────────────────────────────────────────────
  const doPrint = (title, html) => {
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:16px;}
        h2{font-size:1.1rem;margin-bottom:4px;}p{font-size:0.75rem;color:#666;margin-bottom:14px;}
        table{width:100%;border-collapse:collapse;font-size:11.5px;}
        th{background:#f5f5f5;padding:7px 10px;text-align:left;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;}
        td{padding:7px 10px;border-bottom:1px solid #eee;}
        tr:nth-child(even){background:#fafafa;}
        .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;}
        .red{color:#c0392b;font-weight:700;} .gold{color:#d4920a;font-weight:700;} .green{color:#1ea85c;font-weight:700;}
        .footer{margin-top:20px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:8px;display:flex;justify-content:space-between;}
        @media print{@page{margin:8mm;size:A4;}body{padding:0;}}
      </style></head><body>${html}
      <div class="footer"><span>Printed on ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}</span><span>Hostel Management System</span></div>
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  // ── Part payments ────────────────────────────────────────────────────────
  const partPayments = receipts
    .filter(r => r.isPartPayment && (r.balanceDue || 0) > 0)
    .sort((a, b) => (b.balanceDue || 0) - (a.balanceDue || 0));
  const totalBalanceDue = partPayments.reduce((s, r) => s + (r.balanceDue || 0), 0);

  // ── Overdue members ──────────────────────────────────────────────────────
  const overdueMembers = members.filter(m =>
    m.isActive !== false && m.roomLeavingDate && new Date(m.roomLeavingDate) < today
  ).sort((a, b) => new Date(a.roomLeavingDate) - new Date(b.roomLeavingDate));

  // ── Expiring soon — user-selectable date range (default: today → +7 days) ─
  const [expireFrom, setExpireFrom] = useState('');
  const [expireTo,   setExpireTo]   = useState('');
  const expireFromDate = expireFrom ? new Date(expireFrom) : (() => { const d = new Date(today); d.setHours(0,0,0,0); return d; })();
  const expireToDate   = expireTo   ? new Date(expireTo)   : (() => { const d = new Date(today); d.setDate(d.getDate()+7); return d; })();
  const expiringSoon = members.filter(m =>
    m.isActive !== false && m.roomLeavingDate &&
    new Date(m.roomLeavingDate) >= expireFromDate &&
    new Date(m.roomLeavingDate) <= expireToDate
  ).sort((a, b) => new Date(a.roomLeavingDate) - new Date(b.roomLeavingDate));

  // Electric due for each expiring member's room (current month)
  const getElecDueForRoom = (roomNumber) => {
    const reading = electric.find(e => e.roomNumber === roomNumber && e.month === curMon && e.year === curYr);
    if (!reading) return { elecTotal: 0, elecPaid: 0, elecDue: 0 };
    // Waived bills don't count as due or as income
    if (reading.paymentStatus === 'waived') return { elecTotal: 0, elecPaid: 0, elecDue: 0 };
    // Already marked paid directly on the reading — no due
    if (reading.paymentStatus === 'paid') return { elecTotal: reading.totalAmount || 0, elecPaid: reading.totalAmount || 0, elecDue: 0 };
    const elecTotal = reading.totalAmount || 0;
    const elecPaid  = receipts.filter(r =>
      r.roomNumber === roomNumber &&
      (r.packageName === 'electric' || r.paymentType === 'electric') &&
      new Date(r.receiptDate).getMonth()+1 === curMon &&
      new Date(r.receiptDate).getFullYear() === curYr
    ).reduce((s,r) => s + (r.amountPaid || r.totalAmount || 0), 0);
    return { elecTotal, elecPaid, elecDue: Math.max(0, elecTotal - elecPaid) };
  };

  // ── Per-room dues: rent + electric for current month ─────────────────────
  // Build room dues: for each occupied room, calculate:
  //   - rent due: sum of each active member's own rent (the real, per-member
  //     value set at registration/edit) minus any rent already paid this month
  //   - electric due: current month's electric reading bill, minus any electric paid
  //
  // NOTE: rent is tracked per-MEMBER (Member.rent), not per-room. The Room's
  // own `rent` field (from the Rooms config page) is only a default template
  // used to prefill new member forms — it's frequently left at 0 and does NOT
  // reflect what a given member is actually being charged. Using it here was
  // the root cause of rooms with real dues (e.g. Room 17) silently not
  // appearing in this tab even though the member's own rent was unpaid.
  const monthEnd = new Date(curYr, curMon, 0, 23, 59, 59, 999);
  const monthKey = curYr * 12 + (curMon - 1); // e.g. July 2026 -> a single comparable integer
  const toMonthKey = (d) => { const dt = new Date(d); return dt.getFullYear() * 12 + dt.getMonth(); };

  const roomDues = rooms
    .filter(r => r.memberCount > 0)
    .map(r => {
      const rNum = r.roomNumber;
      const roomActiveMembers = members.filter(m => m.roomNumber === rNum && m.isActive !== false);
      // Rent is charged per ROOM, not per occupant — every member sharing a
      // room typically carries the same rent value on their profile (it's
      // auto-filled from Room settings). Summing them was doubling (or worse)
      // the real due for any room with more than one active member; take the
      // highest single value instead, which is the room's actual rent.
      const memberRents = roomActiveMembers.map(m => m.rent || 0).filter(v => v > 0);
      const fixedRent = memberRents.length ? Math.max(...memberRents) : (r.rent || 0);

      // Is rent due for THIS month? Every receipt with a "To Date" already
      // updates the member's roomLeavingDate (their "paid through" date) —
      // that's the one trustworthy signal for how far a member has actually
      // paid, so we use it directly instead of re-deriving it from scattered
      // receipt date ranges. If it's missing, or doesn't reach past the end
      // of this month, rent is owed for this month.
      const leaveDates = roomActiveMembers.map(m => m.roomLeavingDate).filter(Boolean).map(d => new Date(d));
      const paidThrough = leaveDates.length ? new Date(Math.min(...leaveDates)) : null;
      const rentOwedThisMonth = fixedRent > 0 && (!paidThrough || paidThrough <= monthEnd);

      let rentDue = 0;
      if (rentOwedThisMonth) {
        // If the most recent rent-type receipt for this room is an unresolved
        // part payment, show exactly what's left of it rather than the full
        // rent (so a ₹2,000 top-up needed doesn't get shown as the full rent).
        const latestRentReceipt = receipts
          .filter(rec => rec.roomNumber === rNum && (rec.packageName || rec.paymentType || '') !== 'electric')
          .sort((a, b) => new Date(b.receiptDate || 0) - new Date(a.receiptDate || 0))[0];
        rentDue = (latestRentReceipt && latestRentReceipt.isPartPayment && (latestRentReceipt.balanceDue || 0) > 0)
          ? latestRentReceipt.balanceDue
          : fixedRent;
      }

      // Electric: unlike rent (which is a single ongoing balance tracked via
      // paidThrough), each electric reading is its own separate bill for its
      // own month. Looking at only the CURRENT month's reading was the bug:
      // an unpaid bill from a prior month (with its own earlier due date)
      // would vanish the moment the calendar rolled into a new month, or get
      // silently replaced by whatever reading exists for the new month. So
      // instead, every reading for this room is checked for its own due
      // amount, and any that are still owed are kept — sorted oldest first,
      // since that's the most overdue (and most actionable) one to show.
      const roomReadings = electric.filter(e => e.roomNumber === rNum);
      const readingDueInfo = roomReadings.map(reading => {
        const waived = reading.paymentStatus === 'waived';
        const manualPaid   = !waived && reading.manualOverride && reading.paymentStatus === 'paid';
        const manualUnpaid = !waived && reading.manualOverride && reading.paymentStatus === 'unpaid';
        const total = waived ? 0 : (reading.totalAmount || 0);

        // A receipt counts toward THIS reading's bill if it was actually
        // billed for that reading's own month (monthYear, e.g. "2026-07" —
        // the Billing Month picked when the receipt was made). Older receipts
        // made before this field was captured fall back to receiptDate.
        const readingMonthYearStr = `${reading.year}-${String(reading.month).padStart(2, '0')}`;
        const isForThisReading = (rec) => rec.monthYear
          ? rec.monthYear === readingMonthYearStr
          : (rec.receiptDate && new Date(rec.receiptDate).getFullYear() === reading.year && new Date(rec.receiptDate).getMonth() + 1 === reading.month);

        const paidDirect = (waived || manualUnpaid) ? 0 : receipts
          .filter(rec => rec.roomNumber === rNum && (rec.packageName === 'electric' || rec.paymentType === 'electric') && isForThisReading(rec))
          .reduce((s, rec) => s + (rec.amountPaid ?? rec.totalAmount ?? 0), 0);
        const paidInFinal = (waived || manualUnpaid) ? 0 : receipts
          .filter(rec => rec.roomNumber === rNum && (rec.packageName === 'final' || rec.paymentType === 'final') && isForThisReading(rec))
          .reduce((s, rec) => {
            let elecAmt = rec.electricAmount;
            if (!(elecAmt > 0)) {
              const m = (rec.notes || '').match(/Electric\s*(?:[\w]+)?\s*:?\s*₹([\d,]+)/);
              elecAmt = m ? parseInt(m[1].replace(/,/g, '')) : 0;
            }
            if (!(elecAmt > 0)) return s;
            const paid = rec.amountPaid ?? rec.totalAmount ?? 0;
            const paidRatio = rec.totalAmount > 0 ? paid / rec.totalAmount : 1;
            return s + (elecAmt * paidRatio);
          }, 0);
        const directlyPaid = (!waived && !manualUnpaid && reading.paymentStatus === 'paid') ? total : 0;
        const paid = manualUnpaid ? 0 : (paidDirect + paidInFinal + directlyPaid);
        const due  = manualPaid ? 0 : Math.max(0, total - paid);
        return { reading, total, paid, due };
      });

      const unpaidReadings = readingDueInfo
        .filter(x => x.due > 0)
        .sort((a, b) => (a.reading.year * 12 + a.reading.month) - (b.reading.year * 12 + b.reading.month));

      const elecDue = unpaidReadings.reduce((s, x) => s + x.due, 0);
      // The "representative" reading shown in the Electric Due Date column and
      // used for the Waive/Mark Paid/Unpaid buttons: the oldest unpaid one if
      // there is one (most overdue = most urgent), otherwise the most recent
      // reading overall so a fully-paid room still shows a green "Paid" status
      // instead of a blank column.
      const mostRecentReadingInfo = readingDueInfo
        .slice()
        .sort((a, b) => (b.reading.year * 12 + b.reading.month) - (a.reading.year * 12 + a.reading.month))[0];
      const chosen = unpaidReadings[0] || mostRecentReadingInfo;
      const elecReading = chosen?.reading || null;
      const elecTotal   = chosen?.total || 0;
      const elecPaid    = chosen?.paid || 0;

      // Advance: the most recent Advance-type receipt for this room that
      // still has an outstanding balance — i.e. what's actually still DUE on
      // an advance payment, not the amount already paid. Fully-paid advance
      // receipts don't show here since there's nothing left owed on them.
      const latestUnpaidAdvance = receipts
        .filter(rec => rec.roomNumber === rNum && (rec.packageName || rec.paymentType || '') === 'advance' && rec.isPartPayment && (rec.balanceDue || 0) > 0)
        .sort((a, b) => new Date(b.receiptDate || 0) - new Date(a.receiptDate || 0))[0];
      const advanceAmt = latestUnpaidAdvance ? (latestUnpaidAdvance.balanceDue || 0) : 0;
      const advanceDueDate = latestUnpaidAdvance?.toDate ? new Date(latestUnpaidAdvance.toDate) : null;

      return {
        roomNumber: rNum,
        members: roomActiveMembers.length ? roomActiveMembers : (r.members || []),
        memberCount: r.memberCount,
        fixedRent,
        paidThrough,
        rentDue,
        elecTotal,
        elecPaid,
        elecDue,
        elecReading,
        advanceAmt,
        advanceDueDate,
        totalDue: rentDue + elecDue,
        mobileNo: (roomActiveMembers[0] || (r.members || [])[0])?.mobileNo || '',
        memberMobiles: (roomActiveMembers.length ? roomActiveMembers : (r.members || [])).map(m => m.mobileNo).filter(Boolean),
        memberNames: (roomActiveMembers.length ? roomActiveMembers : (r.members || [])).map(m => m.name).join(', '),
      };
    })
    .filter(r => r !== null && r.totalDue > 0)
    .sort((a, b) => b.totalDue - a.totalDue);

  const totalRentDue  = roomDues.reduce((s, r) => s + r.rentDue, 0);
  const totalElecDue  = roomDues.reduce((s, r) => s + r.elecDue, 0);
  const totalDueAll   = totalRentDue + totalElecDue;

  // ── Rooms due THIS MONTH — room-ordered view ──────────────────────────────
  // roomDues above already IS "what's actually owed for this month" (rent is
  // only counted as owed if the member isn't paid through past this month —
  // see rentOwedThisMonth), so this is just that same list, sorted room-wise
  // ascending and with each room's validity start/end dates attached for display.
  const roomsDueThisMonth = roomDues
    .slice()
    .sort((a, b) => a.roomNumber - b.roomNumber)
    .map(due => {
      const rn = due.roomNumber;
      const roomActiveMembers = members.filter(m => m.roomNumber === rn && m.isActive !== false);
      const joinDates = roomActiveMembers.map(m => m.roomJoinDate).filter(Boolean).map(d => new Date(d));
      const startDate = joinDates.length ? new Date(Math.min(...joinDates)) : null;
      const endDate    = due.paidThrough || null;
      const [primary, ...others] = roomActiveMembers.length ? roomActiveMembers : [{ name: 'Unknown', mobileNo: '' }];
      const diffDays = endDate ? Math.ceil((endDate - today) / (1000 * 60 * 60 * 24)) : null;

      // The most recent Rent/Advance/Final receipt for this room — its own
      // From/To dates are the real, current validity period, which is what
      // WhatsApp reminders should quote. (startDate/endDate above are for the
      // table columns: original move-in date, and the earliest-paid-through
      // date across all members — useful for the dues view, but not always
      // the same as "what does the latest receipt actually say".)
      const RENT_PERIOD_TYPES = ['rent', 'advance', 'final'];
      const latestValidityReceipt = receipts
        .filter(rec => rec.roomNumber === rn && RENT_PERIOD_TYPES.includes(rec.packageName || rec.paymentType || ''))
        .sort((a, b) => new Date(b.receiptDate || 0) - new Date(a.receiptDate || 0))[0];
      const validityFrom = latestValidityReceipt?.fromDate ? new Date(latestValidityReceipt.fromDate) : startDate;
      const validityTo   = latestValidityReceipt?.toDate   ? new Date(latestValidityReceipt.toDate)   : endDate;

      return {
        roomNumber: rn, primary, others,
        startDate, endDate, diffDays,
        validityFrom, validityTo,
        rentDue: due.rentDue || 0,
        elecDue: due.elecDue || 0,
        elecTotal: due.elecTotal || 0,
        elecPaid: due.elecPaid || 0,
        elecReading: due.elecReading || null,
        advanceAmt: due.advanceAmt || 0,
        advanceDueDate: due.advanceDueDate || null,
        totalDue: due.totalDue || 0,
        memberNames: roomActiveMembers.map(m => m.name).join(', '),
        mobileNo: primary.mobileNo || '',
      };
    });


  // Electric status shown in the dues table: 'waived' is the only manual flag;
  // paid/unpaid/partial are always derived from actual receipts (see roomDues above).
  const getElecStatus = (elecReading, elecTotal, elecPaid) => {
    if (elecReading?.paymentStatus === 'waived') return 'waived';
    if (elecReading?.manualOverride) return elecReading.paymentStatus === 'paid' ? 'paid' : 'unpaid';
    if (elecTotal > 0 && elecPaid >= elecTotal) return 'paid';
    if (elecPaid > 0) return 'partial';
    return 'unpaid';
  };

  const saveElecWaive = async () => {
    if (!waiveTarget) return;
    if (!waiveReason.trim()) { toast('Please enter a reason before waiving', 'error'); return; }
    setWaiveSaving(true);
    try {
      await electricAPI.updatePaymentStatus(waiveTarget._id, { paymentStatus: 'waived', waivedReason: waiveReason.trim() });
      toast('Electric bill waived — removed from dues');
      setWaiveTarget(null); setWaiveReason('');
      load();
    } catch(e) { toast(e.response?.data?.message || 'Error waiving', 'error'); }
    finally { setWaiveSaving(false); }
  };

  const restoreElec = async (reading) => {
    try {
      await electricAPI.updatePaymentStatus(reading._id, { paymentStatus: 'unpaid', waivedReason: '', manualOverride: false });
      toast('Reset — status now follows receipts automatically');
      load();
    } catch(e) { toast(e.response?.data?.message || 'Error restoring', 'error'); }
  };

  // Quick manual correction right from the dues table — e.g. fixing a misclick
  // without having to go to the Electric page.
  const markElecStatus = async (reading, status) => {
    try {
      await electricAPI.updatePaymentStatus(reading._id, { paymentStatus: status, waivedReason: '', manualOverride: true });
      toast(status === 'paid' ? 'Marked as paid' : 'Marked as unpaid');
      load();
    } catch(e) { toast(e.response?.data?.message || 'Error updating', 'error'); }
  };

  // Full electric reading history for a room, opened from the dues table
  const [elecHistoryData, setElecHistoryData] = useState([]);
  const [elecHistoryLoading, setElecHistoryLoading] = useState(false);
  const openElecHistory = async (roomNumber) => {
    setElecHistoryRoom(roomNumber);
    setElecHistoryLoading(true);
    try {
      const res = await electricAPI.getByRoom(roomNumber);
      setElecHistoryData(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch { setElecHistoryData([]); }
    finally { setElecHistoryLoading(false); }
  };


  const sq = search.toLowerCase();
  const filterM  = (list) => !search ? list : list.filter(m =>
    (m.name||'').toLowerCase().includes(sq) ||
    String(m.roomNumber||'').includes(sq) ||
    (m.mobileNo||'').includes(sq)
  );
  const filterR  = (list) => !search ? list : list.filter(r =>
    String(r.roomNumber).includes(sq) ||
    (r.memberNames||'').toLowerCase().includes(sq) ||
    (r.mobileNo||'').includes(sq)
  );
  const filterPP = (list) => !search ? list : list.filter(r =>
    (r.memberName||'').toLowerCase().includes(sq) ||
    String(r.roomNumber||'').includes(sq) ||
    (r.memberMobile||'').includes(sq)
  );

  // Group expiringSoon by room — show only first member per room, rest as dropdown
  const expiringSoonByRoom = (() => {
    const byRoom = {};
    expiringSoon.forEach(m => {
      const rn = m.roomNumber || 'none';
      if (!byRoom[rn]) byRoom[rn] = { primary: m, others: [] };
      else byRoom[rn].others.push(m);
    });
    return Object.values(byRoom);
  })();

  if (loading) return <div style={{ color:'var(--text2)', padding:40, textAlign:'center' }}>⏳ Loading dues...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Dues & Part Payments</h2>
          <p>
            <span style={{color:'var(--danger)',fontWeight:600}}>{fmtM(totalDueAll)} total rent+electric due this month</span>
            {totalBalanceDue > 0 && <span style={{color:'#9b59b6',fontWeight:600}}> · {fmtM(totalBalanceDue)} part-payment balance</span>}
          </p>
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="🔍 Name / room / mobile..."
          style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 14px',color:'var(--text)',outline:'none',fontSize:'0.88rem',width:220}} />
      </div>

      {/* Summary cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:20}}>
        {[
          {label:'Rent Due (This Month)',  value:fmtM(totalRentDue),    color:'var(--danger)',  icon:'🏷️', t:'dues'},
          {label:'Electric Due (This Month)', value:fmtM(totalElecDue), color:'var(--accent)',  icon:'⚡', t:'dues'},
          {label:'Total Dues',             value:fmtM(totalDueAll),     color:'var(--danger)',  icon:'💰', t:'dues'},
          {label:'Part Pay Balance',       value:fmtM(totalBalanceDue), color:'#9b59b6',        icon:'💳', t:'partpay'},
          {label:'Overdue Members',        value:overdueMembers.length, color:'var(--danger)',  icon:'⚠️', t:'overdue'},
          {label:'Expiring in 7 Days',     value:expiringSoon.length,   color:'var(--accent)',  icon:'⏰', t:'expiring'},
        ].map((c,i)=>(
          <div key={i} className="card" style={{cursor:'pointer',borderColor:tab===c.t?c.color:'var(--border)',transition:'border-color 0.2s',padding:'12px 14px'}}
            onClick={()=>setTab(c.t)}>
            <div style={{fontSize:'0.68rem',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>{c.icon} {c.label}</div>
            <div style={{fontFamily:'Rajdhani',fontSize:'1.4rem',fontWeight:700,color:c.color}}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="tabs" style={{marginBottom:16}}>
        <button className={`tab ${tab==='dues'?'active':''}`}     onClick={()=>setTab('dues')}>💰 Room Dues ({roomDues.length} rooms)</button>
        <button className={`tab ${tab==='partpay'?'active':''}`}  onClick={()=>setTab('partpay')}>💳 Part Payments ({partPayments.length})</button>
        <button className={`tab ${tab==='overdue'?'active':''}`}  onClick={()=>setTab('overdue')}>⚠️ Overdue Members ({overdueMembers.length})</button>
        <button className={`tab ${tab==='expiring'?'active':''}`} onClick={()=>setTab('expiring')}>⏰ Expiring Soon ({expiringSoon.length})</button>
      </div>

      {/* ── ROOM DUES TAB — single, room-ordered "Rooms Due This Month" table ── */}
      {tab === 'dues' && (
        <div>
          {/* Summary bar */}
          <div style={{display:'flex',gap:12,marginBottom:14,flexWrap:'wrap'}}>
            {[
              {label:'Total Rent Due',     value:fmtM(totalRentDue),  color:'var(--danger)'},
              {label:'Total Electric Due', value:fmtM(totalElecDue),  color:'#f39c12'},
              {label:'Grand Total Due',    value:fmtM(totalDueAll),   color:'var(--danger)',bold:true},
              {label:'Rooms Due This Month', value:roomsDueThisMonth.length, color:'var(--text)'},
            ].map((s,i)=>(
              <div key={i} className="card" style={{padding:'12px 16px',flex:'1 1 140px',minWidth:0}}>
                <div style={{fontSize:'0.7rem',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>{s.label}</div>
                <div style={{fontFamily:'Rajdhani',fontWeight:s.bold?800:700,fontSize:'1.3rem',color:s.color}}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{marginBottom:10,padding:'10px 14px',background:'rgba(240,165,0,0.06)',borderRadius:6,fontSize:'0.8rem',color:'var(--text2)'}}>
            📅 Every room with rent/electric due this month (1st–{monthEndDay}), room-wise. Rent/Electric/Final receipts clear these automatically — a part payment leaves the remainder.
          </div>

          {/* Print button */}
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:10}}>
            <button className="btn btn-secondary btn-xs" onClick={() => {
              const rows = roomsDueThisMonth.map(g => {
                const dateCell = (g.rentDue > 0 && g.endDate)
                  ? `<span style="font-weight:700">${g.endDate.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span><br><small style="color:#888;font-size:10px">${g.diffDays<0?`Overdue ${Math.abs(g.diffDays)}d`:g.diffDays===0?'Today':`${g.diffDays}d left`}</small>`
                  : '—';
                return `<tr>
                  <td><strong>Room ${g.roomNumber}</strong></td>
                  <td>${g.memberNames}</td>
                  <td>${g.startDate?g.startDate.toLocaleDateString('en-IN'):'—'}</td>
                  <td>${dateCell}</td>
                  <td class="red">₹${(g.rentDue||0).toLocaleString('en-IN')}</td>
                  <td class="${g.elecDue>0?'gold':''}">₹${(g.elecDue||0).toLocaleString('en-IN')}</td>
                  <td>${g.elecReading?.dueDate ? new Date(g.elecReading.dueDate).toLocaleDateString('en-IN') : (g.elecDue>0 && g.elecReading ? `${MONTHS[g.elecReading.month-1]} ${g.elecReading.year}` : '—')}</td>
                  <td>${g.advanceAmt>0?'₹'+g.advanceAmt.toLocaleString('en-IN'):'—'}</td>
                  <td>${g.advanceDueDate?g.advanceDueDate.toLocaleDateString('en-IN'):'—'}</td>
                  <td class="red"><strong>₹${(g.totalDue||0).toLocaleString('en-IN')}</strong></td>
                </tr>`;
              }).join('');
              doPrint(`Rooms Due This Month — ${MONTHS[curMon-1]} ${curYr}`, `
                <h2>Rooms Due This Month — ${MONTHS[curMon-1]} ${curYr} (1–${monthEndDay})</h2>
                <p>Grand Total Due: ₹${totalDueAll.toLocaleString('en-IN')} across ${roomsDueThisMonth.length} rooms</p>
                <table><thead><tr><th>Room</th><th>Members</th><th>Start</th><th>Rent Due Date</th><th>Rent Due</th><th>Electric Due</th><th>Electric Due Date</th><th>Advance Due</th><th>Advance Due Date</th><th>Total Due</th></tr></thead>
                <tbody>${rows}</tbody></table>`);
            }}>🖨 Print Dues List</button>
          </div>

          {roomsDueThisMonth.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">✅</div><p>No rooms due this month</p></div>
          ) : (
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Members</th>
                      <th>Start Date</th>
                      <th>Rent Due Date</th>
                      <th>Rent Due</th>
                      <th>Electric Due</th>
                      <th>Electric Due Date</th>
                      <th>Advance Due</th>
                      <th>Advance Due Date</th>
                      <th>Total Due</th>
                      <th>WhatsApp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterR(roomsDueThisMonth).map(g => {
                      const elecStatus = getElecStatus(g.elecReading, g.elecTotal, g.elecPaid);
                      return (
                      <React.Fragment key={g.roomNumber}>
                        <tr style={{borderBottom: g.others.length>0 ? 'none':'1px solid var(--border)'}}>
                          <td>
                            <span className="badge badge-blue">Room {g.roomNumber}</span>
                            {g.others.length>0 && (
                              <span style={{marginLeft:5,fontSize:'0.68rem',color:'var(--text3)'}}>+{g.others.length} more</span>
                            )}
                          </td>
                          <td style={{fontWeight:600,color:'var(--text)'}}>{g.primary.name}</td>
                          <td style={{fontSize:'0.78rem',color:'var(--text2)'}}>{g.startDate ? g.startDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</td>
                          <td style={{fontSize:'0.78rem'}}>
                            {(g.rentDue > 0 && g.endDate) ? (
                              <div>
                                <span style={{color: g.diffDays<0 ? 'var(--danger)' : g.diffDays<=7 ? '#f39c12' : 'var(--success)', fontWeight:700}}>
                                  {g.endDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                                </span>
                                <div style={{fontSize:'0.68rem', color:'var(--text3)', marginTop:2}}>
                                  {g.diffDays<0 ? `Overdue ${Math.abs(g.diffDays)}d` : g.diffDays===0 ? 'Today' : `${g.diffDays}d left`}
                                </div>
                              </div>
                            ) : <span style={{color:'var(--text3)'}}>—</span>}
                          </td>
                          <td style={{color:g.rentDue>0?'var(--danger)':'var(--text3)',fontWeight:g.rentDue>0?700:400}}>
                            {g.rentDue>0 ? fmtM(g.rentDue) : '—'}
                          </td>
                          <td>
                            <div style={{display:'flex',flexDirection:'column',gap:4}}>
                              <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                                <span style={{color:g.elecDue>0?'#f39c12':'var(--text3)',fontWeight:g.elecDue>0?700:400}}>
                                  {g.elecDue>0 ? fmtM(g.elecDue) : '—'}
                                </span>
                                {g.elecReading && <StatusDot status={elecStatus} />}
                              </div>
                              <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                              {g.elecReading && elecStatus !== 'paid' && (
                                <button className="btn btn-xs" style={{background:'rgba(46,204,113,0.12)',color:'#27ae60',border:'1px solid rgba(46,204,113,0.3)',fontSize:'0.66rem',padding:'2px 6px'}}
                                  onClick={()=>markElecStatus(g.elecReading,'paid')}
                                  title="Mark this room's electric bill as paid">✅</button>
                              )}
                              {g.elecReading && elecStatus !== 'unpaid' && elecStatus !== 'waived' && (
                                <button className="btn btn-xs" style={{background:'rgba(231,76,60,0.1)',color:'var(--danger)',border:'1px solid rgba(231,76,60,0.25)',fontSize:'0.66rem',padding:'2px 6px'}}
                                  onClick={()=>markElecStatus(g.elecReading,'unpaid')}
                                  title="Mark this room's electric bill as unpaid">⏳</button>
                              )}
                              {g.elecReading && elecStatus !== 'waived' && g.elecDue > 0 && (
                                <button className="btn btn-xs" style={{background:'rgba(155,89,182,0.12)',color:'#8e44ad',border:'1px solid rgba(155,89,182,0.3)',fontSize:'0.66rem',padding:'2px 6px'}}
                                  onClick={()=>{ setWaiveTarget(g.elecReading); setWaiveReason(''); }}
                                  title="Waive this room's electric bill">🚫 Waive</button>
                              )}
                              {g.elecReading && (elecStatus === 'waived' || g.elecReading.manualOverride) && (
                                <button className="btn btn-xs btn-secondary" style={{fontSize:'0.66rem',padding:'2px 6px'}}
                                  onClick={()=>restoreElec(g.elecReading)} title="Go back to automatic status (from receipts)">↩ Auto</button>
                              )}
                              <button className="btn btn-xs btn-secondary" style={{fontSize:'0.66rem',padding:'2px 6px'}}
                                onClick={()=>openElecHistory(g.roomNumber)} title="Full electric history for this room">🕒 History</button>
                              </div>
                            </div>
                          </td>
                          <td style={{fontSize:'0.78rem'}}>
                            {g.elecDue > 0 && g.elecReading ? (
                              g.elecReading.dueDate ? (
                                <span style={{color: new Date(g.elecReading.dueDate)<today ? 'var(--danger)' : 'var(--text2)', fontWeight: new Date(g.elecReading.dueDate)<today ? 700 : 400}}>
                                  {new Date(g.elecReading.dueDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                                </span>
                              ) : (
                                <span style={{color:'var(--text3)'}} title="No due date set on this reading — showing which month's bill this is">
                                  {MONTHS[g.elecReading.month-1]} {g.elecReading.year}
                                </span>
                              )
                            ) : <span style={{color:'var(--text3)'}}>—</span>}
                          </td>
                          <td style={{color:g.advanceAmt>0?'#f39c12':'var(--text3)',fontWeight:g.advanceAmt>0?700:400}}>
                            {g.advanceAmt>0 ? fmtM(g.advanceAmt) : '—'}
                          </td>
                          <td style={{fontSize:'0.78rem',color:'var(--text2)'}}>
                            {g.advanceDueDate ? g.advanceDueDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : <span style={{color:'var(--text3)'}}>—</span>}
                          </td>
                          <td style={{color:'var(--danger)',fontWeight:800,fontFamily:'Rajdhani',fontSize:'1rem'}}>
                            {fmtM(g.totalDue)}
                          </td>
                          <td>
                            {g.primary.mobileNo && (
                              <button style={{background:'#25d366',color:'white',border:'none',borderRadius:5,padding:'4px 9px',cursor:'pointer',fontSize:'0.72rem',fontWeight:700}}
                                onClick={() => {
                                  const msg = [
                                    `🏠 *Hostel Due Payment Reminder*`,
                                    `━━━━━━━━━━━━━━━━`,
                                    `Dear *${g.primary.name}*,`,
                                    `🚪 Room No: *${g.roomNumber}*`,
                                    g.validityTo ? `⏰ Validity: *${g.validityFrom?g.validityFrom.toLocaleDateString('en-IN'):'—'} → ${g.validityTo.toLocaleDateString('en-IN')}*` : '',
                                    ``,
                                    g.rentDue>0 ? `🏠 Rent Due: *₹${g.rentDue.toLocaleString('en-IN')}*` : '',
                                    g.elecDue>0 ? `⚡ Electric Due: *₹${g.elecDue.toLocaleString('en-IN')}*${g.elecReading?.dueDate ? ` (by ${new Date(g.elecReading.dueDate).toLocaleDateString('en-IN')})` : g.elecReading ? ` (${MONTHS[g.elecReading.month-1]} ${g.elecReading.year})` : ''}` : '',
                                    g.advanceAmt>0 ? `📌 Advance Due: *₹${g.advanceAmt.toLocaleString('en-IN')}*${g.advanceDueDate ? ` (by ${g.advanceDueDate.toLocaleDateString('en-IN')})` : ''}` : '',
                                    ``,
                                    `💰 *Total Due: ₹${g.totalDue.toLocaleString('en-IN')}*`,
                                    ``,
                                    `Please clear dues at earliest.`,
                                    `Late payment fine: ₹50/day.`,
                                    ``,
                                    `Share your payment receipt on Mob. No. 9826400917`,
                                    ``,
                                    `Thank you 🙏`,
                                  ].filter(Boolean).join('\n');
                                  window.open(`https://wa.me/91${String(g.primary.mobileNo).replace(/\D/g,'').slice(-10)}?text=${encodeURIComponent(msg)}`,'_blank');
                                }}>
                                📱
                              </button>
                            )}
                          </td>
                        </tr>
                        {/* Sub-rows for other members in same room */}
                        {g.others.map((om,oi) => (
                          <tr key={om._id} style={{background:'var(--bg3)',opacity:0.85,borderBottom:oi===g.others.length-1?'1px solid var(--border)':'none'}}>
                            <td style={{paddingLeft:24,color:'var(--text3)',fontSize:'0.75rem'}}>↳ same room</td>
                            <td style={{color:'var(--text2)',fontSize:'0.83rem'}}>{om.name}</td>
                            <td colSpan={8} style={{color:'var(--text3)',fontSize:'0.75rem'}}>same dues as above</td>
                            <td>
                              {om.mobileNo && (
                                <button style={{background:'#25d366',color:'white',border:'none',borderRadius:5,padding:'3px 7px',cursor:'pointer',fontSize:'0.7rem',fontWeight:700}}
                                  onClick={() => {
                                    const msg = [
                                      `🏠 *Hostel Due Payment Reminder*`,
                                      `Dear *${om.name}*,`,
                                      `🚪 Room No: *${g.roomNumber}*`,
                                      g.validityTo ? `⏰ Validity: *${g.validityFrom?g.validityFrom.toLocaleDateString('en-IN'):'—'} → ${g.validityTo.toLocaleDateString('en-IN')}*` : '',
                                      g.rentDue>0 ? `🏠 Rent Due: *₹${g.rentDue.toLocaleString('en-IN')}*` : '',
                                      g.elecDue>0 ? `⚡ Electric Due: *₹${g.elecDue.toLocaleString('en-IN')}*${g.elecReading?.dueDate ? ` (by ${new Date(g.elecReading.dueDate).toLocaleDateString('en-IN')})` : g.elecReading ? ` (${MONTHS[g.elecReading.month-1]} ${g.elecReading.year})` : ''}` : '',
                                      g.advanceAmt>0 ? `📌 Advance Due: *₹${g.advanceAmt.toLocaleString('en-IN')}*${g.advanceDueDate ? ` (by ${g.advanceDueDate.toLocaleDateString('en-IN')})` : ''}` : '',
                                      `💰 *Total Due: ₹${g.totalDue.toLocaleString('en-IN')}*`,
                                      ``,`Please clear dues. Late payment fine: ₹50/day.`,
                                      `Share your payment receipt on Mob. No. 9826400917`,
                                      `Thank you 🙏`,
                                    ].filter(Boolean).join('\n');
                                    window.open(`https://wa.me/91${String(om.mobileNo).replace(/\D/g,'').slice(-10)}?text=${encodeURIComponent(msg)}`,'_blank');
                                  }}>
                                  📱
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );})}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
      {tab === 'partpay' && (
        <div className="card">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div style={{padding:'10px 14px',background:'rgba(155,89,182,0.06)',borderRadius:6,fontSize:'0.83rem',color:'var(--text2)',flex:1}}>
              💳 Receipts where only part of the bill was paid. Outstanding = Total − Paid.
            </div>
            <div style={{marginLeft:16,textAlign:'right',flexShrink:0}}>
              <div style={{fontSize:'0.72rem',color:'var(--text3)'}}>Total Outstanding</div>
              <div style={{fontFamily:'Rajdhani',fontSize:'1.4rem',fontWeight:700,color:'#9b59b6'}}>{fmtM(totalBalanceDue)}</div>
            </div>
          </div>
          {filterPP(partPayments).length === 0 ? (
            <div className="empty-state"><div className="empty-icon">✅</div><p>No outstanding part payments</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Bill No.</th><th>Date</th><th>Room</th><th>Member(s)</th><th>Total Bill</th><th>Paid</th><th>Balance Due</th><th>Mode</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {filterPP(partPayments).map(r=>(
                    <tr key={r._id}>
                      <td style={{fontFamily:'monospace',fontSize:'0.78rem',color:'var(--accent)'}}>{r.billNumber||'—'}</td>
                      <td style={{fontSize:'0.8rem'}}>{fmt(r.receiptDate)}</td>
                      <td>{r.roomNumber?<span className="badge badge-blue">R{r.roomNumber}</span>:'—'}</td>
                      <td style={{fontSize:'0.82rem',maxWidth:130,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={r.memberName}>{r.memberName||'—'}</td>
                      <td style={{fontWeight:600}}>{fmtM(r.totalAmount)}</td>
                      <td style={{color:'var(--success)',fontWeight:600}}>{fmtM(r.amountPaid)}</td>
                      <td><span style={{background:'rgba(155,89,182,0.12)',color:'#9b59b6',padding:'3px 10px',borderRadius:10,fontWeight:700,fontSize:'0.82rem'}}>{fmtM(r.balanceDue)}</span></td>
                      <td><span className={`badge ${r.modeOfPayment==='online'?'badge-blue':'badge-green'}`} style={{fontSize:'0.68rem'}}>{r.modeOfPayment}</span></td>
                      <td>
                        {r.memberMobile && (
                          <button style={{background:'#25d366',color:'white',border:'none',borderRadius:5,padding:'5px 10px',cursor:'pointer',fontSize:'0.72rem',fontWeight:700,whiteSpace:'nowrap'}}
                            onClick={()=>wa.sendCustom(r.memberMobile,
                              `🏠 *PAYMENT REMINDER*\n\nDear ${r.memberName},\n\n📋 Bill No: ${r.billNumber}\n💰 Total Bill: ₹${r.totalAmount}\n✅ Paid: ₹${r.amountPaid}\n❗ *Balance Due: ₹${r.balanceDue}*\n\nPlease clear this at the earliest.\n\nThank you 🙏`
                            )}>📱 WhatsApp</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── OVERDUE MEMBERS TAB ───────────────────────────────────────────── */}
      {tab === 'overdue' && (
        <div className="card">
          <div style={{marginBottom:12,padding:'10px 14px',background:'rgba(231,76,60,0.06)',borderRadius:6,fontSize:'0.83rem',color:'var(--text2)'}}>
            ⚠️ Members whose plan has expired. Make a new receipt with updated "To Period" to clear them.
          </div>
          {filterM(overdueMembers).length === 0 ? (
            <div className="empty-state"><div className="empty-icon">✅</div><p>No overdue members</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Member</th><th>Room</th><th>Mobile</th><th>Plan Expired</th><th>Days Overdue</th><th>Rent</th><th>Action</th></tr></thead>
                <tbody>
                  {filterM(overdueMembers).map(m=>{
                    const d = Math.floor((today-new Date(m.roomLeavingDate))/(1000*60*60*24));
                    return (
                      <tr key={m._id}>
                        <td style={{color:'var(--text)',fontWeight:600}}>{m.name}</td>
                        <td>{m.roomNumber?<span className="badge badge-blue">Room {m.roomNumber}</span>:'—'}</td>
                        <td style={{fontSize:'0.82rem'}}>{m.mobileNo||'—'}</td>
                        <td style={{color:'var(--danger)'}}>{fmt(m.roomLeavingDate)}</td>
                        <td><span style={{background:'rgba(231,76,60,0.12)',color:'var(--danger)',padding:'2px 10px',borderRadius:10,fontWeight:700,fontSize:'0.8rem'}}>{d} day{d!==1?'s':''} ago</span></td>
                        <td>{m.rent?fmtM(m.rent):'—'}</td>
                        <td>{m.mobileNo&&<button style={{background:'#25d366',color:'white',border:'none',borderRadius:5,padding:'5px 10px',cursor:'pointer',fontSize:'0.72rem',fontWeight:700}} onClick={()=>wa.sendReminder(m.mobileNo,m.name,m.roomNumber,m.rent||0,'rent dues')}>📱 WhatsApp</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── EXPIRING SOON TAB ─────────────────────────────────────────────── */}
      {tab === 'expiring' && (
        <div className="card">
          {/* Date range picker */}
          <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:14,padding:'12px 14px',background:'rgba(240,165,0,0.05)',borderRadius:8,border:'1px solid rgba(240,165,0,0.15)'}}>
            <span style={{fontSize:'0.8rem',color:'var(--text3)',fontWeight:600,whiteSpace:'nowrap'}}>⏰ Show expiring:</span>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <label style={{fontSize:'0.75rem',color:'var(--text3)'}}>From</label>
              <input type="date" value={expireFrom} onChange={e=>setExpireFrom(e.target.value)}
                style={{background:'var(--bg3)',border:'1px solid var(--border2)',borderRadius:6,padding:'5px 8px',color:'var(--text)',fontSize:'0.82rem',outline:'none'}} />
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <label style={{fontSize:'0.75rem',color:'var(--text3)'}}>To</label>
              <input type="date" value={expireTo} onChange={e=>setExpireTo(e.target.value)}
                style={{background:'var(--bg3)',border:'1px solid var(--border2)',borderRadius:6,padding:'5px 8px',color:'var(--text)',fontSize:'0.82rem',outline:'none'}} />
            </div>
            {(expireFrom || expireTo) && (
              <button className="btn btn-secondary btn-xs" onClick={()=>{setExpireFrom('');setExpireTo('');}}>✕ Reset to 7 days</button>
            )}
            <span style={{marginLeft:'auto',fontSize:'0.8rem',color:'var(--accent)',fontWeight:600}}>{expiringSoon.length} member{expiringSoon.length!==1?'s':''}</span>
            <button className="btn btn-secondary btn-xs" onClick={() => {
              const rows = filterM(expiringSoon).map(m => {
                const d   = Math.ceil((new Date(m.roomLeavingDate)-today)/(1000*60*60*24));
                const elec = getElecDueForRoom(m.roomNumber);
                return `<tr>
                  <td><strong>${m.name}</strong></td>
                  <td>Room ${m.roomNumber||'—'}</td>
                  <td>${m.mobileNo||'—'}</td>
                  <td>${new Date(m.roomLeavingDate).toLocaleDateString('en-IN')}</td>
                  <td class="${d<=3?'red':'gold'}">${d} day${d!==1?'s':''} left</td>
                  <td>${m.rent?'₹'+m.rent.toLocaleString('en-IN'):'—'}</td>
                  <td class="${elec.elecDue>0?'gold':''}">${elec.elecDue>0?'₹'+elec.elecDue.toLocaleString('en-IN'):'—'}</td>
                  <td class="${(m.rent||0)+(elec.elecDue)>0?'red':''}"><strong>₹${((m.rent||0)+(elec.elecDue)).toLocaleString('en-IN')}</strong></td>
                </tr>`;
              }).join('');
              doPrint('Expiring Soon', `
                <h2>Members Expiring Soon</h2>
                <p>${expireFrom||'Today'} to ${expireTo||'+7 days'} &nbsp;|&nbsp; ${expiringSoon.length} members</p>
                <table><thead><tr><th>Name</th><th>Room</th><th>Mobile</th><th>Expires On</th><th>Days Left</th><th>Monthly Rent</th><th>Elec Due</th><th>Total Due</th></tr></thead>
                <tbody>${rows}</tbody></table>`);
            }}>🖨 Print List</button>
          </div>
          {filterM(expiringSoon).length === 0 ? (
            <div className="empty-state"><div className="empty-icon">✅</div><p>No members expiring soon</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Room</th><th>Primary Member</th><th>Mobile</th>
                    <th>Plan Expires</th><th>Days Left</th>
                    <th>Monthly Rent</th><th>Electric Due</th><th>Total Due</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {expiringSoonByRoom
                    .filter(g => !search ||
                      (g.primary.name||'').toLowerCase().includes(sq) ||
                      String(g.primary.roomNumber||'').includes(sq) ||
                      (g.primary.mobileNo||'').includes(sq))
                    .map(({ primary: m, others }) => {
                      const d     = Math.ceil((new Date(m.roomLeavingDate)-today)/(1000*60*60*24));
                      const elec  = getElecDueForRoom(m.roomNumber);
                      const totalDueM = (m.rent||0) + elec.elecDue;
                      return (
                        <React.Fragment key={m._id}>
                          <tr style={{background:d<=3?'rgba(231,76,60,0.04)':'transparent'}}>
                            <td>
                              {m.roomNumber ? <span className="badge badge-blue">Room {m.roomNumber}</span> : '—'}
                              {others.length > 0 && (
                                <span style={{fontSize:'0.68rem',color:'var(--text3)',marginLeft:4}}>+{others.length} more</span>
                              )}
                            </td>
                            <td style={{color:'var(--text)',fontWeight:600}}>{m.name}</td>
                            <td style={{fontSize:'0.82rem'}}>{m.mobileNo||'—'}</td>
                            <td style={{color:'var(--accent)'}}>{fmt(m.roomLeavingDate)}</td>
                            <td>
                              <span style={{background:d<=3?'rgba(231,76,60,0.12)':'rgba(240,165,0,0.12)',color:d<=3?'var(--danger)':'var(--accent)',padding:'2px 10px',borderRadius:10,fontWeight:700,fontSize:'0.8rem'}}>
                                {d} day{d!==1?'s':''} left
                              </span>
                            </td>
                            <td>{m.rent?fmtM(m.rent):'—'}</td>
                            <td style={{color:elec.elecDue>0?'var(--accent)':'var(--text3)',fontWeight:elec.elecDue>0?600:400}}>
                              {elec.elecDue>0
                                ? <span title={`Bill: ₹${elec.elecTotal} — Paid: ₹${elec.elecPaid}`}>{fmtM(elec.elecDue)}</span>
                                : <span style={{color:'var(--text3)'}}>—</span>}
                            </td>
                            <td style={{color:totalDueM>0?'var(--danger)':'var(--text3)',fontWeight:totalDueM>0?700:400}}>
                              {totalDueM>0 ? fmtM(totalDueM) : '—'}
                            </td>
                            <td>
                              {m.mobileNo && (
                                <button style={{background:'#25d366',color:'white',border:'none',borderRadius:5,padding:'4px 8px',cursor:'pointer',fontSize:'0.72rem',fontWeight:700}}
                                  onClick={() => {
                                    const allInRoom = [m, ...others];
                                    const names = allInRoom.map(x=>x.name).join(', ');
                                    const msg = [
                                      `🏠 *Hostel Renewal Reminder*`,
                                      `━━━━━━━━━━━━━━━━`,
                                      `Dear *${names}*,`,
                                      `🚪 Room No: *${m.roomNumber}*`,
                                      ``,
                                      `⏰ Your stay plan expires on: *${fmt(m.roomLeavingDate)}*`,
                                      `⏱ Only *${d} day${d!==1?'s':''} left*`,
                                      ``,
                                      m.rent ? `🏠 Monthly Rent: ₹${(m.rent||0).toLocaleString('en-IN')}` : '',
                                      elec.elecDue > 0 ? `⚡ Electric Due: *₹${elec.elecDue.toLocaleString('en-IN')}*` : '',
                                      totalDueM > 0 ? `💰 *Total Due: ₹${totalDueM.toLocaleString('en-IN')}*` : '',
                                      ``,
                                      `Please renew your stay and clear all dues.`,
                                      `Late payment fine: ₹50/day.`,
                                      ``,
                                      `Thank you 🙏`,
                                    ].filter(Boolean).join('\n');
                                    const num = `91${String(m.mobileNo).replace(/\D/g,'').slice(-10)}`;
                                    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
                                  }}>
                                  📱 Remind
                                </button>
                              )}
                            </td>
                          </tr>
                          {/* Dropdown rows for other members in same room */}
                          {others.map(om => (
                            <tr key={om._id} style={{background:'var(--bg3)',opacity:0.85}}>
                              <td style={{paddingLeft:24,color:'var(--text3)',fontSize:'0.78rem'}}>↳ same room</td>
                              <td style={{color:'var(--text2)',fontSize:'0.85rem'}}>{om.name}</td>
                              <td style={{fontSize:'0.78rem',color:'var(--text3)'}}>{om.mobileNo||'—'}</td>
                              <td style={{fontSize:'0.78rem',color:'var(--text3)'}}>{fmt(om.roomLeavingDate)}</td>
                              <td colSpan={4} />
                              <td>
                                {om.mobileNo && (
                                  <button style={{background:'#25d366',color:'white',border:'none',borderRadius:5,padding:'3px 7px',cursor:'pointer',fontSize:'0.7rem',fontWeight:700}}
                                    onClick={() => {
                                      const dOm = Math.ceil((new Date(om.roomLeavingDate)-today)/(1000*60*60*24));
                                      const msg = [
                                        `🏠 *Hostel Renewal Reminder*`,
                                        `Dear *${om.name}*,`,
                                        `🚪 Room No: *${om.roomNumber}*`,
                                        `⏰ Plan expires: *${fmt(om.roomLeavingDate)}* (${dOm} days left)`,
                                        om.rent ? `🏠 Rent: ₹${(om.rent||0).toLocaleString('en-IN')}` : '',
                                        elec.elecDue > 0 ? `⚡ Electric Due: ₹${elec.elecDue.toLocaleString('en-IN')}` : '',
                                        ``,`Please renew and clear dues. Thank you 🙏`,
                                      ].filter(Boolean).join('\n');
                                      const num = `91${String(om.mobileNo).replace(/\D/g,'').slice(-10)}`;
                                      window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
                                    }}>
                                    📱
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Electric Waive Modal (moved here from Electric page — waive right from dues) ── */}
      {waiveTarget && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&(setWaiveTarget(null),setWaiveReason(''))}>
          <div className="modal" style={{maxWidth:420}}>
            <div className="modal-header">
              <h3>🚫 Waive Electric Bill</h3>
              <button className="close-btn" onClick={()=>{setWaiveTarget(null);setWaiveReason('');}}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{background:'var(--bg3)',borderRadius:8,padding:'12px 16px',marginBottom:16,fontSize:'0.85rem'}}>
                <div style={{color:'var(--text3)',marginBottom:4}}>Room {waiveTarget.roomNumber} · {MONTHS[waiveTarget.month-1]} {waiveTarget.year}</div>
                <div style={{color:'var(--accent)',fontFamily:'Rajdhani',fontSize:'1.4rem',fontWeight:700}}>₹{waiveTarget.totalAmount}</div>
                <div style={{color:'var(--text3)',fontSize:'0.78rem'}}>{waiveTarget.unitsConsumed} units × ₹{waiveTarget.ratePerUnit}/unit</div>
              </div>
              <div style={{background:'rgba(155,89,182,0.08)',border:'1px solid rgba(155,89,182,0.25)',borderRadius:6,padding:'10px 14px',marginBottom:14,fontSize:'0.82rem',color:'var(--text2)'}}>
                Waiving removes this bill from dues and <strong>does not count it as income</strong>. Use this when a member won't pay and you're writing it off.
              </div>
              <div className="form-group">
                <label style={{fontWeight:600}}>Reason for waiving <span style={{color:'var(--danger)'}}>*</span></label>
                <input
                  autoFocus
                  type="text"
                  value={waiveReason}
                  onChange={e => setWaiveReason(e.target.value)}
                  placeholder="e.g. Member refused to pay, vacated without notice, dispute settled…"
                  style={{width:'100%'}}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>{setWaiveTarget(null);setWaiveReason('');}} disabled={waiveSaving}>Cancel</button>
              <button className="btn btn-primary" style={{background:'#8e44ad',borderColor:'#8e44ad'}}
                onClick={saveElecWaive} disabled={waiveSaving || !waiveReason.trim()}>
                {waiveSaving ? '⏳ Saving…' : '🚫 Confirm Waive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Full Electric History Modal ───────────────────────────────────── */}
      {elecHistoryRoom && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setElecHistoryRoom(null)}>
          <div className="modal" style={{maxWidth:760}}>
            <div className="modal-header">
              <h3>⚡ Room {elecHistoryRoom} — Full Electric History</h3>
              <button className="close-btn" onClick={()=>setElecHistoryRoom(null)}>✕</button>
            </div>
            <div className="modal-body">
              {elecHistoryLoading ? (
                <div style={{textAlign:'center',padding:24,color:'var(--text3)'}}>⏳ Loading...</div>
              ) : elecHistoryData.length === 0 ? (
                <div className="empty-state"><div className="empty-icon">⚡</div><p>No electric readings for this room yet</p></div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Month / Year</th><th>Start</th><th>End</th><th>Units</th><th>Rate</th><th>Bill</th><th>Due Date</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {elecHistoryData.map(r => {
                        const readingMonthYear = `${r.year}-${String(r.month).padStart(2, '0')}`;
                        const isForThisReading = (rec) => rec.monthYear
                          ? rec.monthYear === readingMonthYear
                          : (rec.receiptDate && new Date(rec.receiptDate).getMonth()+1===r.month && new Date(rec.receiptDate).getFullYear()===r.year);
                        const paid = (r.paymentStatus === 'waived' || r.manualOverride) ? 0 : receipts
                          .filter(rec => rec.roomNumber === elecHistoryRoom &&
                            ((rec.packageName==='electric'||rec.paymentType==='electric') || (rec.packageName==='final'||rec.paymentType==='final')) &&
                            isForThisReading(rec))
                          .reduce((s,rec) => {
                            const isFinal = rec.packageName==='final'||rec.paymentType==='final';
                            if (!isFinal) return s + (rec.amountPaid ?? rec.totalAmount ?? 0);
                            if (!(rec.electricAmount > 0)) return s;
                            const paidAmt = rec.amountPaid ?? rec.totalAmount ?? 0;
                            const ratio = rec.totalAmount > 0 ? paidAmt / rec.totalAmount : 1;
                            return s + (rec.electricAmount * ratio);
                          }, 0);
                        const status = r.paymentStatus === 'waived' ? 'waived'
                          : r.manualOverride ? (r.paymentStatus === 'paid' ? 'paid' : 'unpaid')
                          : (paid >= (r.totalAmount||0) && (r.totalAmount||0) > 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid');
                        return (
                          <tr key={r._id} style={status==='waived'?{opacity:0.6}:{}}>
                            <td style={{fontWeight:500}}>{MONTHS[r.month-1]} {r.year}</td>
                            <td>{r.startReading}</td>
                            <td>{r.endReading}</td>
                            <td style={{color:'var(--info)',fontWeight:600}}>{r.unitsConsumed} units</td>
                            <td>₹{r.ratePerUnit}/unit</td>
                            <td style={{fontWeight:700,textDecoration:status==='waived'?'line-through':'none'}}>₹{r.totalAmount}</td>
                            <td style={{fontSize:'0.78rem',color: r.dueDate && status!=='paid' && status!=='waived' && new Date(r.dueDate)<today ? 'var(--danger)' : 'var(--text2)'}}>
                              {r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—'}
                            </td>
                            <td><StatusDot status={status} />{status==='waived' && r.waivedReason && <div style={{fontSize:'0.66rem',color:'var(--text3)',marginTop:2}}>"{r.waivedReason}"</div>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setElecHistoryRoom(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}