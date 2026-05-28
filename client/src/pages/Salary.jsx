import { useHostel } from '../context/HostelContext';
import React, { useEffect, useState, useCallback } from 'react';
import { salaryAPI } from '../utils/api';
import { useToast } from '../context/ToastContext';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const EMPTY = { employeeName:'', role:'', mobileNo:'', address:'', basicSalary:'', allowances:'', deductions:'', month: new Date().getMonth()+1, year: new Date().getFullYear(), paidDate:'', modeOfPayment:'cash', notes:'', maintenanceCosts:[] };

export default function Salary() {
  const [records, setRecords] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [maintenance, setMaintenance] = useState([]);
  const toast = useToast();
  const { hostelSwitchCount } = useHostel();

  const load = useCallback(() => salaryAPI.getAll().then(r => setRecords(r.data)), [hostelSwitchCount]);
  useEffect(() => { load(); }, [load]);

  const open = (r=null) => {
    setEditing(r);
    if (r) { setForm({...r, basicSalary: r.basicSalary||'', allowances:r.allowances||'', deductions:r.deductions||'', paidDate: r.paidDate?r.paidDate.split('T')[0]:''}); setMaintenance(r.maintenanceCosts||[]); }
    else { setForm(EMPTY); setMaintenance([]); }
    setShowModal(true);
  };

  const addMaintenance = () => setMaintenance(p => [...p, { description:'', amount:'' }]);
  const updateMaintenance = (i, k, v) => setMaintenance(p => p.map((c,idx) => idx===i ? {...c,[k]:v} : c));
  const removeMaintenance = (i) => setMaintenance(p => p.filter((_,idx)=>idx!==i));

  const save = async () => {
    if (!form.employeeName || !form.role) { toast('Name and role required', 'error'); return; }
    try {
      const data = { ...form, maintenanceCosts: maintenance.filter(c=>c.description||c.amount) };
      if (editing) await salaryAPI.update(editing._id, data);
      else await salaryAPI.create(data);
      toast(editing ? 'Updated' : 'Salary record saved');
      setShowModal(false); load();
    } catch(e) { toast('Error saving', 'error'); }
  };

  const del = async (id) => {
    if (!window.confirm('Delete this record?')) return;
    await salaryAPI.delete(id); toast('Deleted'); load();
  };

  const F = (k) => ({ value: form[k]||'', onChange: e => setForm(p=>({...p,[k]:e.target.value})) });

  const netSalary = (Number(form.basicSalary)||0) + (Number(form.allowances)||0) - (Number(form.deductions)||0);
  const totalMaintenance = maintenance.reduce((s,c)=>s+(Number(c.amount)||0),0);
  const totalExpenditure = netSalary + totalMaintenance;

  const totalSalaryAll = records.reduce((s,r)=>s+(r.netSalary||0),0);
  const totalMaintenanceAll = records.reduce((s,r)=>s+(r.maintenanceCosts||[]).reduce((a,c)=>a+(c.amount||0),0),0);

  return (
    <div>
      <div className="page-header">
        <div><h2>Salary & Expenses</h2><p>Employee salaries and maintenance costs</p></div>
        <button className="btn btn-primary" onClick={() => open()}>+ Add Record</button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:14,marginBottom:24}}>
        {[
          {label:'Total Salary Paid', value:`₹${totalSalaryAll.toLocaleString('en-IN')}`, color:'var(--danger)'},
          {label:'Total Maintenance', value:`₹${totalMaintenanceAll.toLocaleString('en-IN')}`, color:'var(--danger)'},
          {label:'Total Expenditure', value:`₹${(totalSalaryAll+totalMaintenanceAll).toLocaleString('en-IN')}`, color:'var(--danger)'},
          {label:'Records', value:records.length, color:'var(--text2)'},
        ].map((s,i) => (
          <div key={i} className="card">
            <div style={{fontSize:'0.72rem',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>{s.label}</div>
            <div style={{fontFamily:'Rajdhani',fontSize:'1.6rem',fontWeight:700,color:s.color}}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Role</th><th>Month/Year</th><th>Basic</th><th>Allowances</th><th>Deductions</th><th>Net Salary</th><th>Maintenance</th><th>Mode</th><th>Actions</th></tr></thead>
            <tbody>
              {records.length===0 ? (
                <tr><td colSpan={10}><div className="empty-state"><div className="empty-icon">💼</div><p>No salary records yet</p></div></td></tr>
              ) : records.map(r => {
                const maint = (r.maintenanceCosts||[]).reduce((s,c)=>s+(c.amount||0),0);
                return (
                  <tr key={r._id}>
                    <td style={{color:'var(--text)',fontWeight:500}}>{r.employeeName}</td>
                    <td><span className="badge badge-blue">{r.role}</span></td>
                    <td style={{fontSize:'0.82rem'}}>{r.month ? MONTHS[r.month-1] : '—'} {r.year}</td>
                    <td>₹{r.basicSalary||0}</td>
                    <td style={{color:'var(--success)'}}>+₹{r.allowances||0}</td>
                    <td style={{color:'var(--danger)'}}>-₹{r.deductions||0}</td>
                    <td style={{color:'var(--accent)',fontWeight:700}}>₹{r.netSalary||0}</td>
                    <td>{maint>0?`₹${maint}`:'—'}</td>
                    <td><span className={`badge ${r.modeOfPayment==='cash'?'badge-green':'badge-blue'}`}>{r.modeOfPayment}</span></td>
                    <td>
                      <div style={{display:'flex',gap:6}}>
                        <button className="btn btn-secondary btn-xs" onClick={() => open(r)}>Edit</button>
                        <button className="btn btn-danger btn-xs" onClick={() => del(r._id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <h3>{editing ? 'Edit Record' : 'Add Salary / Expense Record'}</h3>
              <button className="close-btn" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="section-divider">Employee Details</div>
                <div className="form-group"><label>Employee Name *</label><input {...F('employeeName')} placeholder="Full name" /></div>
                <div className="form-group"><label>Role / Designation *</label><input {...F('role')} placeholder="e.g. Cleaner, Guard, Manager" /></div>
                <div className="form-group"><label>Mobile No.</label><input {...F('mobileNo')} /></div>
                <div className="form-group"><label>Month</label>
                  <select value={form.month} onChange={e=>setForm(p=>({...p,month:e.target.value}))}>
                    {MONTHS.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Year</label><input type="number" {...F('year')} /></div>
                <div className="form-group"><label>Paid Date</label><input type="date" {...F('paidDate')} /></div>
                <div className="form-group full"><label>Address</label><textarea {...F('address')} rows={2} style={{resize:'vertical'}} /></div>

                <div className="section-divider">Salary Breakdown</div>
                <div className="form-group"><label>Basic Salary (₹)</label><input type="number" {...F('basicSalary')} placeholder="0" /></div>
                <div className="form-group"><label>Allowances (₹)</label><input type="number" {...F('allowances')} placeholder="0" /></div>
                <div className="form-group"><label>Deductions (₹)</label><input type="number" {...F('deductions')} placeholder="0" /></div>
                <div className="form-group"><label>Mode of Payment</label>
                  <select value={form.modeOfPayment} onChange={e=>setForm(p=>({...p,modeOfPayment:e.target.value}))}>
                    <option value="cash">💵 Cash</option>
                    <option value="online">📱 Online</option>
                  </select>
                </div>
                {(Number(form.basicSalary)||0) > 0 && (
                  <div className="form-group full">
                    <div style={{background:'rgba(231,76,60,0.08)',border:'1px solid rgba(231,76,60,0.2)',borderRadius:6,padding:'10px 14px',display:'flex',justifyContent:'space-between'}}>
                      <span style={{color:'var(--text2)'}}>Net Salary</span>
                      <span style={{fontFamily:'Rajdhani',fontSize:'1.3rem',fontWeight:700,color:'var(--danger)'}}>₹{netSalary}</span>
                    </div>
                  </div>
                )}

                <div className="section-divider">Maintenance / Other Costs</div>
                <div className="form-group full">
                  {maintenance.map((c,i) => (
                    <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 140px 36px',gap:8,marginBottom:8}}>
                      <input placeholder="Description (e.g. Plumbing repair)" value={c.description} onChange={e=>updateMaintenance(i,'description',e.target.value)}
                        style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 10px',color:'var(--text)',outline:'none'}} />
                      <input type="number" placeholder="Amount" value={c.amount} onChange={e=>updateMaintenance(i,'amount',e.target.value)}
                        style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 10px',color:'var(--text)',outline:'none'}} />
                      <button onClick={() => removeMaintenance(i)} style={{background:'rgba(231,76,60,0.1)',border:'1px solid rgba(231,76,60,0.3)',borderRadius:6,color:'var(--danger)',cursor:'pointer',fontSize:'1rem'}}>✕</button>
                    </div>
                  ))}
                  <button className="btn btn-secondary btn-sm" onClick={addMaintenance}>+ Add Cost Item</button>
                  {totalMaintenance > 0 && (
                    <div style={{marginTop:10,color:'var(--text2)',fontSize:'0.85rem'}}>Maintenance total: <strong style={{color:'var(--danger)'}}>₹{totalMaintenance}</strong></div>
                  )}
                </div>

                {totalExpenditure > 0 && (
                  <div className="form-group full">
                    <div style={{background:'rgba(231,76,60,0.08)',border:'1px solid rgba(231,76,60,0.2)',borderRadius:6,padding:'10px 14px',display:'flex',justifyContent:'space-between'}}>
                      <span style={{color:'var(--text2)'}}>Total Expenditure (Salary + Maintenance)</span>
                      <span style={{fontFamily:'Rajdhani',fontSize:'1.3rem',fontWeight:700,color:'var(--danger)'}}>₹{totalExpenditure}</span>
                    </div>
                  </div>
                )}

                <div className="form-group full"><label>Notes</label><input {...F('notes')} placeholder="Optional notes" /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>{editing ? 'Update' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
