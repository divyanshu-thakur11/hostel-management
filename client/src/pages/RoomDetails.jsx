import { useHostel } from '../context/HostelContext';
import React, { useEffect, useState } from 'react';
import { membersAPI, roomsAPI, whatsapp as wa } from '../utils/api';
import api from '../utils/api';
import { useToast } from '../context/ToastContext';

// F6: Payment risk score badge — lazy, non-blocking
function RiskBadge({ memberId }) {
  const [risk, setRisk] = useState(null);
  useEffect(() => {
    if (!memberId) return;
    api.get(`/members/${memberId}/payment-score`).then(r => setRisk(r.data)).catch(() => {});
  }, [memberId]);
  if (!risk) return null;
  const emoji = risk.risk === 'low' ? '🟢' : risk.risk === 'medium' ? '🟡' : '🔴';
  return (
    <span title={`Payment Risk: ${risk.risk} | Score: ${risk.score}/100 | Last payment: ${risk.lastPaymentDays === 999 ? 'never' : risk.lastPaymentDays + ' days ago'} | Part payments: ${risk.partPaymentCount}`}
      style={{marginLeft:5,cursor:'help',fontSize:'0.85rem',display:'inline'}}>
      {emoji}
    </span>
  );
}

export default function RoomDetails() {
  const { hostelSwitchCount } = useHostel();
  const [members, setMembers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showVacateModal, setShowVacateModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ roomNumber:'', numberOfMembers:1, rent:'', advance:'', roomJoinDate:'', policeFormVerified:false, roomLeavingDate:'' });
  const [vacateReason, setVacateReason] = useState('Plan expired / Left hostel');
  const [filterRoom, setFilterRoom] = useState('');
  const toast = useToast();

  const load = () => membersAPI.getAll().then(r => setMembers(r.data?.data || r.data || []));
  useEffect(() => { load(); }, [hostelSwitchCount]);

  const today = new Date();
  const activeMembers = members.filter(m => m.isActive !== false);
  const dueMembers = activeMembers.filter(m => m.roomLeavingDate && new Date(m.roomLeavingDate) < today);
  const currentMembers = activeMembers.filter(m => !m.roomLeavingDate || new Date(m.roomLeavingDate) >= today);
  const filtered = (list) => filterRoom ? list.filter(m => String(m.roomNumber) === filterRoom) : list;

  const open = (m) => {
    setEditing(m);
    setForm({
      roomNumber: m.roomNumber || '',
      numberOfMembers: m.numberOfMembers || 1,
      rent: m.rent || '',
      advance: m.advance || '',
      roomJoinDate: m.roomJoinDate ? m.roomJoinDate.split('T')[0] : '',
      policeFormVerified: m.policeFormVerified || false,
      roomLeavingDate: m.roomLeavingDate ? m.roomLeavingDate.split('T')[0] : '',
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.roomNumber) { toast('Please select a room number', 'error'); return; }
    if (!editing?._id) { toast('No member selected', 'error'); return; }
    try {
      const payload = {
        roomNumber:      parseInt(form.roomNumber),
        numberOfMembers: parseInt(form.numberOfMembers) || 1,
        rent:            parseFloat(form.rent) || 0,
        advance:         parseFloat(form.advance) || 0,
        roomJoinDate:    form.roomJoinDate || null,
        policeFormVerified: form.policeFormVerified,
        roomLeavingDate: form.roomLeavingDate || null,
      };
      const res = await membersAPI.update(editing._id, payload);
      if (res.data) {
        toast('Room details saved for ' + editing.name);
        setShowModal(false);
        load();
      } else {
        toast('Unexpected response from server', 'error');
      }
    } catch(err) {
      console.error('Save room details error:', err);
      const msg = err?.response?.data?.message || err?.message || 'Error saving room details';
      toast(msg, 'error');
    }
  };

  const handleVacate = async () => {
    if (!showVacateModal) return;
    try {
      await membersAPI.vacate(showVacateModal._id, vacateReason);
      toast(`${showVacateModal.name} vacated and moved to Archive`);
      setShowVacateModal(null);
      setVacateReason('Plan expired / Left hostel');
      load();
    } catch { toast('Error vacating member', 'error'); }
  };

  const MemberTable = ({ list, isDue = false }) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Name</th><th>Mobile</th><th>Room</th><th>Rent</th><th>Advance</th><th>Join Date</th><th>Leaving Date</th><th>Police</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr><td colSpan={9}><div className="empty-state"><div className="empty-icon">{isDue?'⚠️':'📋'}</div><p>{isDue?'No overdue members':'No members'}</p></div></td></tr>
          ) : list.map(m => {
            const daysOverdue = isDue && m.roomLeavingDate
              ? Math.floor((new Date() - new Date(m.roomLeavingDate)) / (1000*60*60*24))
              : 0;
            return (
            <tr key={m._id}>
              <td style={{color:'var(--text)',fontWeight:500}}>{m.name}<RiskBadge memberId={m._id} /></td>
              <td style={{fontSize:'0.82rem'}}>{m.mobileNo || '—'}</td>
              <td>{m.roomNumber ? <span className="badge badge-blue">Room {m.roomNumber}</span> : '—'}</td>
              <td>₹{m.rent||0}</td>
              <td>₹{m.advance||0}</td>
              <td>{m.roomJoinDate ? new Date(m.roomJoinDate).toLocaleDateString('en-IN') : '—'}</td>
              <td style={{color:isDue?'var(--danger)':'var(--text2)'}}>
                {m.roomLeavingDate ? new Date(m.roomLeavingDate).toLocaleDateString('en-IN') : '—'}
                {isDue && daysOverdue > 0 && <span style={{fontSize:'0.7rem',display:'block',color:'var(--danger)'}}>({daysOverdue}d overdue)</span>}
              </td>
              <td><span className={`badge ${m.policeFormVerified?'badge-green':'badge-red'}`}>{m.policeFormVerified?'Done':'Pending'}</span></td>
              <td>
                <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                  <button className="btn btn-secondary btn-xs" onClick={() => open(m)}>Edit</button>
                  {isDue && m.mobileNo && (
                    <button
                      onClick={() => wa.sendReminder(m.mobileNo, m.name, m.roomNumber, m.rent || 0, 'rent dues')}
                      style={{background:'#25d366',color:'white',border:'none',borderRadius:4,padding:'4px 8px',cursor:'pointer',fontSize:'0.72rem',fontWeight:600,whiteSpace:'nowrap'}}
                      title={`Send WhatsApp reminder to ${m.mobileNo}`}
                    >
                      📱 WhatsApp
                    </button>
                  )}
                  <button className="btn btn-xs" style={{background:'rgba(243,156,18,0.15)',color:'#f39c12',border:'1px solid rgba(243,156,18,0.3)',padding:'4px 8px',borderRadius:4,cursor:'pointer',fontSize:'0.72rem',fontFamily:'Rajdhani',fontWeight:600}} onClick={()=>{setShowVacateModal(m);setVacateReason('Plan expired / Left hostel');}}>
                    📦 Vacate
                  </button>
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div><h2>Room Details</h2><p>Manage room assignments and member details</p></div>
        <select style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 12px',color:'var(--text)',outline:'none'}}
          value={filterRoom} onChange={e=>setFilterRoom(e.target.value)}>
          <option value="">All Rooms</option>
          {Array.from({length:20},(_,i)=>i+1).map(n=><option key={n} value={n}>Room {n}</option>)}
        </select>
      </div>

      <div className="card" style={{marginBottom:20}}>
        <h3 style={{fontFamily:'Rajdhani',marginBottom:16}}>Current Members</h3>
        <MemberTable list={filtered(currentMembers)} />
      </div>

      {dueMembers.length > 0 && (
        <div className="due-section">
          <h3>⚠️ Overdue Members — Leaving Date Passed</h3>
          <p style={{color:'var(--text2)',fontSize:'0.85rem',marginBottom:12}}>These members' plans have expired. Click "Vacate" to archive them and free the room.</p>
          <MemberTable list={filtered(dueMembers)} isDue={true} />
        </div>
      )}

      {/* Vacate Modal */}
      {showVacateModal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowVacateModal(null)}>
          <div className="modal" style={{maxWidth:440}}>
            <div className="modal-header">
              <h3>📦 Vacate Member</h3>
              <button className="close-btn" onClick={()=>setShowVacateModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{background:'rgba(243,156,18,0.08)',border:'1px solid rgba(243,156,18,0.25)',borderRadius:8,padding:'14px',marginBottom:16}}>
                <div style={{fontWeight:600,color:'var(--text)',marginBottom:4}}>{showVacateModal.name}</div>
                <div style={{fontSize:'0.85rem',color:'var(--text2)'}}>
                  {showVacateModal.roomNumber && <span>Room {showVacateModal.roomNumber} · </span>}
                  {showVacateModal.mobileNo}
                </div>
              </div>
              <p style={{color:'var(--text2)',fontSize:'0.88rem',marginBottom:16}}>
                Member data will be <strong style={{color:'var(--accent)'}}>moved to Archive</strong>. Room will be freed for new members.
              </p>
              <div className="form-group">
                <label>Reason for Vacating</label>
                <select value={vacateReason} onChange={e=>setVacateReason(e.target.value)}
                  style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'10px 12px',color:'var(--text)',outline:'none',width:'100%'}}>
                  <option value="Plan expired / Left hostel">Plan expired / Left hostel</option>
                  <option value="Non-payment of rent">Non-payment of rent</option>
                  <option value="Rule violation">Rule violation</option>
                  <option value="Personal reasons">Personal reasons</option>
                  <option value="Transfer / Relocation">Transfer / Relocation</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setShowVacateModal(null)}>Cancel</button>
              <button style={{background:'rgba(243,156,18,0.2)',color:'#f39c12',border:'1px solid rgba(243,156,18,0.4)',padding:'10px 20px',borderRadius:6,fontFamily:'Rajdhani',fontWeight:700,fontSize:'0.95rem',cursor:'pointer'}} onClick={handleVacate}>
                📦 Confirm Vacate & Archive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Room Modal */}
      {showModal && editing && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal" style={{maxWidth:520}}>
            <div className="modal-header">
              <h3>Room Details — {editing.name}</h3>
              <button className="close-btn" onClick={()=>setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Room Number</label>
                  <select value={form.roomNumber} onChange={async e => {
                    const roomNo = e.target.value;
                    setForm(p => ({ ...p, roomNumber: roomNo }));
                    if (roomNo) {
                      try {
                        const r = await roomsAPI.getOne(roomNo);
                        const rd = r.data;
                        if (rd) {
                          setForm(p => ({
                            ...p,
                            roomNumber: roomNo,
                            rent: rd.rent || p.rent || '',
                            advance: rd.advance || p.advance || '',
                            numberOfMembers: rd.memberCount >= 0 ? Math.max(1, rd.memberCount + 1) : p.numberOfMembers,
                          }));
                        }
                      } catch(e) {}
                    }
                  }}>
                    <option value="">Select Room</option>
                    {Array.from({length:20},(_,i)=>i+1).map(n=><option key={n} value={n}>Room {n}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Number of Members</label>
                  <select value={form.numberOfMembers} onChange={e=>setForm(p=>({...p,numberOfMembers:e.target.value}))}>
                    {[1,2,3,4,5,6].map(n=><option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Monthly Rent (₹) <span style={{fontSize:'0.7rem',color:'var(--text3)',fontWeight:400,textTransform:'none'}}>— auto-filled from room config, editable</span></label>
                  <input value={form.rent} onChange={e=>setForm(p=>({...p,rent:e.target.value}))} type="number" placeholder="Auto-filled from Room settings" />
                </div>
                <div className="form-group">
                  <label>Advance (₹) <span style={{fontSize:'0.7rem',color:'var(--text3)',fontWeight:400,textTransform:'none'}}>— cumulative for the room</span></label>
                  <input value={form.advance} onChange={e=>setForm(p=>({...p,advance:e.target.value}))} type="number" placeholder="Auto-filled from Room settings" />
                </div>
                <div className="form-group"><label>Room Join Date</label><input value={form.roomJoinDate} onChange={e=>setForm(p=>({...p,roomJoinDate:e.target.value}))} type="date" /></div>
                <div className="form-group"><label>Room Leaving Date</label><input value={form.roomLeavingDate} onChange={e=>setForm(p=>({...p,roomLeavingDate:e.target.value}))} type="date" /></div>
                <div className="form-group full">
                  <label>Police Form Verification</label>
                  <div className="checkbox-group">
                    <input type="checkbox" checked={form.policeFormVerified} onChange={e=>setForm(p=>({...p,policeFormVerified:e.target.checked}))} id="policeCheck" />
                    <label htmlFor="policeCheck" style={{textTransform:'none',color:'var(--text)',fontSize:'0.9rem',cursor:'pointer'}}>Police form has been verified</label>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save Details</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
