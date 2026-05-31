import { useHostel } from '../context/HostelContext';
import React, { useEffect, useState } from 'react';
import { electricAPI } from '../utils/api';
import { useToast } from '../context/ToastContext';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function Electric() {
  const { hostelSwitchCount } = useHostel();
  const [readings, setReadings] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [lastReading, setLastReading] = useState(null);
  const [form, setForm] = useState({ month:'', year:'', startReading:'', endReading:'', ratePerUnit:8 });
  const [prediction, setPrediction] = useState(null); // F4
  const toast = useToast();

  const load = () => electricAPI.getByRoom(selectedRoom).then(r => setReadings(r.data?.data || r.data || []));
  useEffect(() => {
    load();
    // F4: Fetch prediction non-blocking
    electricAPI.predict?.(selectedRoom).then(r => setPrediction(r.data)).catch(() => setPrediction(null));
  }, [selectedRoom]);

  const openModal = async () => {
    const now = new Date();
    let m = now.getMonth() + 1;
    let y = now.getFullYear();
    try {
      const res = await electricAPI.getLastByRoom(selectedRoom);
      setLastReading(res.data);
      setForm({
        month: m,
        year: y,
        startReading: res.data ? res.data.endReading : '',
        endReading: '',
        ratePerUnit: res.data ? res.data.ratePerUnit : 8,
      });
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

  const units = form.endReading && form.startReading ? Number(form.endReading) - Number(form.startReading) : 0;
  const total = units * (form.ratePerUnit || 8);

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

        {/* Summary cards */}
        {readings.length > 0 && (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginTop:4}}>
            {[
              { label:'Total Readings', value: readings.length },
              { label:'Last Reading', value: readings[0]?.endReading ?? '—' },
              { label:'Last Month Units', value: readings[0]?.unitsConsumed ?? '—' },
              { label:'Last Bill', value: readings[0] ? `₹${readings[0].totalAmount}` : '—' },
            ].map((s,i) => (
              <div key={i} style={{background:'var(--bg3)',borderRadius:8,padding:'14px',border:'1px solid var(--border)'}}>
                <div style={{fontSize:'0.72rem',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>{s.label}</div>
                <div style={{fontSize:'1.4rem',fontFamily:'Rajdhani',fontWeight:700,color:'var(--accent)'}}>{s.value}</div>
              </div>
            ))}
            {/* F4: Predicted next bill card */}
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
        <h3 style={{fontFamily:'Rajdhani',marginBottom:16}}>Room {selectedRoom} — Reading History</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month / Year</th><th>Start Reading</th><th>End Reading</th>
                <th>Units Used</th><th>Rate/Unit</th><th>Bill Amount</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {readings.length === 0 ? (
                <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon">⚡</div><p>No readings for Room {selectedRoom}</p></div></td></tr>
              ) : readings.map((r, i) => (
                <tr key={r._id}>
                  <td style={{fontWeight:500,color:'var(--text)'}}>{MONTHS[r.month-1]} {r.year}</td>
                  <td>{r.startReading}</td>
                  <td>{r.endReading}</td>
                  <td style={{color:'var(--info)',fontWeight:600}}>
                    {r.unitsConsumed} units
                    {/* F3: Anomaly badge */}
                    {r.isAnomaly && (
                      <span title="Unusually high — verify meter"
                        style={{marginLeft:6,background:'rgba(231,76,60,0.15)',color:'var(--danger)',padding:'1px 7px',borderRadius:10,fontSize:'0.7rem',fontWeight:700,cursor:'help'}}>
                        🚨 High
                      </span>
                    )}
                  </td>
                  <td>₹{r.ratePerUnit}/unit</td>
                  <td style={{color:'var(--accent)',fontWeight:700,fontSize:'1rem'}}>₹{r.totalAmount}</td>
                  <td>
                    <div style={{display:'flex',gap:6}}>
                      {i === 0 && <span className="badge badge-green" style={{marginRight:4}}>Latest</span>}
                      <button className="btn btn-danger btn-xs" onClick={() => del(r._id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
    </div>
  );
}
