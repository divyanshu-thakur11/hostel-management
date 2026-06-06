import { useHostel } from '../context/HostelContext';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { membersAPI, receiptsAPI, roomsAPI, electricAPI, whatsapp } from '../utils/api';
import { useToast } from '../context/ToastContext';

function numberToWords(num) {
  const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  if (!num || num === 0) return 'Zero';
  let n = Math.floor(num), w = '';
  if (Math.floor(n/100000)>0){w+=numberToWords(Math.floor(n/100000))+' Lakh ';n%=100000;}
  if (Math.floor(n/1000)>0){w+=numberToWords(Math.floor(n/1000))+' Thousand ';n%=1000;}
  if (Math.floor(n/100)>0){w+=numberToWords(Math.floor(n/100))+' Hundred ';n%=100;}
  if (n>0){if(n<20)w+=a[n];else w+=b[Math.floor(n/10)]+(n%10?' '+a[n%10]:'');}
  return w.trim();
}

const PKG = { rent:'Rent / किराया', advance:'Advance / एडवांस', electric:'Electric / बिजली', final:'Final Bill / अंतिम', other:'Other / अन्य' };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const EMPTY = {
  receiptNumber:'', billNumber:'', billYear:'', billSerial:'',
  roomNumber:'', memberMode:'all', memberName:'', memberMobile:'', memberId:'',
  packageName:'rent', fromDate:'', toDate:'', billingMonth:'',
  totalAmount:'', amountPaid:'', balanceDue:'0', isPartPayment:false, electricAmount:0,
  modeOfPayment:'cash', notes:'',
  receiptDate: new Date().toISOString().split('T')[0],
};

const selStyle = { background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:6, padding:'8px 10px', color:'var(--text)', outline:'none', fontSize:'0.88rem' };

export default function Receipts() {
  const [receipts, setReceipts]     = useState([]);
  const [total, setTotal]           = useState(0);
  const [pages, setPages]           = useState(1);
  const [page, setPage]             = useState(1);
  const [members, setMembers]       = useState([]);
  const [roomMembers, setRoomMembers] = useState([]);
  const [roomConfig, setRoomConfig] = useState(null);
  const [showModal, setShowModal]   = useState(false);
  const [showPrint, setShowPrint]   = useState(null);
  const [form, setForm]             = useState(EMPTY);
  const [dueModal, setDueModal]     = useState(null);
  const [dueForm, setDueForm]       = useState({ modeOfPayment:'cash', receiptDate:'', notes:'' });
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [roomF, setRoomF]           = useState('');
  const [typeF, setTypeF]           = useState('');
  const [modeF, setModeF]           = useState('');
  const [fromF, setFromF]           = useState('');
  const [toF, setToF]               = useState('');
  const printRef = useRef();
  const toast = useToast();

  // Load receipts with filters
  const { hostelSwitchCount } = useHostel();
  const loadReceipts = useCallback((p = 1) => {
    setLoading(true);
    const params = { page: p, limit: 30 };
    if (search) params.search = search;
    if (roomF)  params.room   = roomF;
    if (typeF)  params.type   = typeF;
    if (modeF)  params.mode   = modeF;
    if (fromF)  params.from   = fromF;
    if (toF)    params.to     = toF;
    receiptsAPI.getAll(params)
      .then(r => {
        const d = r.data;
        setReceipts(Array.isArray(d) ? d : (d?.data || []));
        setTotal(d?.total || 0);
        setPages(d?.pages || 1);
        setPage(p);
      })
      .catch(() => toast('Failed to load receipts', 'error'))
      .finally(() => setLoading(false));
  }, [search, roomF, typeF, modeF, fromF, toF]);

  useEffect(() => { loadReceipts(1); }, [loadReceipts]);
  useEffect(() => {
    membersAPI.getAll({ limit: 500 }).then(r => setMembers(r.data?.data || r.data || []));
  }, [hostelSwitchCount]);

  const uniqueRooms = [...new Set(
    members.filter(m => m.roomNumber && m.isActive !== false).map(m => m.roomNumber)
  )].sort((a,b) => a-b);

  // ── When room is selected ─────────────────────────────────────────────────
  const handleRoomChange = async (roomNo) => {
    const rm = members.filter(m => String(m.roomNumber) === String(roomNo) && m.isActive !== false);
    setRoomMembers(rm);
    setRoomConfig(null);

    // Auto-fill from date based on last receipt for this room
    const roomReceipts = receipts
      .filter(r => String(r.roomNumber) === String(roomNo) && r.toDate)
      .sort((a,b) => new Date(b.toDate) - new Date(a.toDate));
    const lastToDate = roomReceipts[0]?.toDate;
    const fromDate = lastToDate
      ? new Date(new Date(lastToDate).getTime() + 86400000).toISOString().split('T')[0]
      : (rm[0]?.roomJoinDate ? new Date(rm[0].roomJoinDate).toISOString().split('T')[0] : '');

    // Set billing month to current month
    const now = new Date();
    const billingMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

    setForm(p => ({ ...p, roomNumber: roomNo, fromDate, billingMonth, memberName:'', memberMobile:'', memberId:'', totalAmount:'' }));

    // Fetch room config
    try {
      const r = await roomsAPI.getOne(roomNo);
      setRoomConfig(r.data);
      setForm(p => ({ ...p, totalAmount: String(r.data?.rent || '') }));
    } catch(e) {}
  };

  // ── Member mode: all vs single ────────────────────────────────────────────
  const handleMemberMode = (mode) => {
    setForm(p => ({
      ...p, memberMode: mode,
      memberName: mode === 'all' ? roomMembers.map(m=>m.name).join(', ') : '',
      memberMobile: mode === 'all' ? (roomMembers[0]?.mobileNo || '') : '',
      memberId: mode === 'all' ? (roomMembers[0]?._id || '') : '',
    }));
  };

  const handleSingleMember = (name) => {
    const m = roomMembers.find(x => x.name === name);
    setForm(p => ({ ...p, memberName: name, memberMobile: m?.mobileNo || '', memberId: m?._id || '' }));
  };

  // ── Package change: auto-fill amount, for final = cumulative ─────────────
  const handlePackageChange = async (pkg) => {
    let amount = '';
    let notes = '';
    const billingMonth = form.billingMonth;

    if (pkg === 'rent')    { amount = String(roomConfig?.rent    || ''); }
    if (pkg === 'advance') { amount = String(roomConfig?.advance || ''); }

    if (pkg === 'electric' && form.roomNumber && billingMonth) {
      // Fetch current month's electric reading only
      try {
        const [year, month] = billingMonth.split('-').map(Number);
        const eRes = await electricAPI.getByRoom(form.roomNumber);
        const readings = eRes.data?.data || eRes.data || [];
        const thisMonth = readings.find(r => r.year === year && r.month === month);
        if (thisMonth) {
          amount = String(thisMonth.totalAmount || '');
          notes = `Electric: ${MONTHS[month-1]} ${year} · ${thisMonth.unitsConsumed} units @ ₹${thisMonth.ratePerUnit}/unit`;
        } else {
          notes = 'No electric reading found for this month. Add it in Electric section first.';
        }
      } catch(e) {}
    }

    if (pkg === 'final' && form.roomNumber && billingMonth) {
      // Final = rent (current month) + electric (current month only) + pending balances
      try {
        const [year, month] = (billingMonth || '').split('-').map(Number);
        const fixedRent = roomConfig?.rent || 0;

        // Get this month's electric only
        let electricAmt = 0;
        let electricNote = '';
        if (year && month) {
          const eRes = await electricAPI.getByRoom(form.roomNumber);
          const readings = eRes.data?.data || eRes.data || [];
          const thisMonthElec = readings.find(r => r.year === year && r.month === month);
          if (thisMonthElec) {
            electricAmt = thisMonthElec.totalAmount || 0;
            electricNote = ` + Electric ${MONTHS[month-1]}: ₹${electricAmt}`;
          }
        }

        // Pending balances from part payments
        const rRes = await receiptsAPI.getAll({ room: form.roomNumber, limit: 500 });
        const rList = rRes.data?.data || rRes.data || [];
        const pendingBalance = rList.reduce((s,r) => s + (r.balanceDue || 0), 0);

        amount = String(fixedRent + electricAmt + pendingBalance);
        notes = `Final Bill: Rent ₹${fixedRent}${electricNote}${pendingBalance > 0 ? ` + Pending ₹${pendingBalance}` : ''}`;
        // FIX 5: store electricAmount explicitly on form so it's sent to server
        setForm(p => ({ ...p, packageName: pkg, totalAmount: amount, notes, electricAmount: electricAmt }));
        return;
      } catch(e) {}
    }

    // FIX 6: warn when billing month is missing for final package
    if (pkg === 'final' && form.roomNumber && !billingMonth) {
      toast('⚠ Select a Billing Month first — electric charges may be missing from the final bill.', 'warning');
    }

    setForm(p => ({ ...p, packageName: pkg, totalAmount: amount, notes, electricAmount: 0 }));
  };

  // ── Part payment recalc ───────────────────────────────────────────────────
  const handleAmountPaidChange = (val) => {
    const paid  = parseFloat(val) || 0;
    const total = parseFloat(form.totalAmount) || 0;
    setForm(p => ({ ...p, amountPaid: val, balanceDue: String(Math.max(0, total - paid)) }));
  };

  const handlePartPayment = (checked) => {
    setForm(p => ({
      ...p, isPartPayment: checked,
      amountPaid: checked ? '' : p.totalAmount,
      balanceDue: checked ? p.totalAmount : '0',
    }));
  };

  // ── Save receipt ──────────────────────────────────────────────────────────
  const save = async () => {
    if (!form.roomNumber) { toast('Please select a room', 'error'); return; }
    if (!form.totalAmount) { toast('Please enter amount', 'error'); return; }

    const amountPaid = form.isPartPayment ? (parseFloat(form.amountPaid) || 0) : (parseFloat(form.totalAmount) || 0);
    const balanceDue = Math.max(0, (parseFloat(form.totalAmount) || 0) - amountPaid);

    // Build members list
    const allMem = roomMembers.map(m => ({ name:m.name, memberId:m._id, memberUniqueId:m.memberId, mobileNo:m.mobileNo }));
    const isAll  = form.memberMode === 'all';
    const memberName   = isAll ? allMem.map(m=>m.name).join(', ') : form.memberName;
    const memberMobile = isAll ? (roomMembers[0]?.mobileNo || '') : form.memberMobile;
    const memberId     = isAll ? (roomMembers[0]?._id || '') : form.memberId;
    const members_list = isAll ? allMem : allMem.filter(m => m.name === form.memberName);

    const payload = {
      ...form,
      memberName, memberMobile, memberId,
      members: members_list,
      totalAmount:    parseFloat(form.totalAmount) || 0,
      amountPaid,
      balanceDue,
      amountInWords:  numberToWords(amountPaid) + ' Rupees Only',
      paymentType:    form.packageName,
      receiptNumber:  parseInt(form.receiptNumber) || 1,
      billSerial:     parseInt(form.billSerial) || 1,
      electricAmount: parseFloat(form.electricAmount) || 0,
    };

    try {
      const res = await receiptsAPI.create(payload);
      // Auto-update roomLeavingDate for members if toDate given
      if (form.toDate) {
        const toUpdate = isAll ? roomMembers : roomMembers.filter(m => m.name === form.memberName);
        await Promise.all(toUpdate.map(m => membersAPI.update(m._id, { roomLeavingDate: form.toDate }).catch(()=>{})));
      }
      toast(`Receipt created${form.isPartPayment ? ` · Balance: ₹${balanceDue}` : ''}`);
      setShowModal(false);
      loadReceipts(page);
      setShowPrint(res.data);
    } catch(e) {
      toast(e.response?.data?.message || 'Error creating receipt', 'error');
    }
  };

  const del = async (id) => {
    if (!window.confirm('Delete this receipt?')) return;
    try { await receiptsAPI.delete(id); toast('Deleted'); loadReceipts(page); }
    catch(e) { toast('Error deleting', 'error'); }
  };

  // Create a due-clearance receipt from an outstanding part payment
  const saveDueReceipt = async () => {
    if (!dueModal) return;
    try {
      const nums = await receiptsAPI.getNextNumbers();
      const payload = {
        ...nums.data,
        roomNumber:     dueModal.roomNumber,
        memberId:       dueModal.memberId,
        memberName:     dueModal.memberName,
        memberMobile:   dueModal.memberMobile,
        members:        dueModal.members || [],
        packageName:    dueModal.packageName || 'rent',  // Bug 3 fix: use original packageName not 'other'
        paymentType:    dueModal.packageName || 'rent',
        totalAmount:    dueModal.balanceDue,
        amountPaid:     dueModal.balanceDue,
        balanceDue:     0,
        isPartPayment:  false,
        modeOfPayment:  dueForm.modeOfPayment,
        receiptDate:    dueForm.receiptDate || new Date().toISOString().split('T')[0],
        notes:          dueForm.notes || `Due clearance against Bill No. ${dueModal.billNumber}`,
        amountInWords:  numberToWords(dueModal.balanceDue) + ' Rupees Only',
        fromDate:       dueModal.fromDate,
        toDate:         dueModal.toDate,
        monthYear:      dueModal.monthYear,
        billingMonth:   dueModal.billingMonth,
      };
      await receiptsAPI.create(payload);
      // Bug 2 fix: clear balanceDue on the original part-payment receipt
      await receiptsAPI.clearDue(dueModal._id);
      toast(`Due receipt created for ₹${dueModal.balanceDue.toLocaleString('en-IN')}`);
      setDueModal(null);
      loadReceipts(page);
    } catch(e) {
      toast(e.response?.data?.message || 'Error creating due receipt', 'error');
    }
  };

  const openModal = async () => {
    try {
      const nums = await receiptsAPI.getNextNumbers();
      setForm({ ...EMPTY, ...nums.data, receiptDate: new Date().toISOString().split('T')[0] });
    } catch { setForm({ ...EMPTY }); }
    setRoomMembers([]); setRoomConfig(null);
    setShowModal(true);
  };

  const doPrint = () => {
    const w = window.open('', '_blank');
    w.document.write('<html><head><title>Receipt</title>');
    w.document.write('<link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&display=swap" rel="stylesheet">');
    w.document.write('<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:"Noto Sans",sans-serif;padding:20px;color:#111;}</style>');
    w.document.write('</head><body>');
    w.document.write(printRef.current.innerHTML);
    w.document.write('</body></html>');
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  const now = new Date();
  const billingMonthOptions = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    billingMonthOptions.push({ val, label });
  }

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetResult, setResetResult]       = useState(null);

  const handleResetSerial = async (yearType) => {
    try {
      const r = await receiptsAPI.resetSerial(yearType);
      setResetResult(r.data);
      toast(`Bill number reset — next bill: ${r.data.nextBill}`);
    } catch(e) { toast('Reset failed', 'error'); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h2>Receipts</h2><p>{total} receipts · room-wise billing</p></div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button className="btn btn-secondary" onClick={()=>{setShowResetModal(true);setResetResult(null);}}>📅 New Year Reset</button>
          <button className="btn btn-primary" onClick={openModal}>+ New Receipt</button>
        </div>
      </div>

      {/* New Year Reset Modal */}
      {showResetModal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowResetModal(false)}>
          <div className="modal" style={{maxWidth:420}}>
            <div className="modal-header"><h3>📅 Reset Bill Serial Number</h3><button className="close-btn" onClick={()=>setShowResetModal(false)}>✕</button></div>
            <div className="modal-body">
              <p style={{color:'var(--text2)',fontSize:'0.85rem',marginBottom:16}}>
                Choose your year type. The next receipt will start from <strong>/001</strong> in the new year format.
                Existing receipts are not affected.
              </p>
              {resetResult && (
                <div style={{background:'rgba(46,204,113,0.08)',border:'1px solid rgba(46,204,113,0.3)',borderRadius:8,padding:'12px 16px',marginBottom:16}}>
                  <div style={{color:'var(--success)',fontWeight:700,fontSize:'0.95rem'}}>✓ {resetResult.message}</div>
                  <div style={{color:'var(--text2)',fontSize:'0.85rem',marginTop:4}}>Next bill: <strong>{resetResult.nextBill}</strong></div>
                </div>
              )}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <button onClick={()=>handleResetSerial('april')} className="btn btn-secondary" style={{padding:'16px',height:'auto',flexDirection:'column',gap:4,alignItems:'center'}}>
                  <span style={{fontSize:'1.4rem'}}>📅</span>
                  <strong>April 1st</strong>
                  <span style={{fontSize:'0.75rem',color:'var(--text3)'}}>Financial year (26-27)</span>
                </button>
                <button onClick={()=>handleResetSerial('january')} className="btn btn-secondary" style={{padding:'16px',height:'auto',flexDirection:'column',gap:4,alignItems:'center'}}>
                  <span style={{fontSize:'1.4rem'}}>🗓️</span>
                  <strong>January 1st</strong>
                  <span style={{fontSize:'0.75rem',color:'var(--text3)'}}>Calendar year (26-26)</span>
                </button>
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setShowResetModal(false)}>Close</button></div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Name / bill no / room…" style={{ ...selStyle, flex:1, minWidth:160 }} />
        <select style={selStyle} value={roomF} onChange={e=>setRoomF(e.target.value)}>
          <option value="">All Rooms</option>
          {Array.from({length:20},(_,i)=>i+1).map(n=><option key={n} value={n}>Room {n}</option>)}
        </select>
        <select style={selStyle} value={typeF} onChange={e=>setTypeF(e.target.value)}>
          <option value="">All Types</option>
          {Object.entries(PKG).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
        <select style={selStyle} value={modeF} onChange={e=>setModeF(e.target.value)}>
          <option value="">All Modes</option>
          <option value="cash">Cash</option>
          <option value="online">Online</option>
        </select>
        <input type="date" style={selStyle} value={fromF} onChange={e=>setFromF(e.target.value)} title="From date" />
        <input type="date" style={selStyle} value={toF} onChange={e=>setToF(e.target.value)} title="To date" />
        {(search||roomF||typeF||modeF||fromF||toF) && (
          <button className="btn btn-secondary btn-xs" onClick={()=>{setSearch('');setRoomF('');setTypeF('');setModeF('');setFromF('');setToF('');}}>✕ Clear</button>
        )}
      </div>

      <div className="card">
        {loading ? <div style={{textAlign:'center',padding:32,color:'var(--text3)'}}>⏳ Loading...</div> : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#</th><th>Bill No.</th><th>Date</th><th>Room</th><th>Members</th><th>Type</th><th>Total</th><th>Paid</th><th>Balance</th><th>Mode</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {receipts.length === 0 ? (
                    <tr><td colSpan={11}><div className="empty-state"><div className="empty-icon">🧾</div><p>No receipts found</p></div></td></tr>
                  ) : receipts.map((r,i)=>(
                    <tr key={r._id}>
                      <td style={{color:'var(--text3)',fontSize:'0.75rem'}}>#{r.receiptNumber||i+1}</td>
                      <td style={{fontFamily:'monospace',fontSize:'0.75rem',color:'var(--accent)'}}>{r.billNumber||'—'}</td>
                      <td style={{fontSize:'0.8rem'}}>{r.receiptDate?new Date(r.receiptDate).toLocaleDateString('en-IN'):'—'}</td>
                      <td><span className="badge badge-blue">R{r.roomNumber}</span></td>
                      <td style={{fontSize:'0.78rem',color:'var(--text2)',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={r.memberName}>{r.memberName||'—'}</td>
                      <td><span className="badge badge-yellow" style={{fontSize:'0.68rem'}}>{PKG[r.packageName]||r.packageName}</span></td>
                      <td style={{fontWeight:600}}>₹{(r.totalAmount||0).toLocaleString('en-IN')}</td>
                      <td style={{color:'var(--success)',fontWeight:600}}>₹{(r.amountPaid||r.totalAmount||0).toLocaleString('en-IN')}</td>
                      <td style={{color:(r.balanceDue||0)>0?'var(--danger)':'var(--text3)',fontWeight:(r.balanceDue||0)>0?700:400,fontSize:'0.8rem'}}>
                        {(r.balanceDue||0)>0?`₹${r.balanceDue.toLocaleString('en-IN')}`:'—'}
                      </td>
                      <td><span className={`badge ${r.modeOfPayment==='online'?'badge-blue':'badge-green'}`} style={{fontSize:'0.68rem'}}>{r.modeOfPayment||'cash'}</span></td>
                      <td>
                        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                          <button className="btn btn-success btn-xs" onClick={()=>setShowPrint(r)}>🖨</button>
                          {(r.memberMobile||roomMembers[0]?.mobileNo) && (
                            <button className="btn btn-xs" style={{background:'#25d366',color:'white',border:'none'}}
                              onClick={()=>whatsapp.sendReceipt(r.memberMobile||'',r)} title="WhatsApp">📱</button>
                          )}
                          {r.isPartPayment && (r.balanceDue||0) > 0 && (
                            <button className="btn btn-xs"
                              style={{background:'#f39c12',color:'white',border:'none',fontWeight:700,whiteSpace:'nowrap'}}
                              onClick={()=>{ setDueModal(r); setDueForm({ modeOfPayment:'cash', receiptDate: new Date().toISOString().split('T')[0], notes:'' }); }}
                              title="Generate due clearance receipt">
                              ⚠️ Due
                            </button>
                          )}
                          <button className="btn btn-danger btn-xs" onClick={()=>del(r._id)}>Del</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages>1&&(
              <div style={{display:'flex',gap:6,justifyContent:'center',marginTop:14,alignItems:'center'}}>
                <button className="btn btn-secondary btn-xs" disabled={page===1} onClick={()=>loadReceipts(page-1)}>← Prev</button>
                <span style={{fontSize:'0.8rem',color:'var(--text3)'}}>Page {page} of {pages} · {total} receipts</span>
                <button className="btn btn-secondary btn-xs" disabled={page===pages} onClick={()=>loadReceipts(page+1)}>Next →</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── New Receipt Modal ─────────────────────────────────────────────── */}
      {showModal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal" style={{maxWidth:600}}>
            <div className="modal-header"><h3>Generate Room Receipt</h3><button className="close-btn" onClick={()=>setShowModal(false)}>✕</button></div>
            <div className="modal-body">
              <div className="form-grid">

                {/* Date + Receipt# + Bill# */}
                <div className="form-group"><label>Date</label><input type="date" value={form.receiptDate} onChange={e=>setForm(p=>({...p,receiptDate:e.target.value}))} /></div>
                <div className="form-group"><label>Receipt #</label><input type="number" value={form.receiptNumber} onChange={e=>setForm(p=>({...p,receiptNumber:e.target.value}))} /></div>
                <div className="form-group full"><label>Bill Number</label><input value={form.billNumber} onChange={e=>setForm(p=>({...p,billNumber:e.target.value}))} placeholder="SB/26-27/001" /></div>

                {/* Room selector */}
                <div className="form-group full">
                  <label>Select Room</label>
                  <select value={form.roomNumber} onChange={e=>handleRoomChange(e.target.value)}>
                    <option value="">— Select Room —</option>
                    {uniqueRooms.map(n=><option key={n} value={n}>Room {n} {members.filter(m=>String(m.roomNumber)===String(n)&&m.isActive!==false).length > 0 ? `(${members.filter(m=>String(m.roomNumber)===String(n)&&m.isActive!==false).length} members)` : '(vacant)'}</option>)}
                  </select>
                  {roomConfig && (
                    <div style={{marginTop:6,padding:'6px 10px',background:'rgba(240,165,0,0.07)',borderRadius:5,fontSize:'0.78rem',color:'var(--text2)',display:'flex',gap:14,flexWrap:'wrap'}}>
                      <span>🏷️ Fixed Rent: <strong style={{color:'var(--accent)'}}>₹{(roomConfig.rent||0).toLocaleString('en-IN')}</strong></span>
                      <span>💵 Advance: <strong style={{color:'var(--info)'}}>₹{(roomConfig.advance||0).toLocaleString('en-IN')}</strong></span>
                      <span>👥 Members: <strong>{roomMembers.length}</strong></span>
                    </div>
                  )}
                </div>

                {/* Member mode selector — only if room selected */}
                {form.roomNumber && roomMembers.length > 0 && (
                  <div className="form-group full">
                    <label>Receipt For</label>
                    <div style={{display:'flex',gap:0,border:'1px solid var(--border)',borderRadius:6,overflow:'hidden',width:'fit-content'}}>
                      <button type="button"
                        style={{padding:'8px 20px',background:form.memberMode==='all'?'var(--accent)':'var(--bg3)',color:form.memberMode==='all'?'#111':'var(--text2)',border:'none',cursor:'pointer',fontFamily:'Rajdhani',fontWeight:700,fontSize:'0.9rem'}}
                        onClick={()=>handleMemberMode('all')}>
                        All Members ({roomMembers.length})
                      </button>
                      <button type="button"
                        style={{padding:'8px 20px',background:form.memberMode==='single'?'var(--accent)':'var(--bg3)',color:form.memberMode==='single'?'#111':'var(--text2)',border:'none',cursor:'pointer',fontFamily:'Rajdhani',fontWeight:700,fontSize:'0.9rem',borderLeft:'1px solid var(--border)'}}
                        onClick={()=>handleMemberMode('single')}>
                        Single Member
                      </button>
                    </div>

                    {/* Show all members list when mode = all */}
                    {form.memberMode === 'all' && (
                      <div style={{marginTop:8,background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'10px 12px'}}>
                        {roomMembers.map((m,i)=>(
                          <div key={m._id} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:'0.83rem',borderBottom:i<roomMembers.length-1?'1px dashed var(--border)':'none'}}>
                            <span style={{color:'var(--text)',fontWeight:500}}>👤 {m.name}</span>
                            <span style={{color:'var(--text3)'}}>📱 {m.mobileNo}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Single member selector */}
                    {form.memberMode === 'single' && (
                      <select style={{marginTop:8,width:'100%',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'9px 12px',color:'var(--text)',outline:'none'}}
                        value={form.memberName} onChange={e=>handleSingleMember(e.target.value)}>
                        <option value="">— Select Member —</option>
                        {roomMembers.map(m=><option key={m._id} value={m.name}>{m.name} · {m.mobileNo}</option>)}
                      </select>
                    )}
                  </div>
                )}

                {/* Billing month */}
                <div className="form-group">
                  <label>Billing Month <span style={{fontSize:'0.68rem',color:'var(--text3)',fontWeight:400,textTransform:'none'}}>— for electric lookup</span></label>
                  <select value={form.billingMonth} onChange={e=>setForm(p=>({...p,billingMonth:e.target.value}))}>
                    <option value="">— Select Month —</option>
                    {billingMonthOptions.map(o=><option key={o.val} value={o.val}>{o.label}</option>)}
                  </select>
                </div>

                {/* Package */}
                <div className="form-group">
                  <label>Package Type</label>
                  <select value={form.packageName} onChange={e=>handlePackageChange(e.target.value)}>
                    {Object.entries(PKG).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                  </select>
                </div>

                {/* Mode */}
                <div className="form-group">
                  <label>Payment Mode</label>
                  <select value={form.modeOfPayment} onChange={e=>setForm(p=>({...p,modeOfPayment:e.target.value}))}>
                    <option value="cash">Cash / नगद</option>
                    <option value="online">Online / ऑनलाइन</option>
                  </select>
                </div>

                {/* From / To */}
                <div className="form-group"><label>From Period</label><input type="date" value={form.fromDate} onChange={e=>setForm(p=>({...p,fromDate:e.target.value}))} /></div>
                <div className="form-group">
                  <label>To Period <span style={{fontSize:'0.68rem',color:'var(--success)',fontWeight:400,textTransform:'none'}}>— updates member due date</span></label>
                  <input type="date" value={form.toDate} onChange={e=>setForm(p=>({...p,toDate:e.target.value}))} />
                </div>

                {/* Amount */}
                <div className="form-group">
                  <label>Total Amount (₹)</label>
                  <input type="number" value={form.totalAmount}
                    onChange={e=>setForm(p=>({...p, totalAmount:e.target.value, amountPaid:p.isPartPayment?p.amountPaid:e.target.value}))}
                    placeholder="Auto-filled from room config" />
                </div>

                {/* Part payment */}
                <div className="form-group">
                  <label>Part Payment?</label>
                  <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0'}}>
                    <input type="checkbox" checked={form.isPartPayment} onChange={e=>handlePartPayment(e.target.checked)} id="partPay" style={{width:18,height:18,accentColor:'var(--accent)',cursor:'pointer'}} />
                    <label htmlFor="partPay" style={{textTransform:'none',color:'var(--text)',fontSize:'0.88rem',cursor:'pointer',fontWeight:400}}>Member paying partial amount</label>
                  </div>
                </div>

                {form.isPartPayment && (
                  <>
                    <div className="form-group">
                      <label>Amount Paid Now (₹)</label>
                      <input type="number" value={form.amountPaid} onChange={e=>handleAmountPaidChange(e.target.value)} placeholder="Amount received today" />
                    </div>
                    <div className="form-group">
                      <label>Balance Due (₹)</label>
                      <div style={{padding:'10px 12px',background:'var(--bg3)',border:'1px solid rgba(231,76,60,0.4)',borderRadius:6,fontFamily:'Rajdhani',fontSize:'1.2rem',fontWeight:700,color:parseFloat(form.balanceDue)>0?'var(--danger)':'var(--success)'}}>
                        ₹{(parseFloat(form.balanceDue)||0).toLocaleString('en-IN')}
                      </div>
                    </div>
                  </>
                )}

                {/* Amount in words */}
                <div className="form-group full">
                  <label>Amount in Words</label>
                  <input value={(form.isPartPayment?form.amountPaid:form.totalAmount)?numberToWords(parseFloat(form.isPartPayment?form.amountPaid:form.totalAmount)||0)+' Rupees Only':''} readOnly style={{background:'var(--bg)',cursor:'default',fontSize:'0.8rem'}} />
                </div>

                <div className="form-group full">
                  <label>Notes</label>
                  <input value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} placeholder="Auto-filled for electric and final types" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Generate Receipt</button>
            </div>
          </div>
        </div>
      )}

      {/* Print Modal */}
      {showPrint && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowPrint(null)}>
          <div className="modal" style={{maxWidth:560}}>
            <div className="modal-header">
              <h3>Receipt — {showPrint.billNumber}</h3>
              <button className="close-btn" onClick={()=>setShowPrint(null)}>✕</button>
            </div>
            <div className="modal-body" style={{background:'white'}}>
              <div ref={printRef}><ReceiptPrint receipt={showPrint} /></div>
            </div>
            <div className="modal-footer" style={{flexWrap:'wrap',gap:8}}>
              <button className="btn btn-secondary" onClick={()=>setShowPrint(null)}>Close</button>
              <button className="btn btn-primary" onClick={doPrint}>🖨 Print / PDF</button>
              {showPrint?.memberMobile && (
                <button style={{background:'#25d366',color:'white',border:'none',padding:'9px 16px',borderRadius:7,cursor:'pointer',fontWeight:700,fontSize:'0.88rem',fontFamily:'Rajdhani'}}
                  onClick={()=>whatsapp.sendReceipt(showPrint.memberMobile,showPrint)}>📱 WhatsApp</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Due Receipt Modal ──────────────────────────────────────────────── */}
      {dueModal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setDueModal(null)}>
          <div className="modal" style={{maxWidth:460}}>
            <div className="modal-header">
              <h3>⚠️ Generate Due Receipt</h3>
              <button className="close-btn" onClick={()=>setDueModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{background:'rgba(243,156,18,0.08)',border:'1px solid rgba(243,156,18,0.4)',borderRadius:6,padding:'12px 14px',marginBottom:16,fontSize:'0.88rem'}}>
                <strong>{dueModal.memberName}</strong> · Room {dueModal.roomNumber}<br/>
                <span style={{color:'var(--text2)',fontSize:'0.8rem'}}>Original Bill: <strong>{dueModal.billNumber}</strong></span><br/>
                <div style={{marginTop:8,display:'flex',justifyContent:'space-between'}}>
                  <span>Total Bill: ₹{(dueModal.totalAmount||0).toLocaleString('en-IN')}</span>
                  <span>Already Paid: ₹{(dueModal.amountPaid||0).toLocaleString('en-IN')}</span>
                </div>
                <div style={{marginTop:6,fontFamily:'Rajdhani',fontSize:'1.2rem',fontWeight:700,color:'#c0392b'}}>
                  Balance Due: ₹{(dueModal.balanceDue||0).toLocaleString('en-IN')}
                </div>
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label>Payment Mode</label>
                  <select value={dueForm.modeOfPayment} onChange={e=>setDueForm(p=>({...p,modeOfPayment:e.target.value}))}>
                    <option value="cash">Cash / नगद</option>
                    <option value="online">Online / ऑनलाइन</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Receipt Date</label>
                  <input type="date" value={dueForm.receiptDate} onChange={e=>setDueForm(p=>({...p,receiptDate:e.target.value}))} />
                </div>
                <div className="form-group full">
                  <label>Notes (optional)</label>
                  <input value={dueForm.notes} onChange={e=>setDueForm(p=>({...p,notes:e.target.value}))} placeholder={`Due clearance against ${dueModal.billNumber}`} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setDueModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveDueReceipt}
                style={{background:'#e67e22',border:'1px solid #d35400'}}>
                Generate Due Receipt — ₹{(dueModal.balanceDue||0).toLocaleString('en-IN')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReceiptPrint({ receipt }) {
  const fmt = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}) : '—';
  const paidAmt  = receipt.isPartPayment ? (receipt.amountPaid||0) : (receipt.totalAmount||0);
  const words    = receipt.amountInWords || (numberToWords(paidAmt)+' Rupees Only');
  const isPartPay= receipt.isPartPayment && (receipt.balanceDue||0) > 0;
  const PKGl     = { rent:'Rent / किराया', advance:'Advance / एडवांस', electric:'Electric / बिजली', final:'Final Bill / अंतिम', other:'Other / अन्य' };
  const membersList = receipt.members?.length > 0
    ? receipt.members.map(m=>m.name).join(', ')
    : receipt.memberName || '—';

  return (
    <div style={{fontFamily:'"Noto Sans",sans-serif',background:'white',color:'#111',padding:'28px',fontSize:'13px'}}>
      <div style={{textAlign:'center',borderBottom:'2px solid #111',paddingBottom:12,marginBottom:16}}>
        <div style={{fontSize:'1.5rem',fontWeight:700,letterSpacing:1}}>HOSTEL MANAGER</div>
        <div style={{fontSize:'0.75rem',color:'#555',letterSpacing:'0.1em',textTransform:'uppercase'}}>
          {isPartPay ? 'Part Payment Receipt' : 'Payment Receipt / भुगतान रसीद'}
        </div>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
        <div><span style={{color:'#555'}}>Date: </span><strong>{fmt(receipt.receiptDate)}</strong></div>
        <div><span style={{color:'#555'}}>Receipt #</span><strong>{receipt.receiptNumber}</strong></div>
      </div>
      <div style={{marginBottom:12}}><span style={{color:'#555'}}>Bill No.: </span><strong style={{fontSize:'1rem',color:'#c00'}}>{receipt.billNumber||'—'}</strong></div>
      {[
        ['Members / सदस्य', membersList],
        ['Room / कमरा', receipt.roomNumber ? `Room ${receipt.roomNumber}` : '—'],
        ['Package / पैकेज', PKGl[receipt.packageName]||receipt.packageName],
        ['From / दिनांक से', fmt(receipt.fromDate)],
        ['To / दिनांक तक', fmt(receipt.toDate)],
        ['Mode / भुगतान', receipt.modeOfPayment==='online'?'Online / ऑनलाइन':'Cash / नगद'],
      ].map(([l,v],i)=>(
        <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px dashed #ddd'}}>
          <span style={{color:'#555'}}>{l}</span><span style={{fontWeight:500}}>{v}</span>
        </div>
      ))}
      {isPartPay && (
        <div style={{margin:'12px 0',padding:'10px',background:'#fff8e1',border:'1px solid #f39c12',borderRadius:4}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{color:'#555'}}>Total Bill</span><span style={{fontWeight:600}}>₹{(receipt.totalAmount||0).toLocaleString('en-IN')}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{color:'#555'}}>Paid Today</span><span style={{fontWeight:700,color:'#27ae60'}}>₹{paidAmt.toLocaleString('en-IN')}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid #f39c12',paddingTop:6,marginTop:4}}><span style={{color:'#c00',fontWeight:700}}>Balance Due</span><span style={{fontWeight:700,color:'#c00'}}>₹{(receipt.balanceDue||0).toLocaleString('en-IN')}</span></div>
        </div>
      )}
      <div style={{margin:'14px 0',padding:'10px',background:'#f9f9f9',border:'1px solid #ddd',borderRadius:4}}>
        <div style={{fontSize:'11px',color:'#777',textTransform:'uppercase',letterSpacing:1,marginBottom:3}}>Sum of Rupees Paid / भुगतान राशि शब्दों में</div>
        <div style={{fontSize:'1rem',fontWeight:600,color:'#222'}}>{words}</div>
      </div>
      <div style={{textAlign:'center',padding:'14px',background:'#111',color:'white',borderRadius:6,margin:'10px 0'}}>
        <div style={{fontSize:'11px',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:3,opacity:0.7}}>AMOUNT PAID</div>
        <div style={{fontSize:'2rem',fontWeight:900}}>₹{paidAmt.toLocaleString('en-IN')}</div>
        {isPartPay && <div style={{fontSize:'0.75rem',opacity:0.7,marginTop:3}}>Part Payment · Balance: ₹{(receipt.balanceDue||0).toLocaleString('en-IN')}</div>}
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',marginTop:28}}>
        <div style={{width:180,textAlign:'center'}}>
          <div style={{borderTop:'1px solid #333',paddingTop:6,fontSize:'12px',color:'#555'}}>हस्ताक्षर / Signature</div>
        </div>
      </div>
      {receipt.notes && <div style={{marginTop:10,fontSize:'11px',color:'#777'}}>Note: {receipt.notes}</div>}
    </div>
  );
}
