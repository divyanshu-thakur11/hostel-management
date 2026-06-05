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
  const [bulkDueFrom, setBulkDueFrom] = useState(''); // F3: date filter for bulk WA
  const [bulkDueTo,   setBulkDueTo]   = useState('');
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
      // Rent: fixed rent from room config
      const fixedRent = r.rent || 0;
      // Rent paid this month for this room
      const rentPaidThisMonth = receipts
        .filter(rec =>
          rec.roomNumber === rNum &&
          (rec.packageName === 'rent' || rec.paymentType === 'rent') &&
          rec.receiptDate &&
          new Date(rec.receiptDate).getMonth() + 1 === curMon &&
          new Date(rec.receiptDate).getFullYear() === curYr
        )
        .reduce((s, rec) => s + (rec.amountPaid || rec.totalAmount || 0), 0);
      const rentDue = Math.max(0, fixedRent - rentPaidThisMonth);

      // Electric: current month's reading
      const elecReading = electric.find(e => e.roomNumber === rNum && e.month === curMon && e.year === curYr);
      const elecTotal = elecReading?.totalAmount || 0;
      // Electric paid this month
      const elecPaid = receipts
        .filter(rec =>
          rec.roomNumber === rNum &&
          (rec.packageName === 'electric' || rec.paymentType === 'electric') &&
          rec.receiptDate &&
          new Date(rec.receiptDate).getMonth() + 1 === curMon &&
          new Date(rec.receiptDate).getFullYear() === curYr
        )
        .reduce((s, rec) => s + (rec.amountPaid || rec.totalAmount || 0), 0);
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
    .filter(r => r.totalDue > 0 || r.fixedRent > 0)
    .sort((a, b) => b.totalDue - a.totalDue);

  const totalRentDue  = roomDues.reduce((s, r) => s + r.rentDue, 0);
  const totalElecDue  = roomDues.reduce((s, r) => s + r.elecDue, 0);
  const totalDueAll   = totalRentDue + totalElecDue;

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
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,marginBottom:12,padding:'10px 14px',background:'rgba(231,76,60,0.06)',borderRadius:6,fontSize:'0.83rem',color:'var(--text2)'}}>
            <span>💡 Shows rent and electric dues for <strong>{MONTHS[curMon-1]} {curYr}</strong>. Rent due = Fixed room rent minus what's already been paid this month. Electric due = This month's meter reading bill minus what's been paid.</span>
            <button className="btn btn-secondary btn-xs" onClick={() => {
              const rows = filterR(roomDues).map(r => `
                <tr>
                  <td><strong>Room ${r.roomNumber}</strong></td>
                  <td>${r.memberNames||'—'}</td>
                  <td>${r.memberCount}</td>
                  <td class="${r.fixedRent?'':''}">₹${(r.fixedRent||0).toLocaleString('en-IN')}</td>
                  <td class="green">₹${(r.rentPaidThisMonth||0).toLocaleString('en-IN')}</td>
                  <td class="${r.rentDue>0?'red':''}">₹${(r.rentDue||0).toLocaleString('en-IN')}</td>
                  <td>₹${(r.elecTotal||0).toLocaleString('en-IN')}</td>
                  <td class="${r.elecDue>0?'gold':''}">₹${(r.elecDue||0).toLocaleString('en-IN')}</td>
                  <td class="${r.totalDue>0?'red':'green'}"><strong>₹${(r.totalDue||0).toLocaleString('en-IN')}</strong></td>
                </tr>`).join('');
              doPrint(`Room Dues — ${MONTHS[curMon-1]} ${curYr}`, `
                <h2>Room Dues — ${MONTHS[curMon-1]} ${curYr}</h2>
                <p>Total Rent Due: ₹${totalRentDue.toLocaleString('en-IN')} &nbsp;|&nbsp; Total Electric Due: ₹${totalElecDue.toLocaleString('en-IN')} &nbsp;|&nbsp; Grand Total: ₹${totalDueAll.toLocaleString('en-IN')}</p>
                <table><thead><tr><th>Room</th><th>Members</th><th>Count</th><th>Fixed Rent</th><th>Paid</th><th>Rent Due</th><th>Elec Bill</th><th>Elec Due</th><th>Total Due</th></tr></thead>
                <tbody>${rows}</tbody></table>`);
            }}>🖨 Print Dues List</button>

            {/* F3: Bulk WhatsApp — date filter + one window per member */}
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:4,padding:'10px 12px',background:'rgba(37,211,102,0.05)',border:'1px solid rgba(37,211,102,0.2)',borderRadius:8}}>
              <span style={{fontSize:'0.78rem',color:'var(--text3)',fontWeight:600,whiteSpace:'nowrap'}}>📱 Bulk WhatsApp — due since:</span>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <label style={{fontSize:'0.72rem',color:'var(--text3)'}}>From</label>
                <input type="date" value={bulkDueFrom} onChange={e=>setBulkDueFrom(e.target.value)}
                  style={{background:'var(--bg3)',border:'1px solid var(--border2)',borderRadius:5,padding:'4px 7px',color:'var(--text)',fontSize:'0.78rem',outline:'none'}} />
              </div>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <label style={{fontSize:'0.72rem',color:'var(--text3)'}}>To</label>
                <input type="date" value={bulkDueTo} onChange={e=>setBulkDueTo(e.target.value)}
                  style={{background:'var(--bg3)',border:'1px solid var(--border2)',borderRadius:5,padding:'4px 7px',color:'var(--text)',fontSize:'0.78rem',outline:'none'}} />
              </div>
              {(bulkDueFrom||bulkDueTo) && (
                <button className="btn btn-xs btn-secondary" onClick={()=>{setBulkDueFrom('');setBulkDueTo('');}}>✕</button>
              )}
              <button
                style={{background:'#25d366',color:'white',border:'none',fontWeight:700,cursor:'pointer',borderRadius:6,padding:'6px 12px',fontSize:'0.8rem',marginLeft:'auto'}}
                onClick={() => {
                  // Build list of all individual members with dues
                  const allDueMembers = [];
                  filterR(roomDues).forEach(r => {
                    if (r.totalDue <= 0) return;
                    // Apply date filter on roomLeavingDate / joinDate if set
                    if (bulkDueFrom || bulkDueTo) {
                      const membersList = members.filter(m => m.roomNumber === r.roomNumber && m.isActive !== false);
                      const filtered = membersList.filter(m => {
                        const joinDate = m.roomJoinDate ? new Date(m.roomJoinDate) : null;
                        if (bulkDueFrom && joinDate && joinDate < new Date(bulkDueFrom)) return false;
                        if (bulkDueTo   && joinDate && joinDate > new Date(bulkDueTo))   return false;
                        return true;
                      });
                      filtered.forEach(m => {
                        if (m.mobileNo) allDueMembers.push({ member: m, room: r });
                      });
                    } else {
                      // No date filter — include all members of due rooms
                      (r.members || []).forEach(m => {
                        if (m.mobileNo) allDueMembers.push({ member: m, room: r });
                      });
                    }
                  });

                  if (allDueMembers.length === 0) {
                    alert('No members with dues found for the selected criteria.');
                    return;
                  }
                  if (!window.confirm(`Send WhatsApp reminder to ${allDueMembers.length} member(s) across ${new Set(allDueMembers.map(x=>x.room.roomNumber)).size} room(s)?`)) return;

                  // Open one WhatsApp window per member with 1.5s gap
                  allDueMembers.forEach(({ member, room }, idx) => {
                    setTimeout(() => {
                      const daysDue = room.rentDue > 0
                        ? Math.floor((new Date() - new Date(new Date().getFullYear(), curMon-1, 1)) / (1000*60*60*24))
                        : 0;
                      const msg = [
                        `🏠 *Hostel Rent Reminder*`,
                        `━━━━━━━━━━━━━━━━`,
                        `📅 Month: ${MONTHS[curMon-1]} ${curYr}`,
                        ``,
                        `Dear *${member.name}*,`,
                        `🚪 Room No: *${room.roomNumber}*`,
                        ``,
                        room.rentDue > 0 ? `🏠 Rent Due: *₹${room.rentDue.toLocaleString('en-IN')}*` : '',
                        room.elecDue > 0 ? `⚡ Electric Due: *₹${room.elecDue.toLocaleString('en-IN')}*` : '',
                        ``,
                        `💰 *Total Pending: ₹${room.totalDue.toLocaleString('en-IN')}*`,
                        daysDue > 0 ? `⏱ Due since: *${daysDue} day${daysDue!==1?'s':''} ago*` : '',
                        ``,
                        `Please clear dues at earliest.`,
                        `Late payment fine: ₹50/day.`,
                        ``,
                        `Thank you 🙏`,
                      ].filter(Boolean).join('\n');
                      const num = `91${String(member.mobileNo).replace(/\D/g,'').slice(-10)}`;
                      window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
                    }, idx * 1500);
                  });
                  toast(`Opening WhatsApp for ${allDueMembers.length} member(s)...`);
                }}>
                📱 Send to All Due ({filterR(roomDues).filter(r=>r.totalDue>0).reduce((s,r)=>{
                  const mCount = (r.members||[]).filter(m=>m.mobileNo).length;
                  return s + (mCount || 1);
                }, 0)} members)
              </button>
            </div>
          </div>

          {/* Summary row */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:14}}>
            {[
              {label:`Rent Due — ${MONTHS[curMon-1]} ${curYr}`, value:fmtM(totalRentDue), color:'var(--danger)'},
              {label:`Electric Due — ${MONTHS[curMon-1]} ${curYr}`, value:fmtM(totalElecDue), color:'var(--accent)'},
              {label:'Grand Total Due', value:fmtM(totalDueAll), color:'var(--danger)'},
            ].map((s,i)=>(
              <div key={i} className="card" style={{textAlign:'center',padding:'10px'}}>
                <div style={{fontSize:'0.7rem',color:'var(--text3)',marginBottom:4}}>{s.label}</div>
                <div style={{fontFamily:'Rajdhani',fontSize:'1.3rem',fontWeight:700,color:s.color}}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="card">
            {filterR(roomDues).length === 0 ? (
              <div className="empty-state"><div className="empty-icon">✅</div><p>All rooms are paid up for this month!</p></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Room</th><th>Members</th>
                      <th style={{color:'var(--danger)'}}>Fixed Rent</th>
                      <th style={{color:'var(--success)'}}>Rent Paid</th>
                      <th style={{color:'var(--danger)'}}>Rent Due</th>
                      <th style={{color:'var(--accent)'}}>Electric Bill</th>
                      <th style={{color:'var(--success)'}}>Elec Paid</th>
                      <th style={{color:'var(--accent)'}}>Elec Due</th>
                      <th style={{fontWeight:700}}>Total Due</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterR(roomDues).map(r => (
                      <tr key={r.roomNumber} style={{background:r.totalDue>0?'rgba(231,76,60,0.03)':'transparent'}}>
                        <td><span className="badge badge-blue" style={{fontSize:'0.85rem',fontWeight:700}}>Room {r.roomNumber}</span></td>
                        <td style={{fontSize:'0.78rem',color:'var(--text2)',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={r.memberNames}>
                          {r.memberNames || '—'}
                        </td>
                        <td style={{color:'var(--text)',fontWeight:600}}>{fmtM(r.fixedRent)}</td>
                        <td style={{color:'var(--success)'}}>{r.rentPaidThisMonth > 0 ? fmtM(r.rentPaidThisMonth) : <span style={{color:'var(--text3)'}}>—</span>}</td>
                        <td>
                          {r.rentDue > 0
                            ? <span style={{color:'var(--danger)',fontWeight:700}}>{fmtM(r.rentDue)}</span>
                            : <span className="badge badge-green" style={{fontSize:'0.7rem'}}>Paid ✓</span>}
                        </td>
                        <td style={{color:'var(--text2)'}}>
                          {r.elecReading
                            ? <span title={`${r.elecReading.unitsConsumed} units @ ₹${r.elecReading.ratePerUnit}/unit`}>{fmtM(r.elecTotal)}</span>
                            : <span style={{color:'var(--text3)',fontSize:'0.75rem'}}>No reading</span>}
                        </td>
                        <td style={{color:'var(--success)'}}>{r.elecPaid > 0 ? fmtM(r.elecPaid) : <span style={{color:'var(--text3)'}}>—</span>}</td>
                        <td>
                          {r.elecDue > 0
                            ? <span style={{color:'var(--accent)',fontWeight:700}}>{fmtM(r.elecDue)}</span>
                            : r.elecTotal > 0
                              ? <span className="badge badge-green" style={{fontSize:'0.7rem'}}>Paid ✓</span>
                              : <span style={{color:'var(--text3)',fontSize:'0.75rem'}}>—</span>}
                        </td>
                        <td>
                          <span style={{background:r.totalDue>0?'rgba(231,76,60,0.12)':'rgba(46,204,113,0.12)',color:r.totalDue>0?'var(--danger)':'var(--success)',padding:'3px 10px',borderRadius:10,fontWeight:700,fontSize:'0.85rem'}}>
                            {r.totalDue > 0 ? fmtM(r.totalDue) : 'Paid ✓'}
                          </span>
                        </td>
                        <td>
                          {r.mobileNo && r.totalDue > 0 && (
                            <button style={{background:'#25d366',color:'white',border:'none',borderRadius:5,padding:'5px 10px',cursor:'pointer',fontSize:'0.72rem',fontWeight:700,whiteSpace:'nowrap'}}
                              onClick={() => wa.sendCustom(r.mobileNo,
                                `🏠 *HOSTEL DUES — ${MONTHS[curMon-1]} ${curYr}*\n\n🚪 Room ${r.roomNumber}\n👥 ${r.memberNames}\n\n` +
                                (r.rentDue > 0 ? `🏷️ Rent Due: *₹${r.rentDue.toLocaleString('en-IN')}*\n` : '') +
                                (r.elecDue > 0 ? `⚡ Electric Due: *₹${r.elecDue.toLocaleString('en-IN')}*\n` : '') +
                                `\n💰 *Total Due: ₹${r.totalDue.toLocaleString('en-IN')}*\n\nKindly pay by 5th of the month.\nLate fee: ₹50/day\n\nThank you 🙏`
                              )}>
                              📱 WhatsApp
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{background:'var(--bg3)',fontWeight:700}}>
                      <td colSpan={2} style={{padding:'8px 14px',color:'var(--text)'}}>TOTAL ({filterR(roomDues).length} rooms)</td>
                      <td style={{padding:'8px 14px',color:'var(--text)'}}>{fmtM(filterR(roomDues).reduce((s,r)=>s+r.fixedRent,0))}</td>
                      <td style={{padding:'8px 14px',color:'var(--success)'}}>{fmtM(filterR(roomDues).reduce((s,r)=>s+r.rentPaidThisMonth,0))}</td>
                      <td style={{padding:'8px 14px',color:'var(--danger)'}}>{fmtM(filterR(roomDues).reduce((s,r)=>s+r.rentDue,0))}</td>
                      <td style={{padding:'8px 14px'}}>{fmtM(filterR(roomDues).reduce((s,r)=>s+r.elecTotal,0))}</td>
                      <td style={{padding:'8px 14px',color:'var(--success)'}}>{fmtM(filterR(roomDues).reduce((s,r)=>s+r.elecPaid,0))}</td>
                      <td style={{padding:'8px 14px',color:'var(--accent)'}}>{fmtM(filterR(roomDues).reduce((s,r)=>s+r.elecDue,0))}</td>
                      <td style={{padding:'8px 14px',color:'var(--danger)',fontWeight:700}}>{fmtM(filterR(roomDues).reduce((s,r)=>s+r.totalDue,0))}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
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
                    <th>Member</th><th>Room</th><th>Mobile</th>
                    <th>Plan Expires</th><th>Days Left</th>
                    <th>Monthly Rent</th><th>Electric Due</th><th>Total Due</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filterM(expiringSoon).map(m => {
                    const d    = Math.ceil((new Date(m.roomLeavingDate)-today)/(1000*60*60*24));
                    const elec = getElecDueForRoom(m.roomNumber);
                    const totalDueM = (m.rent||0) + elec.elecDue;
                    return (
                      <tr key={m._id}>
                        <td style={{color:'var(--text)',fontWeight:600}}>{m.name}</td>
                        <td>{m.roomNumber?<span className="badge badge-blue">Room {m.roomNumber}</span>:'—'}</td>
                        <td style={{fontSize:'0.82rem'}}>{m.mobileNo||'—'}</td>
                        <td style={{color:'var(--accent)'}}>{fmt(m.roomLeavingDate)}</td>
                        <td>
                          <span style={{background:d<=3?'rgba(231,76,60,0.12)':'rgba(240,165,0,0.12)',color:d<=3?'var(--danger)':'var(--accent)',padding:'2px 10px',borderRadius:10,fontWeight:700,fontSize:'0.8rem'}}>
                            {d} day{d!==1?'s':''} left
                          </span>
                        </td>
                        <td>{m.rent?fmtM(m.rent):'—'}</td>
                        <td style={{color:elec.elecDue>0?'var(--accent)':'var(--text3)',fontWeight:elec.elecDue>0?600:400}}>
                          {elec.elecDue>0 ? (
                            <span title={`Bill: ₹${elec.elecTotal} — Paid: ₹${elec.elecPaid}`}>
                              {fmtM(elec.elecDue)}
                              {elec.elecTotal>0 && <span style={{fontSize:'0.7rem',color:'var(--text3)',marginLeft:4}}>of ₹{elec.elecTotal.toLocaleString('en-IN')}</span>}
                            </span>
                          ) : <span style={{color:'var(--text3)'}}>—</span>}
                        </td>
                        <td style={{color:totalDueM>0?'var(--danger)':'var(--text3)',fontWeight:totalDueM>0?700:400}}>
                          {totalDueM>0 ? fmtM(totalDueM) : '—'}
                        </td>
                        <td>
                          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                            {m.mobileNo && (
                              <button style={{background:'#25d366',color:'white',border:'none',borderRadius:5,padding:'4px 8px',cursor:'pointer',fontSize:'0.72rem',fontWeight:700}}
                                onClick={()=>wa.sendReminder(m.mobileNo,m.name,m.roomNumber,m.rent||0,'stay renewal')}>
                                📱 Remind
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
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
