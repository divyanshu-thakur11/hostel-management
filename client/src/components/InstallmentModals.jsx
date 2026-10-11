import React, { useEffect, useRef, useState } from 'react';
import { receiptsAPI } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { METHODS } from '../utils/dues';
import { numberToWords } from './ReceiptPrint';

const inr = (n) => `₹${(n||0).toLocaleString('en-IN')}`;
const today = () => new Date().toISOString().split('T')[0];
const newRequestId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// ── Record another payment against an unpaid / part-paid bill ────────────────
// `bill` is the original (root) receipt. Any amount up to the outstanding
// balance, any method; repeat until the balance reaches zero.
export function AddPaymentModal({ bill, onClose, onDone }) {
  const toast = useToast();
  const balance = bill.balanceDue || 0;
  const [f, setF] = useState({ amount: String(balance), paymentMethod: 'cash', referenceNo: '', receiptDate: today(), notes: '' });
  const [saving, setSaving] = useState(false);
  const reqId = useRef(newRequestId());           // same id on retries → never a duplicate payment
  const amt = parseFloat(f.amount) || 0;
  const left = Math.max(0, balance - amt);
  const isOnline = f.paymentMethod !== 'cash';

  const submit = async () => {
    if (!(amt > 0)) { toast('Enter an amount', 'error'); return; }
    if (amt > balance) { toast(`Amount is more than the outstanding ${inr(balance)}`, 'error'); return; }
    setSaving(true);
    try {
      const res = await receiptsAPI.addInstallment(bill._id, {
        ...f, amount: amt, clientRequestId: reqId.current,
        amountInWords: numberToWords(amt) + ' Rupees Only',
      });
      const d = res.data;
      toast(d.summary.isFullyPaid ? 'Payment recorded — bill fully paid ✅' : `Payment recorded · Balance ${inr(d.summary.balance)}`);
      onDone && onDone({ ...d.receipt, installments: d.installments, paymentBreakdownText: d.summary.breakdownText });
    } catch (e) {
      toast(e.response?.data?.message || 'Error saving payment', 'error');
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&!saving&&onClose()}>
      <div className="modal" style={{maxWidth:480}}>
        <div className="modal-header"><h3>➕ Add Payment</h3><button className="close-btn" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <div style={{background:'rgba(243,156,18,0.08)',border:'1px solid rgba(243,156,18,0.4)',borderRadius:6,padding:'12px 14px',marginBottom:14,fontSize:'0.86rem'}}>
            <strong>{bill.memberName}</strong> · Room {bill.roomNumber} · <span style={{fontFamily:'monospace'}}>{bill.billNumber}</span>
            <div style={{display:'flex',justifyContent:'space-between',marginTop:8}}>
              <span>Bill: {inr(bill.totalAmount)}</span>
              <span>Paid so far: {inr(bill.cumulativePaid ?? bill.amountPaid)}</span>
            </div>
            <div style={{marginTop:4,fontFamily:'Rajdhani',fontSize:'1.2rem',fontWeight:700,color:'#c0392b'}}>Outstanding: {inr(balance)}</div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>Amount (₹)</label>
              <input type="number" value={f.amount} onChange={e=>setF(p=>({...p,amount:e.target.value}))} />
              <button type="button" className="btn btn-secondary btn-xs" style={{marginTop:4}} onClick={()=>setF(p=>({...p,amount:String(balance)}))}>Pay full balance</button>
            </div>
            <div className="form-group">
              <label>Payment Method</label>
              <select value={f.paymentMethod} onChange={e=>setF(p=>({...p,paymentMethod:e.target.value}))}>
                {METHODS.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            {isOnline && (
              <div className="form-group full">
                <label>{f.paymentMethod==='cheque' ? 'Cheque No.' : 'Transaction ID / Reference No.'} <span style={{color:'var(--text3)',fontWeight:400,textTransform:'none'}}>(recommended)</span></label>
                <input value={f.referenceNo} onChange={e=>setF(p=>({...p,referenceNo:e.target.value}))} placeholder="e.g. UPI ref / UTR" />
              </div>
            )}
            <div className="form-group"><label>Date</label><input type="date" value={f.receiptDate} onChange={e=>setF(p=>({...p,receiptDate:e.target.value}))} /></div>
            <div className="form-group"><label>After this payment</label>
              <div style={{padding:'10px 12px',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,fontFamily:'Rajdhani',fontWeight:700,fontSize:'1.1rem',color:left>0?'var(--danger)':'var(--success)'}}>
                {left>0 ? `${inr(left)} remaining` : 'Fully paid ✅'}
              </div>
            </div>
            <div className="form-group full"><label>Notes (optional)</label><input value={f.notes} onChange={e=>setF(p=>({...p,notes:e.target.value}))} /></div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? '⏳ Saving…' : `Record ${inr(amt)}`}</button>
        </div>
      </div>
    </div>
  );
}

// ── Every payment on one bill: view, correct (with reason), remove (with reason) ──
export function PaymentHistoryModal({ billId, onClose, onChanged, onAdd, onPrint }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);     // { row, amount, paymentMethod, referenceNo, receiptDate, reason }
  const [del, setDel] = useState(null);       // { row, reason }
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    receiptsAPI.getInstallments(billId).then(r => setData(r.data)).catch(() => toast('Could not load payments', 'error')).finally(() => setLoading(false));
  };
  useEffect(load, [billId]);  // eslint-disable-line

  const fmtD = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  const s = data?.summary;

  const saveEdit = async () => {
    if (!edit.reason.trim()) { toast('Enter a reason for the correction', 'error'); return; }
    setBusy(true);
    try {
      const r = await receiptsAPI.editInstallment(edit.row._id, {
        amount: parseFloat(edit.amount), paymentMethod: edit.paymentMethod, referenceNo: edit.referenceNo,
        receiptDate: edit.receiptDate, reason: edit.reason.trim(),
      });
      setData(r.data); setEdit(null); toast('Payment corrected (logged in audit)'); onChanged && onChanged();
    } catch (e) { toast(e.response?.data?.message || 'Error', 'error'); }
    finally { setBusy(false); }
  };
  const doDelete = async () => {
    if (!del.reason.trim()) { toast('Enter a reason for removing it', 'error'); return; }
    setBusy(true);
    try {
      const r = await receiptsAPI.deleteInstallment(del.row._id, del.reason.trim());
      setData(r.data); setDel(null); toast('Payment removed (logged in audit)'); onChanged && onChanged();
    } catch (e) { toast(e.response?.data?.message || 'Error', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:760}}>
        <div className="modal-header"><h3>💳 Payment History {data ? `— ${data.root.billNumber}` : ''}</h3><button className="close-btn" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {loading || !data ? <div style={{textAlign:'center',padding:24,color:'var(--text3)'}}>⏳ Loading...</div> : (
            <>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:12}}>
                {[['Bill Total',inr(s.total),'var(--text)'],['Paid',inr(s.paid),'var(--success)'],['Balance',s.balance>0?inr(s.balance):'—',s.balance>0?'var(--danger)':'var(--success)'],['Status',s.isFullyPaid?'Fully paid':'Part paid',s.isFullyPaid?'var(--success)':'#f39c12']].map(([l,v,c],i)=>(
                  <div key={i} style={{background:'var(--bg3)',borderRadius:8,padding:'10px 12px'}}>
                    <div style={{fontSize:'0.66rem',color:'var(--text3)',textTransform:'uppercase'}}>{l}</div>
                    <div style={{fontFamily:'Rajdhani',fontWeight:700,fontSize:'1.2rem',color:c}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{padding:'8px 12px',background:'rgba(46,204,113,0.07)',border:'1px solid rgba(46,204,113,0.25)',borderRadius:6,fontSize:'0.85rem',marginBottom:12,fontWeight:600}}>{s.breakdownText}</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>#</th><th>Date</th><th>Receipt</th><th>Method</th><th>Reference</th><th>Amount</th><th>Balance after</th><th></th></tr></thead>
                  <tbody>
                    {data.installments.map((x,i) => {
                      const running = data.installments.slice(0,i+1).reduce((a,y)=>a+y.amount,0);
                      return (
                        <tr key={x._id}>
                          <td>{x.installmentNo}</td>
                          <td style={{fontSize:'0.8rem'}}>{fmtD(x.receiptDate)}</td>
                          <td style={{fontFamily:'monospace',fontSize:'0.75rem'}}>#{x.receiptNumber}</td>
                          <td><span className={`badge ${x.modeOfPayment==='online'?'badge-blue':'badge-green'}`} style={{fontSize:'0.68rem'}}>{x.methodLabel}</span></td>
                          <td style={{fontSize:'0.78rem'}}>{x.referenceNo||'—'}</td>
                          <td style={{fontWeight:700,color:'var(--success)'}}>{inr(x.amount)}</td>
                          <td style={{fontSize:'0.8rem'}}>{inr(Math.max(0, s.total - running))}</td>
                          <td>
                            <div style={{display:'flex',gap:4}}>
                              {onPrint && <button className="btn btn-success btn-xs" title="Receipt" onClick={()=>onPrint(x._id, data)}>🖨</button>}
                              <button className="btn btn-secondary btn-xs" title="Correct" onClick={()=>setEdit({row:x,amount:String(x.amount),paymentMethod:x.paymentMethod,referenceNo:x.referenceNo,receiptDate:(x.receiptDate||'').split('T')[0],reason:''})}>✏️</button>
                              {!x.isRoot && <button className="btn btn-danger btn-xs" title="Remove" onClick={()=>setDel({row:x,reason:''})}>🗑</button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {edit && (
                <div style={{marginTop:14,padding:14,border:'1px solid var(--border2)',borderRadius:8,background:'var(--bg3)'}}>
                  <strong style={{fontSize:'0.85rem'}}>Correct payment #{edit.row.installmentNo}</strong>
                  <div className="form-grid" style={{marginTop:8}}>
                    <div className="form-group"><label>Amount (₹)</label><input type="number" value={edit.amount} onChange={e=>setEdit(p=>({...p,amount:e.target.value}))} /></div>
                    <div className="form-group"><label>Method</label><select value={edit.paymentMethod} onChange={e=>setEdit(p=>({...p,paymentMethod:e.target.value}))}>{METHODS.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
                    <div className="form-group"><label>Reference</label><input value={edit.referenceNo} onChange={e=>setEdit(p=>({...p,referenceNo:e.target.value}))} /></div>
                    <div className="form-group"><label>Date</label><input type="date" value={edit.receiptDate} onChange={e=>setEdit(p=>({...p,receiptDate:e.target.value}))} /></div>
                    <div className="form-group full"><label>Reason for correction *</label><input value={edit.reason} onChange={e=>setEdit(p=>({...p,reason:e.target.value}))} placeholder="e.g. typed 600 instead of 400" /></div>
                  </div>
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                    <button className="btn btn-secondary btn-xs" onClick={()=>setEdit(null)} disabled={busy}>Cancel</button>
                    <button className="btn btn-primary btn-xs" onClick={saveEdit} disabled={busy}>{busy?'Saving…':'Save correction'}</button>
                  </div>
                </div>
              )}
              {del && (
                <div style={{marginTop:14,padding:14,border:'1px solid rgba(231,76,60,0.4)',borderRadius:8,background:'rgba(231,76,60,0.06)'}}>
                  <strong style={{fontSize:'0.85rem'}}>Remove payment #{del.row.installmentNo} ({inr(del.row.amount)} {del.row.methodLabel})?</strong>
                  <div style={{fontSize:'0.78rem',color:'var(--text2)',margin:'4px 0 8px'}}>The bill balance goes back up by this amount. The removed record is kept in the Audit Log.</div>
                  <input style={{width:'100%'}} value={del.reason} onChange={e=>setDel(p=>({...p,reason:e.target.value}))} placeholder="Reason *" />
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
                    <button className="btn btn-secondary btn-xs" onClick={()=>setDel(null)} disabled={busy}>Cancel</button>
                    <button className="btn btn-danger btn-xs" onClick={doDelete} disabled={busy}>{busy?'Removing…':'Remove payment'}</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          {data && !s.isFullyPaid && onAdd && <button className="btn btn-primary" onClick={()=>onAdd(data.root)}>➕ Add Payment</button>}
        </div>
      </div>
    </div>
  );
}
