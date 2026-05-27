import { useHostel } from '../context/HostelContext';
import React, { useEffect, useState, useCallback } from 'react';
import { roomsAPI } from '../utils/api';
import { useToast } from '../context/ToastContext';

const STATUS_STYLE = {
  vacant:   { bg: 'rgba(39,174,96,0.1)',  border: 'rgba(39,174,96,0.3)',  color: '#27ae60', label: 'Vacant'   },
  occupied: { bg: 'rgba(41,128,185,0.1)', border: 'rgba(41,128,185,0.3)', color: '#2980b9', label: 'Occupied' },
  full:     { bg: 'rgba(192,57,43,0.1)',  border: 'rgba(192,57,43,0.3)',  color: '#c0392b', label: 'Full'     },
};

export default function Rooms() {
  const { hostelSwitchCount } = useHostel();
  const [rooms, setRooms]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editRoom, setEditRoom]   = useState(null);   // room being edited in modal
  const [editForm, setEditForm]   = useState({});
  const [saving, setSaving]       = useState(false);
  const [viewRoom, setViewRoom]   = useState(null);   // room whose members are shown
  const [bulkMode, setBulkMode]   = useState(false);  // bulk edit all rooms
  const [bulkData, setBulkData]   = useState([]);
  const toast = useToast();

  const load = useCallback(() => {
    setLoading(true);
    roomsAPI.getAll()
      .then(r => {
        const data = r.data?.data || r.data || [];
        setRooms(Array.isArray(data) ? data : []);
      })
      .catch(() => toast('Failed to load rooms', 'error'))
      .finally(() => setLoading(false));
  }, [hostelSwitchCount]);

  useEffect(() => { load(); }, [load]);

  // Open single-room edit modal
  const openEdit = (room) => {
    setEditRoom(room);
    setEditForm({
      rent:        room.rent        || 0,
      advance:     room.advance     || 0,
      maxCapacity: room.maxCapacity || 6,
      notes:       room.notes       || '',
    });
  };

  const saveEdit = async () => {
    if (!editRoom) return;
    setSaving(true);
    try {
      await roomsAPI.update(editRoom.roomNumber, editForm);
      toast(`Room ${editRoom.roomNumber} updated`);
      setEditRoom(null);
      load();
    } catch(e) {
      toast(e.response?.data?.message || 'Error saving room', 'error');
    } finally { setSaving(false); }
  };

  // Open bulk edit
  const openBulk = () => {
    setBulkData(rooms.map(r => ({
      roomNumber:  r.roomNumber,
      rent:        r.rent        || 0,
      advance:     r.advance     || 0,
      maxCapacity: r.maxCapacity || 6,
    })));
    setBulkMode(true);
  };

  const saveBulk = async () => {
    setSaving(true);
    try {
      await roomsAPI.updateAll(bulkData);
      toast('All rooms updated');
      setBulkMode(false);
      load();
    } catch(e) {
      toast('Error saving rooms', 'error');
    } finally { setSaving(false); }
  };

  const updateBulkRow = (roomNumber, field, value) => {
    setBulkData(prev => prev.map(r =>
      r.roomNumber === roomNumber ? { ...r, [field]: value } : r
    ));
  };

  // Stats
  const totalRooms    = rooms.length;
  const vacantRooms   = rooms.filter(r => r.status === 'vacant').length;
  const occupiedRooms = rooms.filter(r => r.status !== 'vacant').length;
  const totalMembers  = rooms.reduce((s, r) => s + (r.memberCount || 0), 0);
  const monthlyRent   = rooms.reduce((s, r) => r.memberCount > 0 ? s + (r.rent || 0) : s, 0);

  if (loading) return <div style={{ color: 'var(--text2)', padding: 40 }}>Loading rooms...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Room Management</h2>
          <p>Set fixed rent and capacity for each room</p>
        </div>
        <button className="btn btn-secondary" onClick={openBulk}>✏️ Edit All Rooms</button>
      </div>

      {/* Summary Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Rooms',    value: totalRooms,    color: 'var(--text)'    },
          { label: 'Occupied',       value: occupiedRooms, color: 'var(--info)'    },
          { label: 'Vacant',         value: vacantRooms,   color: 'var(--success)' },
          { label: 'Total Members',  value: totalMembers,  color: 'var(--accent)'  },
          { label: 'Expected Rent',  value: `₹${monthlyRent.toLocaleString('en-IN')}`, color: 'var(--success)' },
        ].map((s, i) => (
          <div key={i} className="card" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <div style={{ fontFamily: 'Rajdhani', fontSize: '1.6rem', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Room Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
        {rooms.map(room => {
          const st = STATUS_STYLE[room.status] || STATUS_STYLE.vacant;
          return (
            <div key={room.roomNumber} className="card" style={{ padding: 0, overflow: 'hidden', border: `1px solid ${st.border}` }}>
              {/* Room header */}
              <div style={{ background: st.bg, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontFamily: 'Rajdhani', fontSize: '1.5rem', fontWeight: 700, color: st.color }}>
                  Room {String(room.roomNumber).padStart(2, '0')}
                </div>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: st.bg, color: st.color, border: `1px solid ${st.border}`, textTransform: 'uppercase' }}>
                  {st.label}
                </span>
              </div>

              {/* Room details */}
              <div style={{ padding: '12px 14px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Monthly Rent</div>
                    <div style={{ fontFamily: 'Rajdhani', fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent)' }}>
                      {room.rent ? `₹${room.rent.toLocaleString('en-IN')}` : <span style={{ color: 'var(--text3)' }}>Not set</span>}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Advance</div>
                    <div style={{ fontFamily: 'Rajdhani', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text2)' }}>
                      {room.advance ? `₹${room.advance.toLocaleString('en-IN')}` : <span style={{ color: 'var(--text3)' }}>—</span>}
                    </div>
                  </div>
                </div>

                {/* Members */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Members ({room.memberCount}/{room.maxCapacity})
                  </div>
                  {room.memberCount === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text3)', fontStyle: 'italic' }}>No members</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {(room.members || []).slice(0, 3).map(m => (
                        <div key={m._id} style={{ fontSize: '0.78rem', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.color, flexShrink: 0 }} />
                          {m.name}
                        </div>
                      ))}
                      {room.memberCount > 3 && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>+{room.memberCount - 3} more</div>
                      )}
                    </div>
                  )}
                </div>

                {room.notes && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text3)', fontStyle: 'italic', marginBottom: 8, padding: '6px 8px', background: 'var(--bg3)', borderRadius: 4 }}>
                    📝 {room.notes}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary btn-xs" style={{ flex: 1 }} onClick={() => openEdit(room)}>
                    ✏️ Edit Room
                  </button>
                  {room.memberCount > 0 && (
                    <button className="btn btn-xs" style={{ flex: 1, background: 'rgba(52,152,219,0.1)', color: 'var(--info)', border: '1px solid rgba(52,152,219,0.3)' }}
                      onClick={() => setViewRoom(viewRoom?.roomNumber === room.roomNumber ? null : room)}>
                      👥 Members
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Members panel */}
      {viewRoom && (
        <div className="card" style={{ marginTop: 20, border: '1px solid rgba(52,152,219,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontFamily: 'Rajdhani', fontSize: '1.1rem' }}>
              Room {viewRoom.roomNumber} — Members
              <span style={{ marginLeft: 10, fontSize: '0.8rem', color: 'var(--text3)', fontFamily: 'Noto Sans' }}>
                Shared Rent: <strong style={{ color: 'var(--accent)' }}>₹{(viewRoom.rent || 0).toLocaleString('en-IN')}</strong>
              </span>
            </h3>
            <button className="btn btn-secondary btn-xs" onClick={() => setViewRoom(null)}>✕ Close</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Mobile</th><th>Member ID</th><th>Join Date</th><th>Police Form</th></tr>
              </thead>
              <tbody>
                {(viewRoom.members || []).map(m => (
                  <tr key={m._id}>
                    <td style={{ color: 'var(--text)', fontWeight: 500 }}>{m.name}</td>
                    <td>{m.mobileNo}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--accent)' }}>{m.memberId || '—'}</td>
                    <td>{m.roomJoinDate ? new Date(m.roomJoinDate).toLocaleDateString('en-IN') : '—'}</td>
                    <td><span className={`badge ${m.policeFormVerified ? 'badge-green' : 'badge-red'}`}>{m.policeFormVerified ? 'Done' : 'Pending'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Single Room Edit Modal */}
      {editRoom && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditRoom(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3>Edit Room {String(editRoom.roomNumber).padStart(2, '0')}</h3>
              <button className="close-btn" onClick={() => setEditRoom(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background: 'rgba(240,165,0,0.06)', border: '1px solid rgba(240,165,0,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 18, fontSize: '0.82rem', color: 'var(--text2)' }}>
                💡 This is the <strong>fixed rent for the whole room</strong>. All members in this room share this amount — you don't track who pays what.
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label>Monthly Rent (₹)</label>
                  <input type="number" value={editForm.rent}
                    onChange={e => setEditForm(p => ({ ...p, rent: e.target.value }))}
                    placeholder="e.g. 5000" />
                </div>
                <div className="form-group">
                  <label>Advance (₹)</label>
                  <input type="number" value={editForm.advance}
                    onChange={e => setEditForm(p => ({ ...p, advance: e.target.value }))}
                    placeholder="e.g. 10000" />
                </div>
                <div className="form-group">
                  <label>Max Capacity</label>
                  <select value={editForm.maxCapacity} onChange={e => setEditForm(p => ({ ...p, maxCapacity: e.target.value }))}>
                    {Array.from({length:20},(_,i)=>i+1).map(n => <option key={n} value={n}>{n} member{n>1?'s':''}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Current Status</label>
                  <div style={{ padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6, fontSize: '0.85rem', color: STATUS_STYLE[editRoom.status]?.color }}>
                    {editRoom.memberCount} / {editForm.maxCapacity} members · {STATUS_STYLE[editRoom.status]?.label}
                  </div>
                </div>
                <div className="form-group full">
                  <label>Notes (optional)</label>
                  <input value={editForm.notes}
                    onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))}
                    placeholder="e.g. Ground floor, AC room" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditRoom(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>
                {saving ? 'Saving...' : 'Save Room'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {bulkMode && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setBulkMode(false)}>
          <div className="modal" style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <h3>Edit All Rooms</h3>
              <button className="close-btn" onClick={() => setBulkMode(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background: 'rgba(240,165,0,0.06)', border: '1px solid rgba(240,165,0,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.82rem', color: 'var(--text2)' }}>
                💡 Set the <strong>fixed monthly rent</strong> for each room. Leave as 0 if not applicable.
              </div>
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Room', 'Monthly Rent (₹)', 'Advance (₹)', 'Max Capacity'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bulkData.map(r => (
                      <tr key={r.roomNumber}>
                        <td style={{ padding: '6px 10px', fontFamily: 'Rajdhani', fontWeight: 700, color: 'var(--accent)', fontSize: '1rem' }}>
                          {String(r.roomNumber).padStart(2, '0')}
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <input type="number" value={r.rent}
                            onChange={e => updateBulkRow(r.roomNumber, 'rent', e.target.value)}
                            style={{ width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', color: 'var(--text)', outline: 'none', fontSize: '0.88rem' }}
                            placeholder="0" />
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <input type="number" value={r.advance}
                            onChange={e => updateBulkRow(r.roomNumber, 'advance', e.target.value)}
                            style={{ width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', color: 'var(--text)', outline: 'none', fontSize: '0.88rem' }}
                            placeholder="0" />
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <select value={r.maxCapacity}
                            onChange={e => updateBulkRow(r.roomNumber, 'maxCapacity', parseInt(e.target.value))}
                            style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', color: 'var(--text)', outline: 'none', fontSize: '0.88rem' }}>
                            {Array.from({length:20},(_,i)=>i+1).map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setBulkMode(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveBulk} disabled={saving}>
                {saving ? 'Saving...' : 'Save All Rooms'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
