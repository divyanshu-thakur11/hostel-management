import { useHostel } from '../context/HostelContext';
import React, { useEffect, useState, useRef } from 'react';
import { membersAPI, receiptsAPI, electricAPI, roomsAPI, whatsapp as wa } from '../utils/api';

function numberToWords(num) {
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  if (!num || num === 0) return 'Zero';
  let n = Math.floor(num), words = '';
  if (Math.floor(n/100000)>0){words+=numberToWords(Math.floor(n/100000))+' Lakh ';n%=100000;}
  if (Math.floor(n/1000)>0){words+=numberToWords(Math.floor(n/1000))+' Thousand ';n%=1000;}
  if (Math.floor(n/100)>0){words+=numberToWords(Math.floor(n/100))+' Hundred ';n%=100;}
  if (n>0){if(n<20)words+=ones[n];else words+=tens[Math.floor(n/10)]+(n%10?' '+ones[n%10]:'');}
  return words.trim();
}

export default function FinalBilling() {
  const { hostelSwitchCount } = useHostel();
  const [members,  setMembers]  = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [electric, setElectric] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [roomMembers,  setRoomMembers]  = useState([]);
  const [roomReceipts, setRoomReceipts] = useState([]);
  const [roomElectric, setRoomElectric] = useState([]);
  const [roomConfig,   setRoomConfig]   = useState(null); // fixed rent/advance from Room section
  const printRef = useRef();

  useEffect(() => {
    membersAPI.getAll({ limit:500 }).then(r => setMembers(r.data?.data || r.data || []));
    receiptsAPI.getAll({ limit:1000 }).then(r => setReceipts(r.data?.data || r.data || []));
    electricAPI.getAll().then(r => setElectric(r.data?.data || r.data || []));
  }, [hostelSwitchCount]);

  useEffect(() => {
    if (!selectedRoom) { setRoomMembers([]); setRoomReceipts([]); setRoomElectric([]); setRoomConfig(null); return; }
    setRoomMembers(members.filter(m => String(m.roomNumber) === selectedRoom && m.isActive !== false));
    setRoomReceipts(receipts.filter(r => String(r.roomNumber) === selectedRoom).sort((a,b) => new Date(a.receiptDate)-new Date(b.receiptDate)));
    setRoomElectric(electric.filter(r => String(r.roomNumber) === selectedRoom).sort((a,b) => a.year-b.year||a.month-b.month));
    // Fetch fixed room config
    roomsAPI.getOne(selectedRoom).then(r => setRoomConfig(r.data)).catch(() => setRoomConfig(null));
  }, [selectedRoom, members, receipts, electric]);

  const rentReceipts     = roomReceipts.filter(r => r.paymentType==='rent'     || r.packageName==='rent');
  const advanceReceipts  = roomReceipts.filter(r => r.paymentType==='advance'  || r.packageName==='advance');
  const electricReceipts = roomReceipts.filter(r => r.paymentType==='electric' || r.packageName==='electric');
  const finalReceipts    = roomReceipts.filter(r => r.paymentType==='final'    || r.packageName==='final');
  const otherReceipts    = roomReceipts.filter(r => !['rent','advance','electric','final'].includes(r.paymentType||r.packageName));

  const totalRentPaid    = rentReceipts.reduce((s,r) => s+(r.amountPaid||r.totalAmount||0), 0);
  const totalAdvancePaid = advanceReceipts.reduce((s,r) => s+(r.amountPaid||r.totalAmount||0), 0);
  const totalFinalPaid   = finalReceipts.reduce((s,r) => s+(r.amountPaid||r.totalAmount||0), 0);
  const totalElectricBill= roomElectric.reduce((s,r) => s+(r.totalAmount||0), 0);
  const totalOtherPaid   = otherReceipts.reduce((s,r) => s+(r.amountPaid||r.totalAmount||0), 0);
  const grandTotal       = totalRentPaid + totalAdvancePaid + totalFinalPaid + totalElectricBill + totalOtherPaid;

  // From room config (fixed values set in Rooms section)
  const fixedRent        = roomConfig?.rent    || 0;
  const fixedAdvance     = roomConfig?.advance || 0;

  // Advance balance = fixed advance minus any advance receipts created
  const advanceBalance   = Math.max(0, fixedAdvance - totalAdvancePaid);

  const doPrint = () => {
    const w = window.open('','_blank');
    w.document.write('<html><head><title>Final Billing</title>');
    w.document.write('<link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&display=swap" rel="stylesheet">');
    w.document.write('<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:"Noto Sans",sans-serif;padding:20px;color:#111;font-size:12px;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;}th{background:#f5f5f5;font-weight:700;}@media print{@page{margin:10mm;}}</style>');
    w.document.write('</head><body>');
    w.document.write(printRef.current.innerHTML);
    w.document.write('</body></html>');
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  const sendWhatsAppSummary = (mobile) => {
    const memberName = roomMembers.map(m=>m.name).join(', ') || '—';
    const msg = [
      `🏠 *FINAL BILLING STATEMENT*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🚪 Room No: ${selectedRoom}`,
      `👤 Member(s): ${memberName}`,
      `📅 Generated: ${new Date().toLocaleDateString('en-IN')}`,
      ``,
      `💰 *PAYMENT SUMMARY*`,
      totalRentPaid    ? `• Rent Paid: ₹${totalRentPaid.toLocaleString('en-IN')}`     : '',
      totalAdvancePaid ? `• Advance: ₹${totalAdvancePaid.toLocaleString('en-IN')}` : '',
      totalElectricBill? `• Electric: ₹${totalElectricBill.toLocaleString('en-IN')}` : '',
      totalOtherPaid   ? `• Other: ₹${totalOtherPaid.toLocaleString('en-IN')}`     : '',
      ``,
      `*GRAND TOTAL: ₹${grandTotal.toLocaleString('en-IN')}*`,
      `(${numberToWords(grandTotal)} Rupees Only)`,
      ``,
      `Thank you 🙏`,
    ].filter(l => l !== undefined && l !== '').join('\n');
    wa.sendCustom(mobile, msg);
  };

  const fmt = d => d ? new Date(d).toLocaleDateString('en-IN') : '—';
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const occupiedRooms = [...new Set(members.filter(m=>m.roomNumber&&m.isActive!==false).map(m=>m.roomNumber))].sort((a,b)=>a-b);
  const primaryMobile = roomMembers[0]?.mobileNo;

  return (
    <div>
      <div className="page-header">
        <div><h2>Final Billing</h2><p>Cumulative billing summary per room</p></div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
          <select style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 14px',color:'var(--text)',outline:'none',fontSize:'0.85rem'}}
            value={selectedRoom} onChange={e=>setSelectedRoom(e.target.value)}>
            <option value="">— Select Room —</option>
            {occupiedRooms.map(n=><option key={n} value={n}>Room {n}</option>)}
          </select>
          {selectedRoom && (
            <>
              <button className="btn btn-primary" onClick={doPrint}>🖨 Print / PDF</button>
              {primaryMobile && (
                <>
                  <button style={{background:'#25d366',color:'white',border:'none',padding:'9px 16px',borderRadius:7,cursor:'pointer',fontWeight:700,fontSize:'0.85rem',fontFamily:'Rajdhani'}}
                    onClick={() => sendWhatsAppSummary(primaryMobile)}>
                    📱 WhatsApp Summary
                  </button>
                  <button style={{background:'#128C7E',color:'white',border:'none',padding:'9px 16px',borderRadius:7,cursor:'pointer',fontWeight:700,fontSize:'0.85rem',fontFamily:'Rajdhani'}}
                    onClick={() => { doPrint(); setTimeout(() => sendWhatsAppSummary(primaryMobile), 1500); }}
                    title="Print PDF then send WhatsApp">
                    📄📱 PDF + WhatsApp
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Room Config Info */}
      {selectedRoom && roomConfig && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginBottom:16}}>
          {[
            {label:'Fixed Monthly Rent',   value:`₹${fixedRent.toLocaleString('en-IN')}`,     color:'var(--accent)',  icon:'🏷️'},
            {label:'Fixed Advance',        value:`₹${fixedAdvance.toLocaleString('en-IN')}`,   color:'var(--info)',    icon:'💵'},
            {label:'Advance Paid So Far',  value:`₹${totalAdvancePaid.toLocaleString('en-IN')}`,color:'var(--success)',icon:'✅'},
            {label:'Advance Balance Due',  value:`₹${advanceBalance.toLocaleString('en-IN')}`,  color: advanceBalance>0?'var(--danger)':'var(--success)', icon:'🔒'},
          ].map((c,i)=>(
            <div key={i} className="card" style={{padding:'12px 14px'}}>
              <div style={{fontSize:'0.68rem',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>{c.icon} {c.label}</div>
              <div style={{fontFamily:'Rajdhani',fontSize:'1.3rem',fontWeight:700,color:c.color}}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {!selectedRoom ? (
        <div className="card"><div className="empty-state"><div className="empty-icon">🧾</div><p>Select a room to view its final billing summary</p></div></div>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:16}}>
            {[
              {label:'Rent Paid',    value:`₹${totalRentPaid.toLocaleString('en-IN')}`,    color:'var(--success)'},
              {label:'Advance',      value:`₹${totalAdvancePaid.toLocaleString('en-IN')}`, color:'var(--info)'},
              {label:'Final Bill',   value:`₹${totalFinalPaid.toLocaleString('en-IN')}`,   color:'var(--accent)'},
              {label:'Electric',     value:`₹${totalElectricBill.toLocaleString('en-IN')}`,color:'#f39c12'},
              {label:'Grand Total',  value:`₹${grandTotal.toLocaleString('en-IN')}`,       color:'var(--danger)'},
            ].map((c,i)=>(
              <div key={i} className="card">
                <div style={{fontSize:'0.68rem',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>{c.label}</div>
                <div style={{fontFamily:'Rajdhani',fontSize:'1.5rem',fontWeight:700,color:c.color}}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* Member info strip */}
          <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 16px',marginBottom:14,display:'flex',gap:16,flexWrap:'wrap',alignItems:'center'}}>
            <span style={{fontSize:'0.82rem',color:'var(--text2)'}}><strong>Room:</strong> {selectedRoom}</span>
            <span style={{fontSize:'0.82rem',color:'var(--text2)'}}><strong>Members:</strong> {roomMembers.map(m=>m.name).join(', ')||'—'}</span>
            {primaryMobile && <span style={{fontSize:'0.82rem',color:'var(--text2)'}}><strong>Mobile:</strong> {primaryMobile}</span>}
          </div>

          <div className="card" style={{background:'white',color:'#111'}}>
            <div ref={printRef}>
              <div style={{fontFamily:'"Noto Sans",sans-serif',padding:'20px',color:'#111'}}>
                <div style={{textAlign:'center',borderBottom:'2px solid #111',paddingBottom:12,marginBottom:16}}>
                  <div style={{fontSize:'1.4rem',fontWeight:700}}>HOSTEL MANAGER</div>
                  <div style={{fontSize:'0.8rem',color:'#555',textTransform:'uppercase',letterSpacing:'0.1em'}}>Final Billing Statement — Room {selectedRoom}</div>
                  <div style={{fontSize:'0.8rem',marginTop:4}}>Generated: {new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}</div>
                </div>
                <div style={{marginBottom:14,fontSize:'13px'}}>
                  <strong>Members:</strong> {roomMembers.map(m=>m.name).join(', ')||'—'}&nbsp;&nbsp;|&nbsp;&nbsp;<strong>Room:</strong> {selectedRoom}
                </div>

                {/* Rent */}
                {rentReceipts.length > 0 && <BillTable title="Rent Payments" rows={rentReceipts.map(r=>[r.billNumber||'—',fmt(r.receiptDate),fmt(r.fromDate),fmt(r.toDate),r.modeOfPayment,`₹${(r.amountPaid||r.totalAmount||0).toLocaleString('en-IN')}`])} headers={['Bill No.','Date','From','To','Mode','Amount']} total={totalRentPaid} />}
                {/* Final Bill */}
                {finalReceipts.length > 0 && <BillTable title="Final Bill Payments" rows={finalReceipts.map(r=>[r.billNumber||'—',fmt(r.receiptDate),fmt(r.fromDate),fmt(r.toDate),r.modeOfPayment,`₹${(r.amountPaid||r.totalAmount||0).toLocaleString('en-IN')}`])} headers={['Bill No.','Date','From','To','Mode','Amount']} total={totalFinalPaid} />}
                {/* Advance */}
                {advanceReceipts.length > 0 && <BillTable title="Advance Payments" rows={advanceReceipts.map(r=>[r.billNumber||'—',fmt(r.receiptDate),r.modeOfPayment,`₹${(r.amountPaid||r.totalAmount||0).toLocaleString('en-IN')}`])} headers={['Bill No.','Date','Mode','Amount']} total={totalAdvancePaid} />}
                {/* Electric */}
                {roomElectric.length > 0 && <BillTable title="Electric Bills" rows={roomElectric.map(r=>[MONTHS[(r.month||1)-1],r.year,r.unitsConsumed,`₹${r.ratePerUnit}/unit`,`₹${r.totalAmount}`])} headers={['Month','Year','Units','Rate','Amount']} total={totalElectricBill} />}
                {/* Other */}
                {otherReceipts.length > 0 && <BillTable title="Other Payments" rows={otherReceipts.map(r=>[r.billNumber||'—',fmt(r.receiptDate),(r.packageName||'other'),`₹${(r.amountPaid||r.totalAmount||0).toLocaleString('en-IN')}`])} headers={['Bill No.','Date','Type','Amount']} total={totalOtherPaid} />}

                {/* Grand Total */}
                <div style={{display:'flex',justifyContent:'flex-end',marginTop:16}}>
                  <table style={{width:'280px',borderCollapse:'collapse',fontSize:'13px'}}>
                    <tbody>
                      {[
                        ['Total Rent',    `₹${totalRentPaid.toLocaleString('en-IN')}`],
                        ['Final Bill',    `₹${totalFinalPaid.toLocaleString('en-IN')}`],
                        ['Total Advance', `₹${totalAdvancePaid.toLocaleString('en-IN')}`],
                        ['Total Electric',`₹${totalElectricBill.toLocaleString('en-IN')}`],
                        ['Other',         `₹${totalOtherPaid.toLocaleString('en-IN')}`],
                      ].map(([l,v],i)=>(
                        <tr key={i}><td style={{padding:'5px 10px',color:'#555'}}>{l}</td><td style={{padding:'5px 10px',textAlign:'right',fontWeight:500}}>{v}</td></tr>
                      ))}
                      <tr style={{background:'#111',color:'white',fontWeight:700,fontSize:'14px'}}>
                        <td style={{padding:'8px 10px'}}>GRAND TOTAL</td>
                        <td style={{padding:'8px 10px',textAlign:'right'}}>₹{grandTotal.toLocaleString('en-IN')}</td>
                      </tr>
                      <tr><td colSpan={2} style={{padding:'6px 10px',fontSize:'11px',color:'#555',fontStyle:'italic'}}>{numberToWords(grandTotal)} Rupees Only</td></tr>
                    </tbody>
                  </table>
                </div>
                <div style={{marginTop:40,display:'flex',justifyContent:'space-between',fontSize:'12px',color:'#555'}}>
                  <div style={{textAlign:'center'}}><div style={{borderTop:'1px solid #333',width:160,paddingTop:6}}>Tenant Signature</div></div>
                  <div style={{textAlign:'center'}}><div style={{borderTop:'1px solid #333',width:160,paddingTop:6}}>Owner Signature</div></div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BillTable({ title, headers, rows, total }) {
  const td = (content, extra={}) => <td style={{border:'1px solid #ddd',padding:'5px 8px',...extra}}>{content}</td>;
  return (
    <div style={{marginBottom:16}}>
      <div style={{fontWeight:700,marginBottom:6,fontSize:'13px',textTransform:'uppercase',borderBottom:'1px solid #ddd',paddingBottom:4}}>{title}</div>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
        <thead><tr style={{background:'#f5f5f5'}}>{headers.map((h,i)=><th key={i} style={{border:'1px solid #ddd',padding:'5px 8px',fontWeight:700}}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((row,i)=><tr key={i}>{row.map((cell,j)=>td(cell, j===row.length-1?{fontWeight:600}:{}))}</tr>)}
          <tr style={{background:'#f9f9f9',fontWeight:700}}>
            {headers.slice(0,-1).map((_,i)=>i===0?<td key={i} style={{border:'1px solid #ddd',padding:'5px 8px',textAlign:'right'}} colSpan={headers.length-1}>Subtotal</td>:null).filter(Boolean)}
            {td(`₹${total}`,{fontWeight:700})}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
