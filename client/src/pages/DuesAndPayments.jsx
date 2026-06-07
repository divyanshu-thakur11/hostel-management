import { useHostel } from '../context/HostelContext';
import React, { useEffect, useState, useCallback } from 'react';
import { membersAPI, receiptsAPI, electricAPI, roomsAPI, whatsapp as wa } from '../utils/api';
import { useToast } from '../context/ToastContext';

const fmt   = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const fmtM  = (n) => `₹${(n||0).toLocaleString('en-IN')}`;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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
  //   - rent due: fixed rent from room config, minus any rent already paid this month
  //   - electric due: current month's electric reading bill, minus any electric paid
  const roomDues = rooms
    .filter(r => r.memberCount > 0)
    .map(r => {
      const rNum = r.roomNumber;
      const fixedRent = r.rent || 0;

      // All receipts for this room this month
      const roomReceiptsThisMonth = receipts.filter(rec =>
        rec.roomNumber === rNum &&
        rec.receiptDate &&
        new Date(rec.receiptDate).getMonth() + 1 === curMon &&
        new Date(rec.receiptDate).getFullYear() === curYr
      );

      // Rent paid = sum of ALL receipt types this month EXCEPT electric.
      // Use amountPaid (not totalAmount) so part-payments are counted correctly.
      // rent, advance, final, other all count toward clearing the month's rent due.
      const rentPaidThisMonth = roomReceiptsThisMonth
        .filter(rec => {
          const type = rec.packageName || rec.paymentType || '';
          return type !== 'electric';
        })
        .reduce((s, rec) => s + (rec.amountPaid ?? rec.totalAmount ?? 0), 0);

      // Due = fixed rent minus whatever has been paid. If paid >= fixedRent, due = 0.
      // If advance was paid this month and exceeds rent, credit shows as 0 due (no negative).
      const rentDue = Math.max(0, fixedRent - rentPaidThisMonth);

      // Electric: current month's reading
      const elecReading = electric.find(e => e.roomNumber === rNum && e.month === curMon && e.year === curYr);
      const elecTotal = elecReading?.totalAmount || 0;
      // Electric paid this month — via explicit electric receipts
      const elecPaidDirect = receipts
        .filter(rec =>
          rec.roomNumber === rNum &&
          (rec.packageName === 'electric' || rec.paymentType === 'electric') &&
          rec.receiptDate &&
          new Date(rec.receiptDate).getMonth() + 1 === curMon &&
          new Date(rec.receiptDate).getFullYear() === curYr
        )
        .reduce((s, rec) => s + (rec.amountPaid ?? rec.totalAmount ?? 0), 0);
      // Electric also paid if a 'final' receipt this month includes it.
      // FIX 5: use the dedicated electricAmount field (set since the model update).
      // Fall back to notes regex for older receipts created before the field existed.
      const elecPaidInFinal = roomReceiptsThisMonth
        .filter(rec => (rec.packageName === 'final' || rec.paymentType === 'final'))
        .reduce((s, rec) => {
          if (rec.electricAmount && rec.electricAmount > 0) return s + rec.electricAmount;
          // Legacy fallback: parse notes string for receipts saved before the field existed
          const m = (rec.notes || '').match(/Electric\s+[\w]+:\s*₹([\d,]+)/);
          return s + (m ? parseInt(m[1].replace(/,/g, '')) : 0);
        }, 0);
      const elecPaid = elecPaidDirect + elecPaidInFinal;
      const elecDue = Math.max(0, elecTotal - elecPaid);

      return {
        roomNumber: rNum,
        members: r.members || [],
        memberCount: r.memberCount,
        fixedRent,
        rentPaidThisMonth,
        rentDue,
        elecTotal,
        elecPaid,
        elecDue,
        elecReading,
        totalDue: rentDue + elecDue,
        mobileNo: (r.members || [])[0]?.mobileNo || '',
        memberMobiles: (r.members || []).map(m => m.mobileNo).filter(Boolean),
        memberNames: (r.members || []).map(m => m.name).join(', '),
      };
    })
    .filter(r => r !== null && r.totalDue > 0)
    .sort((a, b) => b.totalDue - a.totalDue);

  const totalRentDue  = roomDues.reduce((s, r) => s + r.rentDue, 0);
  const totalElecDue  = roomDues.reduce((s, r) => s + r.elecDue, 0);
  const totalDueAll   = totalRentDue + totalElecDue;

  // ── dueDateRooms: strictly rooms with dues as of TODAY ───────────────────
  // Only rooms where totalDue > 0. Grouped by room with primary + others.
  // daysDue = days since the start of current billing month (1st of curMon).
  const dueDateRooms = (() => {
    const billingStart = new Date(curYr, curMon - 1, 1); // 1st of this month
    const daysDue = Math.floor((today - billingStart) / (1000 * 60 * 60 * 24));

    return roomDues
      .filter(r => r.totalDue > 0)
      .map(r => {
        // Part-payment balance due for this room
        const partDue = receipts
          .filter(rec => rec.roomNumber === r.roomNumber && rec.isPartPayment && (rec.balanceDue || 0) > 0)
          .reduce((s, rec) => s + (rec.balanceDue || 0), 0);

        const allMembers = r.members || [];
        const [primary, ...others] = allMembers.length > 0 ? allMembers : [{ name: 'Unknown', mobileNo: '' }];
        return {
          ...r,
          partDue,
          totalDue: r.rentDue + r.elecDue + partDue,
          daysDue: Math.max(1, daysDue),
          primary,
          others,
          memberNames: allMembers.map(m => m.name).join(', '),
        };
      })
      .sort((a, b) => b.totalDue - a.totalDue);
  })();

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

      {/* ── ROOM DUES TAB ─────────────────────────────────────────────────── */}
      {tab === 'dues' && (
        <div>
          {/* Summary bar */}
          <div style={{display:'flex',gap:12,marginBottom:14,flexWrap:'wrap'}}>
            {[
              {label:'Total Rent Due',     value:fmtM(totalRentDue),  color:'var(--danger)'},
              {label:'Total Electric Due', value:fmtM(totalElecDue),  color:'#f39c12'},
              {label:'Grand Total Due',    value:fmtM(totalDueAll),   color:'var(--danger)',bold:true},
              {label:'Rooms with Dues',    value:dueDateRooms.length, color:'var(--text)'},
            ].map((s,i)=>(
              <div key={i} className="card" style={{padding:'12px 16px',flex:'1 1 140px',minWidth:0}}>
                <div style={{fontSize:'0.7rem',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>{s.label}</div>
                <div style={{fontFamily:'Rajdhani',fontWeight:s.bold?800:700,fontSize:'1.3rem',color:s.color}}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Print button */}
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:10}}>
            <button className="btn btn-secondary btn-xs" onClick={() => {
              const rows = dueDateRooms.map(g => {
                const roomMems = members.filter(m => m.roomNumber === g.roomNumber && m.isActive !== false);
                const mobile = roomMems[0]?.mobileNo || g.mobileNo || '—';
                const expiries = roomMems.map(m => m.roomLeavingDate).filter(Boolean).map(d => new Date(d));
                let expiryCell = '—';
                if (expiries.length > 0) {
                  const soonest = new Date(Math.min(...expiries));
                  const diffDays = Math.ceil((soonest - today) / (1000 * 60 * 60 * 24));
                  const dateStr = soonest.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
                  const daysStr = diffDays < 0 ? `Expired ${Math.abs(diffDays)}d ago` : diffDays === 0 ? 'Today' : `${diffDays}d left`;
                  const cls = diffDays < 0 ? 'red' : diffDays <= 7 ? 'gold' : 'green';
                  expiryCell = `<span class="${cls}" style="font-weight:700">${dateStr}</span><br><small style="color:#888;font-size:10px">${daysStr}</small>`;
                }
                return `<tr>
                  <td><strong>Room ${g.roomNumber}</strong></td>
                  <td>${g.memberNames}</td>
                  <td>${mobile}</td>
                  <td>${expiryCell}</td>
                  <td class="red">₹${(g.rentDue||0).toLocaleString('en-IN')}</td>
                  <td class="${g.elecDue>0?'gold':''}">₹${(g.elecDue||0).toLocaleString('en-IN')}</td>
                  <td class="${g.partDue>0?'purple':''}">₹${(g.partDue||0).toLocaleString('en-IN')}</td>
                  <td class="red"><strong>₹${(g.totalDue||0).toLocaleString('en-IN')}</strong></td>
                </tr>`;
              }).join('');
              doPrint(`Room Dues as of ${today.toLocaleDateString('en-IN')}`, `
                <h2>Rooms with Outstanding Dues — as of ${today.toLocaleDateString('en-IN')}</h2>
                <p>Grand Total Due: ₹${totalDueAll.toLocaleString('en-IN')} across ${dueDateRooms.length} rooms</p>
                <table><thead><tr><th>Room</th><th>Members</th><th>Mobile</th><th>Plan Expiry</th><th>Rent Due</th><th>Electric Due</th><th>Part-Pay Balance</th><th>Total Due</th></tr></thead>
                <tbody>${rows}</tbody></table>`);
            }}>🖨 Print Dues List</button>
          </div>

          {dueDateRooms.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">✅</div><p>No rooms with outstanding dues</p></div>
          ) : (
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Primary Member</th>
                      <th>Plan Expiry</th>
                      <th>Rent Due</th>
                      <th>Electric Due</th>
                      <th>Part-Pay Balance</th>
                      <th>Total Due</th>
                      <th>WhatsApp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterR(dueDateRooms).map(g => (
                      <React.Fragment key={g.roomNumber}>
                        {/* Primary row */}
                        <tr style={{borderBottom: g.others.length>0 ? 'none':'1px solid var(--border)'}}>
                          <td>
                            <span className="badge badge-blue">Room {g.roomNumber}</span>
                            {g.others.length>0 && (
                              <span style={{marginLeft:5,fontSize:'0.68rem',color:'var(--text3)'}}>+{g.others.length} more</span>
                            )}
                          </td>
                          <td style={{fontWeight:600,color:'var(--text)'}}>{g.primary.name}</td>
                          <td style={{fontSize:'0.78rem'}}>
                            {(() => {
                              const roomMems = members.filter(m => m.roomNumber === g.roomNumber && m.isActive !== false);
                              const expiries = roomMems.map(m => m.roomLeavingDate).filter(Boolean).map(d => new Date(d));
                              if (!expiries.length) return <span style={{color:'var(--text3)'}}>—</span>;
                              const soonest = new Date(Math.min(...expiries));
                              const diff = Math.ceil((soonest - today) / (1000*60*60*24));
                              const daysLabel = diff < 0 ? `Expired ${Math.abs(diff)}d ago` : diff === 0 ? 'Today' : `${diff}d left`;
                              const color = diff < 0 ? 'var(--danger)' : diff <= 7 ? '#f39c12' : 'var(--success)';
                              const dateStr = soonest.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
                              return (
                                <div>
                                  <span style={{color, fontWeight:700}}>{dateStr}</span>
                                  <div style={{fontSize:'0.68rem', color:'var(--text3)', marginTop:2}}>{daysLabel}</div>
                                </div>
                              );
                            })()}
                          </td>
                          <td style={{color:g.rentDue>0?'var(--danger)':'var(--text3)',fontWeight:g.rentDue>0?700:400}}>
                            {g.rentDue>0 ? fmtM(g.rentDue) : '—'}
                          </td>
                          <td style={{color:g.elecDue>0?'#f39c12':'var(--text3)',fontWeight:g.elecDue>0?700:400}}>
                            {g.elecDue>0 ? fmtM(g.elecDue) : '—'}
                          </td>
                          <td style={{color:g.partDue>0?'var(--purple)':'var(--text3)',fontWeight:g.partDue>0?700:400}}>
                            {g.partDue>0 ? fmtM(g.partDue) : '—'}
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
                                    ``,
                                    g.rentDue>0 ? `🏠 Rent Due: *₹${g.rentDue.toLocaleString('en-IN')}*` : '',
                                    g.elecDue>0 ? `⚡ Electric Due: *₹${g.elecDue.toLocaleString('en-IN')}*` : '',
                                    g.partDue>0 ? `📌 Part-Pay Balance: *₹${g.partDue.toLocaleString('en-IN')}*` : '',
                                    ``,
                                    `💰 *Total Due: ₹${g.totalDue.toLocaleString('en-IN')}*`,
                                    `⏱ Due since: *${g.daysDue} day${g.daysDue!==1?'s':''}*`,
                                    ``,
                                    `Please clear dues at earliest.`,
                                    `Late payment fine: ₹50/day.`,
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
                            <td colSpan={5} style={{color:'var(--text3)',fontSize:'0.75rem'}}>same dues as above</td>
                            <td>
                              {om.mobileNo && (
                                <button style={{background:'#25d366',color:'white',border:'none',borderRadius:5,padding:'3px 7px',cursor:'pointer',fontSize:'0.7rem',fontWeight:700}}
                                  onClick={() => {
                                    const msg = [
                                      `🏠 *Hostel Due Payment Reminder*`,
                                      `Dear *${om.name}*,`,
                                      `🚪 Room No: *${g.roomNumber}*`,
                                      g.rentDue>0 ? `🏠 Rent Due: *₹${g.rentDue.toLocaleString('en-IN')}*` : '',
                                      g.elecDue>0 ? `⚡ Electric Due: *₹${g.elecDue.toLocaleString('en-IN')}*` : '',
                                      g.partDue>0 ? `📌 Part-Pay Balance: *₹${g.partDue.toLocaleString('en-IN')}*` : '',
                                      `💰 *Total Due: ₹${g.totalDue.toLocaleString('en-IN')}*`,
                                      `⏱ Due since: *${g.daysDue} day${g.daysDue!==1?'s':''}*`,
                                      ``,`Please clear dues. Late payment fine: ₹50/day. Thank you 🙏`,
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
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}


      {/* ── PART PAYMENTS TAB ─────────────────────────────────────────────── */}
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
    </div>
  );
}
