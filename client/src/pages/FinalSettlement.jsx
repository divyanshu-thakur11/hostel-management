import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useHostel } from '../context/HostelContext';
import { useToast } from '../context/ToastContext';
import { membersAPI, receiptsAPI, settlementsAPI } from '../utils/api';
import { numberToWords } from '../components/ReceiptPrint';
import { METHODS, methodLabel, computeRentDue, electricReadingDue, rentShare, recType, billMonthKey, monthLabel } from '../utils/dues';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;
const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const PKG = { rent: 'Rent', advance: 'Advance', electric: 'Electric', final: 'Final Bill', other: 'Other' };

const TYPES = {
  advance:             { label: 'Advance held',            dir: 'credit' },
  discount:            { label: 'Discount / waiver',       dir: 'credit' },
  rent_due:            { label: 'Rent due',                dir: 'debit' },
  electric_due:        { label: 'Electric due',            dir: 'debit' },
  other_due:           { label: 'Other charge / damage',   dir: 'debit' },
  payment_from_member: { label: 'Paid by member',          dir: 'paid_by_member' },
  refund:              { label: 'Refund paid to member',   dir: 'paid_to_member' },
};
const DIR_NOTE = { credit: 'in member’s favour', debit: 'member owes', paid_by_member: 'received from member', paid_to_member: 'paid out to member' };

const summarize = (items) => {
  const t = { credits: 0, debits: 0, paidByMember: 0, paidToMember: 0 };
  items.forEach(i => {
    const a = Number(i.amount) || 0; const d = TYPES[i.type]?.dir;
    if (d === 'credit') t.credits += a; else if (d === 'debit') t.debits += a;
    else if (d === 'paid_by_member') t.paidByMember += a; else if (d === 'paid_to_member') t.paidToMember += a;
  });
  const net = r2(t.credits - t.debits + t.paidByMember - t.paidToMember);
  return { ...t, net, state: net === 0 ? 'settled' : net > 0 ? 'refund_pending' : 'recoverable' };
};
const stateText = (s) => s.state === 'settled' ? 'Fully settled — nothing pending'
  : s.state === 'refund_pending' ? `Refund of ${inr(s.net)} is payable to the member`
  : `${inr(Math.abs(s.net))} is recoverable from the member`;

const card = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 14 };
const inp = { background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 7px', color: 'var(--text)', fontSize: '0.8rem', outline: 'none', width: '100%' };

export default function FinalSettlement() {
  const { hostelSwitchCount } = useHostel();
  const toast = useToast();
  const role = (() => { try { return JSON.parse(localStorage.getItem('hm_user'))?.role; } catch { return null; } })();

  const [members, setMembers] = useState([]);
  const [archived, setArchived] = useState([]);
  const [statuses, setStatuses] = useState({});        // memberKey → settlement summary row
  const [search, setSearch] = useState('');
  const [key, setKey] = useState('');
  const [data, setData] = useState(null);
  const [roomReceipts, setRoomReceipts] = useState([]);
  const [includeRoom, setIncludeRoom] = useState(false);
  const [loading, setLoading] = useState(false);

  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadLists = useCallback(() => {
    membersAPI.getAll({ limit: 500 }).then(r => setMembers(r.data?.data || r.data || [])).catch(() => {});
    membersAPI.getArchived({ limit: 500 }).then(r => setArchived(r.data?.data || r.data || [])).catch(() => {});
    settlementsAPI.list().then(r => { const m = {}; (r.data || []).forEach(s => { m[s.memberKey] = s; }); setStatuses(m); }).catch(() => {});
  }, []);
  useEffect(() => { loadLists(); }, [loadLists, hostelSwitchCount]);

  const loadMember = useCallback(async (k, inc) => {
    if (!k) { setData(null); return; }
    setLoading(true);
    try {
      const res = await settlementsAPI.getMember(k, inc);
      setData(res.data);
      const st = res.data.settlement;
      setItems((st?.items || []).map(i => ({ ...i, date: i.date ? String(i.date).split('T')[0] : '' })));
      setNotes(st?.notes || ''); setReason(''); setDirty(false);
      if (res.data.member?.roomNumber) {
        const rr = await receiptsAPI.getByRoom(res.data.member.roomNumber);
        setRoomReceipts(Array.isArray(rr.data) ? rr.data : (rr.data?.data || []));
      } else setRoomReceipts([]);
    } catch (e) { toast(e.response?.data?.message || 'Could not load member', 'error'); setData(null); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { loadMember(key, includeRoom); }, [key, includeRoom, loadMember]);

  // ── Picker list ──
  const sq = search.toLowerCase();
  const pick = useMemo(() => {
    const act = members.filter(m => m.isActive !== false).map(m => ({ key: m._id, name: m.name, room: m.roomNumber, active: true, mobile: m.mobileNo }));
    const arc = archived.map(m => ({ key: m.originalId || m._id, name: m.name, room: m.roomNumber, active: false, mobile: m.mobileNo }));
    return [...act, ...arc].filter(x => !search || x.name?.toLowerCase().includes(sq) || String(x.room || '').includes(sq) || (x.mobile || '').includes(sq));
  }, [members, archived, search, sq]);

  const member = data?.member;
  const settlement = data?.settlement;
  const isSettled = settlement?.status === 'settled';
  const history = data?.history || { receipts: [], electric: [] };

  // ── Derived history figures ──
  const fig = useMemo(() => {
    if (!data) return null;
    const rc = history.receipts;
    const paidOf = (r) => r.amountPaid ?? r.totalAmount ?? 0;
    const rentPaid = r2(rc.reduce((s, r) => s + paidOf(r) * rentShare(r), 0));
    const advancePaid = r2(rc.reduce((s, r) => {
      const t = recType(r);
      if (t === 'advance') return s + paidOf(r);
      if (t === 'final' && r.advanceComponent > 0 && r.totalAmount > 0) return s + r.advanceComponent * (paidOf(r) / r.totalAmount);
      return s;
    }, 0));
    const elec = history.electric.map(e => ({ e, ...electricReadingDue(e, roomReceipts) }));
    const elecBilled = r2(elec.reduce((s, x) => s + x.total, 0));
    const elecPaid = r2(elec.reduce((s, x) => s + x.paid, 0));
    const elecDue = r2(elec.reduce((s, x) => s + x.due, 0));
    const from = member.roomJoinDate || member.admissionDate;
    const rentRoots = roomReceipts.filter(r => !r.parentReceiptId && r.isPartPayment && (r.balanceDue || 0) > 0 && rentShare(r) > 0 && (!from || new Date(r.receiptDate) >= new Date(from)));
    const rentPending = r2(rentRoots.reduce((s, r) => s + r.balanceDue * rentShare(r), 0));
    const allPaid = r2(rc.reduce((s, r) => s + paidOf(r), 0));
    return { rentPaid, advancePaid, elec, elecBilled, elecPaid, elecDue, rentRoots, rentPending, allPaid };
  }, [data, history, roomReceipts, member]);

  const roommates = useMemo(() => !member?.roomNumber ? 0 : members.filter(m => m.isActive !== false && m.roomNumber === member.roomNumber && m._id !== key).length, [members, member, key]);

  // ── Editing ──
  const setItem = (idx, patch) => { setItems(p => p.map((it, i) => i === idx ? { ...it, ...patch } : it)); setDirty(true); };
  const addItem = (type = 'other_due') => { setItems(p => [...p, { _tmp: Date.now() + Math.random(), type, label: '', amount: '', date: '', method: '', referenceNo: '', notes: '', source: 'manual', refKey: '' }]); setDirty(true); };
  const removeItem = (idx) => { setItems(p => p.filter((_, i) => i !== idx)); setDirty(true); };

  const buildFromRecords = () => {
    if (!fig) return;
    const have = new Set(items.map(i => i.refKey).filter(Boolean));
    const add = [];
    const line = (type, label, amount, refKey) => { if (amount > 0 && !have.has(refKey)) add.push({ _tmp: Math.random(), type, label, amount: String(r2(amount)), date: '', method: '', referenceNo: '', notes: '', source: 'auto', refKey }); };
    line('advance', 'Advance deposit held', fig.advancePaid, 'advance');
    fig.rentRoots.forEach(r => line('rent_due', `Rent balance — ${r.billNumber || 'bill'} (${monthLabel(billMonthKey(r))})`, r.balanceDue * rentShare(r), `rent:${r._id}`));
    fig.elec.forEach(x => line('electric_due', `Electric — ${MONTHS[x.e.month - 1]} ${x.e.year}`, x.due, `elec:${x.e._id}`));
    if (member.isActive && member.rent > 0) {
      const c = computeRentDue({ roomNumber: member.roomNumber, fixedRent: member.rent, paidThrough: member.roomLeavingDate ? new Date(member.roomLeavingDate) : null, receipts: roomReceipts });
      line('rent_due', `Rent — ${c.currentMonthLabel} (not yet paid)`, c.newRent, `rentnew:${c.currentMonthLabel}`);
    }
    if (!add.length) { toast('Nothing new to add — every record is already on the statement'); return; }
    setItems(p => [...p, ...add]); setDirty(true);
    toast(`${add.length} line(s) added from records — review and edit as needed`);
  };

  const save = async () => {
    for (const it of items) { if (!String(it.label).trim()) { toast('Every line needs a description', 'error'); return; } if (it.amount === '' || isNaN(Number(it.amount)) || Number(it.amount) < 0) { toast(`Enter a valid amount for "${it.label}"`, 'error'); return; } }
    setSaving(true);
    try {
      const res = await settlementsAPI.save(key, { items: items.map(({ _tmp, ...i }) => ({ ...i, amount: Number(i.amount) })), notes, reason });
      setData(d => ({ ...d, settlement: res.data }));
      setItems(res.data.items.map(i => ({ ...i, date: i.date ? String(i.date).split('T')[0] : '' })));
      setReason(''); setDirty(false); toast('Settlement saved'); loadLists();
    } catch (e) { toast(e.response?.data?.message || 'Error saving', 'error'); }
    finally { setSaving(false); }
  };

  const snapshotNow = () => ({
    generatedAt: new Date().toISOString(), member,
    receipts: history.receipts.map(r => ({ billNumber: r.billNumber, receiptNumber: r.receiptNumber, date: r.receiptDate, type: recType(r), method: methodLabel(r), referenceNo: r.referenceNo || '', amount: r.amountPaid ?? r.totalAmount ?? 0, balance: r.balanceDue || 0, installmentNo: r.parentReceiptId ? r.installmentNo : undefined })),
    electric: fig.elec.map(x => ({ month: x.e.month, year: x.e.year, start: x.e.startReading, end: x.e.endReading, units: x.e.unitsConsumed, rate: x.e.ratePerUnit, amount: x.total, paid: x.paid, due: x.due })),
    totals: { rentPaid: fig.rentPaid, advancePaid: fig.advancePaid, elecBilled: fig.elecBilled, elecPaid: fig.elecPaid, elecDue: fig.elecDue, rentPending: fig.rentPending },
  });

  const finalize = async () => {
    if (dirty) { toast('Save your changes first', 'error'); return; }
    const s = summarize(items);
    if (!window.confirm(`Finalize this settlement?\n\n${stateText(s)}.\n\nA statement number is issued and the record is locked (the owner can reopen it with a reason).`)) return;
    try {
      const res = await settlementsAPI.finalize(key, { snapshot: snapshotNow() });
      setData(d => ({ ...d, settlement: res.data })); toast(`Finalized — ${res.data.statementNo}`); loadLists();
    } catch (e) { toast(e.response?.data?.message || 'Error', 'error'); }
  };
  const reopen = async () => {
    const why = window.prompt('Reason for reopening this finalized settlement:');
    if (!why || !why.trim()) return;
    try { const res = await settlementsAPI.reopen(key, why.trim()); setData(d => ({ ...d, settlement: res.data })); toast('Reopened for editing'); loadLists(); }
    catch (e) { toast(e.response?.data?.message || 'Error', 'error'); }
  };

  // ── Printable statement ──
  const printStatement = () => {
    const snap = isSettled && settlement.snapshot ? settlement.snapshot : snapshotNow();
    const its = settlement ? settlement.items : items.filter(i => i.label);
    const s = summarize(its);
    const m = snap.member || member;
    const row = (cells) => `<tr>${cells.map((c, i) => `<td${i === cells.length - 1 && typeof c === 'string' && c.startsWith('₹') ? ' style="text-align:right"' : ''}>${c ?? ''}</td>`).join('')}</tr>`;
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>Final Settlement</title><style>
      *{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:22px}
      h1{font-size:1.3rem;text-align:center}h2{font-size:.78rem;text-transform:uppercase;margin:16px 0 5px;border-bottom:1px solid #ccc;padding-bottom:3px;color:#444}
      .sub{text-align:center;color:#666;font-size:.75rem;margin:3px 0 12px}table{width:100%;border-collapse:collapse;margin-bottom:6px}
      th{background:#f3f3f3;text-align:left;font-size:10px;text-transform:uppercase;padding:5px 7px;border:1px solid #ddd}td{padding:5px 7px;border:1px solid #ddd;font-size:11.5px}
      .net{margin-top:12px;padding:12px;border:2px solid #111;text-align:center;font-size:1.05rem;font-weight:700}.sig{display:flex;justify-content:space-between;margin-top:46px}.sig div{width:170px;border-top:1px solid #333;text-align:center;padding-top:5px;font-size:11px;color:#555}
      .meta{display:flex;flex-wrap:wrap;gap:4px 24px;margin-bottom:6px}.meta span{color:#555}@media print{@page{margin:10mm}}</style></head><body>
      <h1>HOSTEL MANAGER — FINAL SETTLEMENT STATEMENT</h1>
      <div class="sub">${settlement?.statementNo ? `Statement No. <b>${settlement.statementNo}</b> · ` : '<b>DRAFT</b> · '}Generated ${fmtD(new Date())}${isSettled ? ` · Finalized ${fmtD(settlement.settledAt)}` : ''}</div>
      <div class="meta"><div><span>Member:</span> <b>${m.name || ''}</b> ${m.memberId ? `(${m.memberId})` : ''}</div><div><span>Mobile:</span> ${m.mobileNo || '—'}</div><div><span>Room:</span> ${m.roomNumber ?? '—'}</div>
      <div><span>Joined:</span> ${fmtD(m.roomJoinDate)}</div><div><span>${m.vacatedOn ? 'Vacated' : 'Paid through'}:</span> ${fmtD(m.vacatedOn || m.roomLeavingDate)}</div></div>
      <h2>Summary of dues &amp; payments</h2>
      <table><tbody>${row(['Total rent paid', inr(snap.totals?.rentPaid)])}${row(['Electric billed / paid / due', `${inr(snap.totals?.elecBilled)} / ${inr(snap.totals?.elecPaid)} / ${inr(snap.totals?.elecDue)}`])}${row(['Advance deposited', inr(snap.totals?.advancePaid)])}${row(['Pending rent (part-payment balances)', inr(snap.totals?.rentPending)])}</tbody></table>
      <h2>Payments received (every installment, with method)</h2>
      <table><thead><tr><th>Date</th><th>Bill / Receipt</th><th>Type</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead><tbody>${(snap.receipts || []).map(r => row([fmtD(r.date), `${r.billNumber || '—'} #${r.receiptNumber ?? ''}`, PKG[r.type] || r.type, r.method, r.referenceNo || '—', inr(r.amount)])).join('') || row(['No payments on record', '', '', '', '', ''])}</tbody></table>
      <h2>Electricity bills</h2>
      <table><thead><tr><th>Month</th><th>Reading</th><th>Units</th><th>Bill</th><th>Paid</th><th>Due</th></tr></thead><tbody>${(snap.electric || []).map(e => row([`${MONTHS[e.month - 1]} ${e.year}`, `${e.start} → ${e.end}`, e.units, inr(e.amount), inr(e.paid), inr(e.due)])).join('') || row(['No readings', '', '', '', '', ''])}</tbody></table>
      <h2>Settlement</h2>
      <table><thead><tr><th>Description</th><th>Nature</th><th>Method / Ref</th><th>Date</th><th>Amount</th></tr></thead><tbody>${its.map(i => row([i.label + (i.notes ? ` <small style="color:#777">(${i.notes})</small>` : ''), DIR_NOTE[TYPES[i.type]?.dir] || '', [i.method ? (METHODS.find(x => x.value === i.method)?.label || i.method) : '', i.referenceNo].filter(Boolean).join(' · ') || '—', fmtD(i.date), (TYPES[i.type]?.dir === 'debit' || TYPES[i.type]?.dir === 'paid_to_member' ? '− ' : '+ ') + inr(i.amount)])).join('')}</tbody></table>
      <table style="width:300px;margin-left:auto"><tbody>${row(['Credits (advance, discounts)', inr(s.credits)])}${row(['Less: dues &amp; charges', inr(s.debits)])}${row(['Add: paid by member', inr(s.paidByMember)])}${row(['Less: refunded to member', inr(s.paidToMember)])}</tbody></table>
      <div class="net">${stateText(s)}<div style="font-size:.7rem;font-weight:400;margin-top:3px">${numberToWords(Math.abs(s.net))} Rupees Only</div></div>
      ${(settlement?.notes || notes) ? `<p style="margin-top:10px;color:#555">Notes: ${settlement?.notes || notes}</p>` : ''}
      <div class="sig"><div>Member Signature</div><div>Owner / Manager Signature</div></div></body></html>`);
    w.document.close(); setTimeout(() => w.print(), 400);
  };

  const totals = summarize(items);
  const stBadge = (k) => { const s = statuses[k]; if (!s) return null; return s.status === 'settled' ? ' ✅' : ' 📝'; };

  return (
    <div>
      <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search member / room / mobile…" style={{ ...inp, width: 230, padding: '8px 12px' }} />
        <select value={key} onChange={e => setKey(e.target.value)} style={{ ...inp, width: 'auto', minWidth: 280, padding: '8px 12px' }}>
          <option value="">— Select member —</option>
          <optgroup label="Current members">{pick.filter(x => x.active).map(x => <option key={x.key} value={x.key}>{x.name}{x.room ? ` · Room ${x.room}` : ''}{stBadge(x.key)}</option>)}</optgroup>
          <optgroup label="Vacated members (records preserved)">{pick.filter(x => !x.active).map(x => <option key={x.key} value={x.key}>{x.name}{x.room ? ` · was Room ${x.room}` : ''}{stBadge(x.key)}</option>)}</optgroup>
        </select>
        <span style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>✅ finalized · 📝 in progress</span>
      </div>

      {!key && <div className="card"><div className="empty-state"><div className="empty-icon">🧾</div><p>Select a member to see their complete financial history and prepare the final settlement</p></div></div>}
      {key && loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>⏳ Loading…</div>}

      {key && !loading && data && fig && (
        <>
          {/* Member header */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontFamily: 'Rajdhani', fontSize: '1.3rem', fontWeight: 700 }}>{member.name} <span style={{ fontSize: '0.8rem', color: 'var(--text3)', fontWeight: 400 }}>{member.memberId}</span></div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text2)', marginTop: 3 }}>
                  📱 {member.mobileNo || '—'} · 🚪 {member.roomNumber ? `Room ${member.roomNumber}` : 'No room'} · Joined {fmtD(member.roomJoinDate || member.admissionDate)} · {member.isActive ? `Paid through ${fmtD(member.roomLeavingDate)}` : `Vacated ${fmtD(member.vacatedOn)}${member.vacatedReason ? ` (${member.vacatedReason})` : ''}`}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text3)', marginTop: 2 }}>Agreed rent {inr(member.rent)} · agreed advance {inr(member.advance)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className={`badge ${member.isActive ? 'badge-green' : 'badge-yellow'}`}>{member.isActive ? 'Current member' : 'Vacated'}</span>{' '}
                <span className={`badge ${isSettled ? 'badge-green' : 'badge-blue'}`}>{isSettled ? `Finalized ${settlement.statementNo}` : 'Settlement open'}</span>
              </div>
            </div>
            {roommates > 0 && <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(243,156,18,0.08)', border: '1px solid rgba(243,156,18,0.3)', borderRadius: 6, fontSize: '0.78rem' }}>⚠️ Room {member.roomNumber} has {roommates} other current member(s). Rent and electric are billed per room, so these figures are room-level — adjust the settlement lines to this member’s share where needed.</div>}
          </div>

          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
            {[['Rent paid', inr(fig.rentPaid), 'var(--success)'], ['Electric billed', inr(fig.elecBilled), '#f39c12'], ['Electric paid', inr(fig.elecPaid), 'var(--success)'], ['Electric pending', inr(fig.elecDue), fig.elecDue > 0 ? 'var(--danger)' : 'var(--text3)'],
              ['Advance paid', inr(fig.advancePaid), 'var(--info)'], ['Pending rent balance', inr(fig.rentPending), fig.rentPending > 0 ? 'var(--danger)' : 'var(--text3)']].map(([l, v, c], i) => (
              <div key={i} className="card" style={{ padding: '10px 14px' }}><div style={{ fontSize: '0.66rem', color: 'var(--text3)', textTransform: 'uppercase' }}>{l}</div><div style={{ fontFamily: 'Rajdhani', fontWeight: 700, fontSize: '1.3rem', color: c }}>{v}</div></div>
            ))}
          </div>

          {/* Payments history */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <h3 style={{ fontFamily: 'Rajdhani' }}>💳 Payments, advances &amp; installments</h3>
              {history.roomOnlyCount > 0 && (
                <label style={{ fontSize: '0.78rem', cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={includeRoom} onChange={e => setIncludeRoom(e.target.checked)} />
                  Include {history.roomOnlyCount} other receipt(s) for this room during the stay
                </label>
              )}
            </div>
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Bill / Receipt</th><th>Type</th><th>Method</th><th>Reference</th><th>Amount</th><th>Bill balance</th></tr></thead>
              <tbody>{history.receipts.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)' }}>No receipts linked to this member{history.roomOnlyCount ? ' — tick the box above to see the room’s receipts' : ''}</td></tr> : history.receipts.map(r => (
                <tr key={r._id} style={r._linked === false ? { opacity: 0.7 } : {}}>
                  <td>{fmtD(r.receiptDate)}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{r.billNumber || '—'} <span style={{ color: 'var(--text3)' }}>#{r.receiptNumber}</span>{r.parentReceiptId && <span className="badge badge-yellow" style={{ marginLeft: 4, fontSize: '0.6rem' }}>installment {r.installmentNo}</span>}{r._linked === false && <span style={{ marginLeft: 4, fontSize: '0.6rem', color: 'var(--text3)' }}>room</span>}</td>
                  <td>{PKG[recType(r)] || recType(r)}</td>
                  <td><span className={`badge ${r.modeOfPayment === 'online' ? 'badge-blue' : 'badge-green'}`} style={{ fontSize: '0.68rem' }}>{methodLabel(r)}</span></td>
                  <td style={{ fontSize: '0.78rem' }}>{r.referenceNo || '—'}</td>
                  <td style={{ fontWeight: 700, color: 'var(--success)' }}>{inr(r.amountPaid ?? r.totalAmount)}</td>
                  <td style={{ color: (r.balanceDue || r.balanceAfter || 0) > 0 ? 'var(--danger)' : 'var(--text3)' }}>{(r.parentReceiptId ? r.balanceAfter : r.balanceDue) > 0 ? inr(r.parentReceiptId ? r.balanceAfter : r.balanceDue) : '—'}</td>
                </tr>))}</tbody>
            </table></div>
          </div>

          {/* Electric history */}
          <div style={card}>
            <h3 style={{ fontFamily: 'Rajdhani', marginBottom: 8 }}>⚡ Electricity bills (room {member.roomNumber ?? '—'})</h3>
            <div className="table-wrap"><table>
              <thead><tr><th>Month</th><th>Reading</th><th>Units</th><th>Bill</th><th>Paid</th><th>Pending</th></tr></thead>
              <tbody>{fig.elec.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text3)' }}>No readings for this stay</td></tr> : fig.elec.map(x => (
                <tr key={x.e._id} style={x.waived ? { opacity: 0.6 } : {}}>
                  <td>{MONTHS[x.e.month - 1]} {x.e.year}{x.waived && ' (waived)'}</td><td>{x.e.startReading} → {x.e.endReading}</td><td>{x.e.unitsConsumed}</td>
                  <td>{inr(x.total)}</td><td style={{ color: 'var(--success)' }}>{inr(x.paid)}</td><td style={{ color: x.due > 0 ? 'var(--danger)' : 'var(--text3)', fontWeight: x.due > 0 ? 700 : 400 }}>{x.due > 0 ? inr(x.due) : '—'}</td>
                </tr>))}</tbody>
            </table></div>
          </div>

          {/* Settlement statement editor */}
          <div style={{ ...card, borderColor: 'var(--accent)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <h3 style={{ fontFamily: 'Rajdhani' }}>🧾 Final settlement statement {isSettled && <span style={{ color: 'var(--success)' }}>— {settlement.statementNo} (locked)</span>}</h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {!isSettled && <button className="btn btn-secondary btn-xs" onClick={buildFromRecords}>⚙️ Build from records</button>}
                {!isSettled && <button className="btn btn-secondary btn-xs" onClick={() => addItem('other_due')}>+ Add line</button>}
                <button className="btn btn-success btn-xs" onClick={printStatement} disabled={!items.length && !settlement}>🖨 Print statement</button>
              </div>
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text3)', marginBottom: 10 }}>
              Advance and credits are in the member’s favour; dues and charges are owed by the member. “Build from records” suggests lines from the history above — every line stays editable. Changes are logged below.
            </div>
            <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left', fontSize: '0.68rem', textTransform: 'uppercase', color: 'var(--text3)' }}><th style={{ padding: 4 }}>Type</th><th>Description</th><th>Amount ₹</th><th>Date</th><th>Method</th><th>Reference</th><th /></tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: '0.82rem' }}>No lines yet — use “Build from records” or add one manually.</td></tr>}
                {items.map((it, idx) => (
                  <tr key={it._id || it._tmp} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: 4, minWidth: 150 }}><select disabled={isSettled} style={inp} value={it.type} onChange={e => setItem(idx, { type: e.target.value })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></td>
                    <td style={{ padding: 4, minWidth: 190 }}><input disabled={isSettled} style={inp} value={it.label} onChange={e => setItem(idx, { label: e.target.value })} placeholder="Description" /></td>
                    <td style={{ padding: 4, width: 100 }}><input disabled={isSettled} type="number" style={inp} value={it.amount} onChange={e => setItem(idx, { amount: e.target.value })} /></td>
                    <td style={{ padding: 4, width: 130 }}><input disabled={isSettled} type="date" style={inp} value={it.date || ''} onChange={e => setItem(idx, { date: e.target.value })} /></td>
                    <td style={{ padding: 4, width: 120 }}>{(it.type === 'refund' || it.type === 'payment_from_member') ? <select disabled={isSettled} style={inp} value={it.method || ''} onChange={e => setItem(idx, { method: e.target.value })}><option value="">—</option>{METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select> : <span style={{ color: 'var(--text3)', fontSize: '0.7rem' }}>{DIR_NOTE[TYPES[it.type]?.dir]}</span>}</td>
                    <td style={{ padding: 4, width: 120 }}>{(it.type === 'refund' || it.type === 'payment_from_member') && <input disabled={isSettled} style={inp} value={it.referenceNo || ''} onChange={e => setItem(idx, { referenceNo: e.target.value })} placeholder="Txn ID" />}</td>
                    <td style={{ padding: 4 }}>{!isSettled && <button className="btn btn-danger btn-xs" onClick={() => removeItem(idx)}>🗑</button>}</td>
                  </tr>))}
              </tbody>
            </table></div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
              <div style={{ flex: '1 1 260px' }}>
                <label style={{ fontSize: '0.7rem', color: 'var(--text3)', textTransform: 'uppercase' }}>Notes</label>
                <textarea disabled={isSettled} rows={3} style={{ ...inp, marginTop: 4, resize: 'vertical' }} value={notes} onChange={e => { setNotes(e.target.value); setDirty(true); }} />
                {!isSettled && settlement && dirty && (<>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text3)', textTransform: 'uppercase', display: 'block', marginTop: 8 }}>Reason for changes (required when changing or removing saved lines)</label>
                  <input style={{ ...inp, marginTop: 4 }} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. damage charge waived after discussion" />
                </>)}
              </div>
              <div style={{ minWidth: 280, background: 'var(--bg3)', borderRadius: 8, padding: 12, fontSize: '0.84rem' }}>
                {[['Credits (advance, discounts)', totals.credits], ['Less: dues & charges', totals.debits], ['Add: paid by member', totals.paidByMember], ['Less: refunded to member', totals.paidToMember]].map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span style={{ color: 'var(--text2)' }}>{l}</span><span>{inr(v)}</span></div>))}
                <div style={{ borderTop: '2px solid var(--border2)', marginTop: 6, paddingTop: 8, fontFamily: 'Rajdhani', fontWeight: 700, fontSize: '1.05rem', color: totals.state === 'settled' ? 'var(--success)' : totals.state === 'refund_pending' ? 'var(--info)' : 'var(--danger)' }}>{stateText(totals)}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
              {isSettled ? (role === 'owner'
                ? <button className="btn btn-secondary" onClick={reopen}>🔓 Reopen to edit (owner)</button>
                : <span style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>Finalized — only the owner can reopen it.</span>)
                : (<>
                  <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>{saving ? '⏳ Saving…' : '💾 Save settlement'}</button>
                  <button className="btn btn-success" onClick={finalize} disabled={!settlement || dirty || !items.length} title={dirty ? 'Save first' : ''}>✅ Finalize &amp; issue statement</button>
                </>)}
            </div>
          </div>

          {/* Audit history */}
          <div style={card}>
            <h3 style={{ fontFamily: 'Rajdhani', marginBottom: 8 }}>🕒 Change history</h3>
            {!(settlement?.history || []).length ? <div style={{ color: 'var(--text3)', fontSize: '0.82rem' }}>No changes recorded yet.</div> : [...settlement.history].reverse().map((h, i) => (
              <div key={i} style={{ borderLeft: '3px solid var(--border2)', padding: '4px 0 8px 10px', marginBottom: 6 }}>
                <div style={{ fontSize: '0.8rem' }}><strong style={{ textTransform: 'capitalize' }}>{h.action}</strong> · {h.byName || '—'} ({h.byRole || '—'}) · <span style={{ color: 'var(--text3)' }}>{new Date(h.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
                {h.summary && <div style={{ fontSize: '0.78rem', color: 'var(--text2)' }}>{h.summary}</div>}
                {h.reason && <div style={{ fontSize: '0.76rem', color: 'var(--text3)' }}>Reason: {h.reason}</div>}
                {(h.changes || []).map((c, j) => <div key={j} style={{ fontSize: '0.74rem', color: 'var(--text3)' }}>• {c.field}{c.from !== null && c.from !== undefined ? `: ${String(c.from)} → ${String(c.to ?? '—')}` : c.to != null ? `: ${String(c.to)}` : ''}</div>)}
              </div>))}
          </div>
        </>
      )}
    </div>
  );
}
