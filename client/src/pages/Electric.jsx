import { useHostel } from '../context/HostelContext';
import React, { useEffect, useState } from 'react';
import { electricAPI, receiptsAPI } from '../utils/api';
import { useToast } from '../context/ToastContext';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Payment status badge
const StatusBadge = ({ status, waivedReason }) => {
  if (status === 'paid')   return <span style={{background:'rgba(46,204,113,0.15)',color:'#27ae60',padding:'2px 9px',borderRadius:10,fontSize:'0.72rem',fontWeight:700}}>✅ Paid</span>;
  if (status === 'partial')return <span style={{background:'rgba(243,156,18,0.15)',color:'#f39c12',padding:'2px 9px',borderRadius:10,fontSize:'0.72rem',fontWeight:700}}>◐ Part Paid</span>;
  if (status === 'waived') return (
    <span title={`Waived: ${waivedReason}`} style={{background:'rgba(155,89,182,0.15)',color:'#8e44ad',padding:'2px 9px',borderRadius:10,fontSize:'0.72rem',fontWeight:700,cursor:'help'}}>
      🚫 Waived
    </span>
  );
  return <span style={{background:'rgba(231,76,60,0.13)',color:'#c0392b',padding:'2px 9px',borderRadius:10,fontSize:'0.72rem',fontWeight:700}}>⏳ Unpaid</span>;
};

export default function Electric() {
  const { hostelSwitchCount } = useHostel();
  const [readings,     setReadings]     = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(1);
  const [showModal,    setShowModal]    = useState(false);
  const [lastReading,  setLastReading]  = useState(null);
  const [form,         setForm]         = useState({ month:'', year:'', startReading:'', endReading:'', ratePerUnit:8 });
  const [prediction,   setPrediction]   = useState(null);

  // Waive modal state
  const [waiveTarget,  setWaiveTarget]  = useState(null); // the reading being acted on
  const [waiveMode,    setWaiveMode]    = useState('');   // 'waive' | 'confirm_paid' | 'confirm_unpaid'
  const [waiveReason,  setWaiveReason]  = useState('');
  const [waiveSaving,  setWaiveSaving]  = useState(false);
  const [receipts,     setReceipts]     = useState([]);

  const toast = useToast();

  const load = () => electricAPI.getByRoom(selectedRoom).then(r => setReadings(r.data?.data || r.data || []));

  useEffect(() => {
    load();
    electricAPI.predict?.(selectedRoom).then(r => setPrediction(r.data)).catch(() => setPrediction(null));
    receiptsAPI.getByRoom(selectedRoom).then(r => setReceipts(Array.isArray(r.data) ? r.data : (r.data?.data || []))).catch(() => setReceipts([]));
  }, [selectedRoom, hostelSwitchCount]);

  // How much has actually been paid toward a given month's electric bill —
  // via a direct 'electric' receipt, or the electric portion of a 'final' bill.
  const getPaidForReading = (reading) => {
    if (reading.paymentStatus === 'waived') return 0;
    // Match by the receipt's actual billing month (monthYear, e.g. "2026-07")
    // rather than the day it was created — a bill settled a few days late,
    // crossing into the next calendar month, should still count. Older
    // receipts made before monthYear was captured fall back to receiptDate.
    const readingMonthYear = `${reading.year}-${String(reading.month).padStart(2, '0')}`;
    const isForThisReading = (rec) => rec.monthYear
      ? rec.monthYear === readingMonthYear
      : (rec.receiptDate && new Date(rec.receiptDate).getMonth() + 1 === reading.month && new Date(rec.receiptDate).getFullYear() === reading.year);
    const direct = receipts
      .filter(rec => (rec.packageName === 'electric' || rec.paymentType === 'electric') && isForThisReading(rec))
      .reduce((s, rec) => s + (rec.amountPaid ?? rec.totalAmount ?? 0), 0);
    const inFinal = receipts
      .filter(rec => (rec.packageName === 'final' || rec.paymentType === 'final') && isForThisReading(rec))
      .reduce((s, rec) => {
        if (!(rec.electricAmount > 0)) return s;
        const paid = rec.amountPaid ?? rec.totalAmount ?? 0;
        const ratio = rec.totalAmount > 0 ? paid / rec.totalAmount : 1;
        return s + (rec.electricAmount * ratio);
      }, 0);
    return direct + inFinal;
  };

  // Effective status is derived automatically from receipts — 'waived' is the
  // only manual override (set from here or from Dues & Payments).
  const getEffectiveStatus = (reading) => {
    if (reading.paymentStatus === 'waived') return 'waived';
    const paid = getPaidForReading(reading);
    const total = reading.totalAmount || 0;
    if (total > 0 && paid >= total) return 'paid';
    if (paid > 0) return 'partial';
    return 'unpaid';
  };

  const openModal = async () => {
    const now = new Date();
    let m = now.getMonth() + 1;
    let y = now.getFullYear();
    try {
      const res = await electricAPI.getLastByRoom(selectedRoom);
      setLastReading(res.data);
      setForm({ month: m, year: y, startReading: res.data ? res.data.endReading : '', endReading: '', ratePerUnit: res.data ? res.data.ratePerUnit : 8 });
    } catch {
      setLastReading(null);
      setForm({ month: m, year: y, startReading: '', endReading: '', ratePerUnit: 8 });
    }
    setShowModal(true);
  };

  const save = async () => {
    if (!form.startReading || !form.endReading) { toast('Enter both readings', 'error'); return; }
    if (Number(form.endReading) < Number(form.startReading)) { toast('End reading must be ≥ start reading', 'error'); return; }
    try {
      await electricAPI.create({ roomNumber: selectedRoom, ...form });
      toast('Reading saved'); setShowModal(false); load();
    } catch(e) { toast(e.response?.data?.message || 'Error saving', 'error'); }
  };

  const del = async (id) => {
    if (!window.confirm('Delete this reading?')) return;
    await electricAPI.delete(id); toast('Deleted'); load();
  };

  // Open waive/paid modal for a specific reading
  const openWaiveModal = (reading, mode) => {
    setWaiveTarget(reading);
    setWaiveMode(mode);
    setWaiveReason('');
    setWaiveSaving(false);
  };

  const closeWaiveModal = () => { setWaiveTarget(null); setWaiveMode(''); setWaiveReason(''); };

  const savePaymentStatus = async () => {
    if (!waiveTarget) return;
    if (waiveMode === 'waive' && !waiveReason.trim()) { toast('Please enter a reason before waiving', 'error'); return; }
    setWaiveSaving(true);
    try {
      const payload = waiveMode === 'waive'
        ? { paymentStatus: 'waived', waivedReason: waiveReason.trim() }
        : { paymentStatus: 'unpaid', waivedReason: '' }; // restore — status then re-derives automatically from receipts

      await electricAPI.updatePaymentStatus(waiveTarget._id, payload);
      toast(waiveMode === 'waive' ? 'Bill waived — removed from dues' : 'Restored — status now follows receipts automatically');
      closeWaiveModal();
      load();
    } catch(e) {
      toast(e.response?.data?.message || 'Error updating', 'error');
    } finally { setWaiveSaving(false); }
  };

  const units = form.endReading && form.startReading ? Number(form.endReading) - Number(form.startReading) : 0;
  const total = units * (form.ratePerUnit || 8);

  // Summary stats — exclude waived from total; status is auto-derived from receipts
  const activeReadings = readings.filter(r => r.paymentStatus !== 'waived');
  const unpaidReadings = readings.filter(r => getEffectiveStatus(r) === 'unpaid' || getEffectiveStatus(r) === 'partial');
  const totalUnpaid    = unpaidReadings.reduce((s, r) => s + Math.max(0, (r.totalAmount || 0) - getPaidForReading(r)), 0);

  return (
    <div>
      <div className="page-header">
        <div><h2>Electric Readings</h2><p>Track monthly electricity consumption per room</p></div>
      </div>

      <div className="card" style={{marginBottom:20}}>
        <div className="elec-room-select">
          <label style={{color:'var(--text2)',fontSize:'0.85rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>Select Room:</label>
          <select
            style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 14px',color:'var(--text)',outline:'none',fontSize:'0.9rem'}}
            value={selectedRoom} onChange={e => setSelectedRoom(Number(e.target.value))}
          >
            {Array.from({length:20},(_,i)=>i+1).map(n => <option key={n} value={n}>Room {n}</option>)}
          </select>
          <button className="btn btn-primary" onClick={openModal}>+ Add Reading</button>
        </div>

        {readings.length > 0 && (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginTop:4}}>
            {[
              { label:'Total Readings',    value: readings.length },
              { label:'Last Reading',      value: readings[0]?.endReading ?? '—' },
              { label:'Last Month Units',  value: readings[0]?.unitsConsumed ?? '—' },
              { label:'Last Bill',         value: readings[0] ? `₹${readings[0].totalAmount}` : '—' },
              { label:'Unpaid Bills',      value: unpaidReadings.length > 0 ? `${unpaidReadings.length} (₹${totalUnpaid.toLocaleString('en-IN')})` : '✅ All clear', color: unpaidReadings.length > 0 ? 'var(--danger)' : 'var(--success)' },
            ].map((s,i) => (
              <div key={i} style={{background:'var(--bg3)',borderRadius:8,padding:'14px',border: s.color === 'var(--danger)' ? '1px solid rgba(231,76,60,0.35)' : '1px solid var(--border)'}}>
                <div style={{fontSize:'0.72rem',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>{s.label}</div>
                <div style={{fontSize:'1.2rem',fontFamily:'Rajdhani',fontWeight:700,color:s.color||'var(--accent)'}}>{s.value}</div>
              </div>
            ))}
            {prediction?.predictedAmount != null && (
              <div style={{background:'var(--bg3)',borderRadius:8,padding:'14px',border:'1px solid rgba(52,152,219,0.35)'}}>
                <div style={{fontSize:'0.72rem',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>Predicted Next Bill</div>
                <div style={{fontSize:'1.2rem',fontFamily:'Rajdhani',fontWeight:700,color:'var(--info)'}}>₹{prediction.predictedAmount}</div>
                <div style={{fontSize:'0.68rem',color:'var(--text3)',marginTop:3}}>{prediction.predictedUnits} units · {prediction.confidence} confidence</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{fontFamily:'Rajdhani',marginBottom:4}}>Room {selectedRoom} — Reading History</h3>
        <p style={{fontSize:'0.78rem',color:'var(--text3)',marginBottom:16}}>
          Paid / Unpaid is worked out automatically from receipts you create. Use <strong>Waive</strong> to write off a bill without counting it as income (reason required).
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month / Year</th>
                <th>Start</th>
                <th>End</th>
                <th>Units Used</th>
                <th>Rate/Unit</th>
                <th>Bill Amount</th>
                <th>Payment Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {readings.length === 0 ? (
                <tr><td colSpan={8}><div className="empty-state"><div className="empty-icon">⚡</div><p>No readings for Room {selectedRoom}</p></div></td></tr>
              ) : readings.map((r, i) => {
                const effStatus = getEffectiveStatus(r);
                return (
                <tr key={r._id} style={effStatus === 'waived' ? {opacity:0.6} : {}}>
                  <td style={{fontWeight:500,color:'var(--text)'}}>
                    {MONTHS[r.month-1]} {r.year}
                    {i === 0 && <span className="badge badge-green" style={{marginLeft:6,fontSize:'0.65rem'}}>Latest</span>}
                  </td>
                  <td>{r.startReading}</td>
                  <td>{r.endReading}</td>
                  <td style={{color:'var(--info)',fontWeight:600}}>
                    {r.unitsConsumed} units
                    {r.isAnomaly && (
                      <span title="Unusually high — verify meter"
                        style={{marginLeft:6,background:'rgba(231,76,60,0.15)',color:'var(--danger)',padding:'1px 7px',borderRadius:10,fontSize:'0.7rem',fontWeight:700,cursor:'help'}}>
                        🚨 High
                      </span>
                    )}
                  </td>
                  <td>₹{r.ratePerUnit}/unit</td>
                  <td style={{
                    color: effStatus === 'waived' ? 'var(--text3)' : effStatus === 'paid' ? 'var(--success)' : 'var(--danger)',
                    fontWeight:700,
                    fontSize:'1rem',
                    textDecoration: effStatus === 'waived' ? 'line-through' : 'none'
                  }}>
                    ₹{r.totalAmount}
                  </td>
                  <td>
                    <StatusBadge status={effStatus} waivedReason={r.waivedReason} />
                    {effStatus === 'waived' && r.waivedReason && (
                      <div style={{fontSize:'0.68rem',color:'var(--text3)',marginTop:3,maxWidth:140}}>"{r.waivedReason}"</div>
                    )}
                    {effStatus === 'partial' && (
                      <div style={{fontSize:'0.68rem',color:'var(--text3)',marginTop:3}}>₹{getPaidForReading(r).toLocaleString('en-IN')} of ₹{r.totalAmount}</div>
                    )}
                  </td>
                  <td>
                    <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                      {effStatus !== 'waived' && (
                        <button
                          className="btn btn-xs"
                          style={{background:'rgba(155,89,182,0.12)',color:'#8e44ad',border:'1px solid rgba(155,89,182,0.3)',fontSize:'0.72rem'}}
                          onClick={() => openWaiveModal(r, 'waive')}
                        >🚫 Waive</button>
                      )}
                      {effStatus === 'waived' && (
                        <button
                          className="btn btn-xs btn-secondary"
                          style={{fontSize:'0.72rem'}}
                          onClick={() => openWaiveModal(r, 'restore')}
                        >↩ Restore</button>
                      )}
                      <button className="btn btn-danger btn-xs" onClick={() => del(r._id)} style={{fontSize:'0.72rem'}}>🗑</button>
                    </div>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Add Reading Modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{maxWidth:460}}>
            <div className="modal-header">
              <h3>Add Electric Reading — Room {selectedRoom}</h3>
              <button className="close-btn" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {lastReading && (
                <div style={{background:'rgba(52,152,219,0.08)',border:'1px solid rgba(52,152,219,0.2)',borderRadius:6,padding:'10px 14px',marginBottom:16,fontSize:'0.85rem',color:'var(--info)'}}>
                  ℹ️ Previous month end reading: <strong>{lastReading.endReading}</strong> (auto-filled as start reading)
                </div>
              )}
              <div className="form-grid">
                <div className="form-group">
                  <label>Month</label>
                  <select value={form.month} onChange={e => setForm(p=>({...p,month:e.target.value}))}>
                    {MONTHS.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Year</label>
                  <input type="number" value={form.year} onChange={e => setForm(p=>({...p,year:e.target.value}))} />
                </div>
                <div className="form-group">
                  <label>Start Reading (units)</label>
                  <input type="number" value={form.startReading} onChange={e => setForm(p=>({...p,startReading:e.target.value}))} placeholder="e.g. 1200" />
                </div>
                <div className="form-group">
                  <label>End Reading (units)</label>
                  <input type="number" value={form.endReading} onChange={e => setForm(p=>({...p,endReading:e.target.value}))} placeholder="e.g. 1350" />
                </div>
                <div className="form-group">
                  <label>Rate per Unit (₹)</label>
                  <input type="number" value={form.ratePerUnit} onChange={e => setForm(p=>({...p,ratePerUnit:e.target.value}))} />
                </div>
                <div className="form-group" style={{justifyContent:'flex-end'}}>
                  <label>Calculated Bill</label>
                  <div style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'10px 12px',color:'var(--accent)',fontFamily:'Rajdhani',fontSize:'1.2rem',fontWeight:700}}>
                    {units > 0 ? `${units} units = ₹${total}` : '—'}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save Reading</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Waive / Paid / Unpaid Confirmation Modal ── */}
      {waiveTarget && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && closeWaiveModal()}>
          <div className="modal" style={{maxWidth:420}}>
            <div className="modal-header">
              <h3>
                {waiveMode === 'waive' ? '🚫 Waive Electric Bill' : '↩ Restore Bill'}
              </h3>
              <button className="close-btn" onClick={closeWaiveModal}>✕</button>
            </div>
            <div className="modal-body">
              {/* Bill summary */}
              <div style={{background:'var(--bg3)',borderRadius:8,padding:'12px 16px',marginBottom:16,fontSize:'0.85rem'}}>
                <div style={{color:'var(--text3)',marginBottom:4}}>Room {waiveTarget.roomNumber} · {MONTHS[waiveTarget.month-1]} {waiveTarget.year}</div>
                <div style={{color:'var(--accent)',fontFamily:'Rajdhani',fontSize:'1.4rem',fontWeight:700}}>₹{waiveTarget.totalAmount}</div>
                <div style={{color:'var(--text3)',fontSize:'0.78rem'}}>{waiveTarget.unitsConsumed} units × ₹{waiveTarget.ratePerUnit}/unit</div>
              </div>

              {waiveMode === 'waive' && (
                <>
                  <div style={{background:'rgba(155,89,182,0.08)',border:'1px solid rgba(155,89,182,0.25)',borderRadius:6,padding:'10px 14px',marginBottom:14,fontSize:'0.82rem',color:'var(--text2)'}}>
                    Waiving removes this bill from <strong>Dues &amp; Payments</strong> and <strong>does not count it as income</strong>. Use this when a member won't pay and you're writing it off.
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
                </>
              )}

              {waiveMode === 'restore' && (
                <div style={{background:'rgba(231,76,60,0.07)',border:'1px solid rgba(231,76,60,0.25)',borderRadius:6,padding:'10px 14px',fontSize:'0.82rem',color:'var(--text2)'}}>
                  This removes the waiver. The bill's status will then be worked out automatically from receipts — <strong>Paid</strong> if fully covered, <strong>Unpaid</strong> otherwise.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeWaiveModal} disabled={waiveSaving}>Cancel</button>
              <button
                className="btn btn-primary"
                style={waiveMode === 'waive' ? {background:'#8e44ad',borderColor:'#8e44ad'} : {}}
                onClick={savePaymentStatus}
                disabled={waiveSaving || (waiveMode === 'waive' && !waiveReason.trim())}
              >
                {waiveSaving ? '⏳ Saving…'
                : waiveMode === 'waive' ? '🚫 Confirm Waive'
                :                         '↩ Confirm Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}