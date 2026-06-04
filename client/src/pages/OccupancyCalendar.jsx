import React, { useEffect, useState, useMemo } from 'react';
import { membersAPI, roomsAPI } from '../utils/api';
import { useHostel } from '../context/HostelContext';

const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getDaysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDay(year, month)    { return new Date(year, month, 1).getDay(); }
function isSameDay(a, b)             { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

export default function OccupancyCalendar() {
  const { hostelSwitchCount } = useHostel();
  const today    = new Date();
  const [year,   setYear]   = useState(today.getFullYear());
  const [month,  setMonth]  = useState(today.getMonth());
  const [members, setMembers] = useState([]);
  const [rooms,   setRooms]   = useState([]);
  const [selected, setSelected] = useState(null); // selected date
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      membersAPI.getAll({ limit: 1000 }),
      roomsAPI.getAll(),
    ]).then(([m, r]) => {
      setMembers(m.data?.data || m.data || []);
      setRooms(r.data?.data   || r.data || []);
      setLoading(false);
    });
  }, [hostelSwitchCount]);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y-1); } else setMonth(m => m-1); setSelected(null); };
  const nextMonth = () => { if (month===11) { setMonth(0);  setYear(y => y+1); } else setMonth(m => m+1); setSelected(null); };

  // Events per day: joins and leaves
  const eventsByDay = useMemo(() => {
    const map = {};
    members.forEach(m => {
      if (m.roomJoinDate) {
        const d = new Date(m.roomJoinDate);
        if (d.getFullYear()===year && d.getMonth()===month) {
          const k = d.getDate();
          if (!map[k]) map[k] = { joins:[], leaves:[], active:[] };
          map[k].joins.push(m);
        }
      }
      if (m.roomLeavingDate) {
        const d = new Date(m.roomLeavingDate);
        if (d.getFullYear()===year && d.getMonth()===month) {
          const k = d.getDate();
          if (!map[k]) map[k] = { joins:[], leaves:[], active:[] };
          map[k].leaves.push(m);
        }
      }
    });
    return map;
  }, [members, year, month]);

  // Active rooms on a given date
  const activeOnDate = (date) => {
    return members.filter(m => {
      const join  = m.roomJoinDate   ? new Date(m.roomJoinDate)   : null;
      const leave = m.roomLeavingDate? new Date(m.roomLeavingDate): null;
      if (!join) return false;
      const afterJoin  = join  <= date;
      const beforeLeave= !leave || leave >= date;
      return afterJoin && beforeLeave && m.isActive !== false;
    });
  };

  const totalRooms = rooms.length || 20;

  const daysInMonth  = getDaysInMonth(year, month);
  const firstDay     = getFirstDay(year, month);
  const calendarDays = Array.from({ length: firstDay }, () => null).concat(
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
  );
  while (calendarDays.length % 7 !== 0) calendarDays.push(null);

  const selectedDate    = selected ? new Date(year, month, selected) : null;
  const selectedMembers = selectedDate ? activeOnDate(selectedDate) : [];
  const selectedEvents  = selected ? (eventsByDay[selected] || { joins:[], leaves:[] }) : null;

  const getDayColor = (day) => {
    if (!day) return null;
    const d    = new Date(year, month, day);
    const acts = activeOnDate(d);
    const occ  = acts.length;
    const todayDay = isSameDay(d, today);
    if (todayDay) return { bg:'rgba(52,152,219,0.18)', border:'2px solid var(--info)', isToday:true };
    const evts = eventsByDay[day];
    if (evts?.leaves?.length > 0 && evts.joins?.length === 0) return { bg:'rgba(231,76,60,0.12)', border:'1px solid rgba(231,76,60,0.3)' };
    if (evts?.joins?.length  > 0) return { bg:'rgba(46,204,113,0.12)',  border:'1px solid rgba(46,204,113,0.3)' };
    if (occ === 0)                return { bg:'transparent', border:'1px solid var(--border)' };
    const pct = occ / totalRooms;
    if (pct >= 0.8)               return { bg:'rgba(231,76,60,0.07)',   border:'1px solid rgba(231,76,60,0.15)' };
    if (pct >= 0.5)               return { bg:'rgba(240,165,0,0.07)',   border:'1px solid rgba(240,165,0,0.15)' };
    return { bg:'transparent', border:'1px solid var(--border)' };
  };

  if (loading) return <div style={{textAlign:'center',padding:40,color:'var(--text3)'}}>⏳ Loading calendar...</div>;

  // Stats for current month
  const monthJoins  = members.filter(m => { if (!m.roomJoinDate) return false; const d=new Date(m.roomJoinDate); return d.getFullYear()===year&&d.getMonth()===month; }).length;
  const monthLeaves = members.filter(m => { if (!m.roomLeavingDate) return false; const d=new Date(m.roomLeavingDate); return d.getFullYear()===year&&d.getMonth()===month; }).length;
  const todayActive = activeOnDate(today).length;

  return (
    <div>
      <div className="page-header">
        <div><h2>📅 Occupancy Calendar</h2><p>Room joins, leaves, and occupancy at a glance</p></div>
      </div>

      {/* Month stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:16}}>
        {[
          { icon:'👥', label:'Active Today',    value:todayActive,  color:'var(--info)'    },
          { icon:'✅', label:'Joined This Month', value:monthJoins,   color:'var(--success)' },
          { icon:'🚪', label:'Leaving This Month',value:monthLeaves,  color:'var(--danger)'  },
          { icon:'🏠', label:'Total Rooms',      value:totalRooms,   color:'var(--accent)'  },
        ].map((s,i) => (
          <div key={i} className="card" style={{padding:'14px 16px',display:'flex',alignItems:'center',gap:12}}>
            <span style={{fontSize:'1.5rem'}}>{s.icon}</span>
            <div>
              <div style={{fontFamily:'Rajdhani',fontWeight:700,fontSize:'1.4rem',color:s.color,lineHeight:1}}>{s.value}</div>
              <div style={{fontSize:'0.72rem',color:'var(--text3)',marginTop:2}}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:16,alignItems:'start'}}>
        {/* Calendar */}
        <div className="card">
          {/* Nav */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:18}}>
            <button onClick={prevMonth} className="btn btn-secondary btn-sm">‹ Prev</button>
            <div style={{fontFamily:'Rajdhani',fontWeight:700,fontSize:'1.2rem',color:'var(--text)',textAlign:'center'}}>
              {MONTHS[month]} {year}
            </div>
            <button onClick={nextMonth} className="btn btn-secondary btn-sm">Next ›</button>
          </div>

          {/* Weekday headers */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:6}}>
            {DAYS.map(d => (
              <div key={d} style={{textAlign:'center',fontSize:'0.7rem',color:'var(--text3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',padding:'4px 0'}}>
                {d}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>
            {calendarDays.map((day, idx) => {
              if (!day) return <div key={idx} />;
              const style  = getDayColor(day) || {};
              const evts   = eventsByDay[day];
              const isSelected = selected === day;
              return (
                <div key={idx} onClick={() => setSelected(isSelected ? null : day)}
                  style={{
                    padding:'8px 4px', borderRadius:8, cursor:'pointer', textAlign:'center',
                    background: isSelected ? 'rgba(240,165,0,0.2)' : style.bg,
                    border: isSelected ? '2px solid var(--accent)' : style.border,
                    minHeight:56, position:'relative', transition:'all 0.12s',
                  }}>
                  <div style={{fontSize:'0.85rem',fontWeight:style.isToday?700:400,color:style.isToday?'var(--info)':isSelected?'var(--accent)':'var(--text)',marginBottom:4}}>
                    {day}
                  </div>
                  <div style={{display:'flex',gap:2,justifyContent:'center',flexWrap:'wrap'}}>
                    {evts?.joins?.length  > 0 && <span title={`${evts.joins.length} joined`}  style={{width:6,height:6,borderRadius:'50%',background:'var(--success)',display:'inline-block'}} />}
                    {evts?.leaves?.length > 0 && <span title={`${evts.leaves.length} leaving`} style={{width:6,height:6,borderRadius:'50%',background:'var(--danger)',display:'inline-block'}} />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div style={{display:'flex',gap:16,marginTop:14,flexWrap:'wrap',fontSize:'0.72rem',color:'var(--text3)'}}>
            {[
              { color:'var(--success)', label:'Join date' },
              { color:'var(--danger)',  label:'Leave date' },
              { color:'var(--info)',    label:'Today' },
              { color:'var(--accent)', label:'Selected' },
            ].map((l,i) => (
              <span key={i} style={{display:'flex',alignItems:'center',gap:5}}>
                <span style={{width:8,height:8,borderRadius:'50%',background:l.color,display:'inline-block'}} />
                {l.label}
              </span>
            ))}
          </div>
        </div>

        {/* Side panel */}
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {selected ? (
            <>
              <div className="card" style={{borderColor:'rgba(240,165,0,0.3)'}}>
                <div style={{fontFamily:'Rajdhani',fontWeight:700,fontSize:'1rem',marginBottom:10,color:'var(--accent)'}}>
                  📅 {selected} {MONTHS[month]} {year}
                </div>
                {selectedEvents?.joins?.length > 0 && (
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:'0.72rem',color:'var(--success)',fontWeight:700,textTransform:'uppercase',marginBottom:5}}>✅ Joined ({selectedEvents.joins.length})</div>
                    {selectedEvents.joins.map(m => (
                      <div key={m._id} style={{fontSize:'0.82rem',color:'var(--text2)',padding:'3px 0',borderBottom:'1px dashed var(--border)'}}>
                        {m.name} <span style={{color:'var(--text3)'}}>· Room {m.roomNumber}</span>
                      </div>
                    ))}
                  </div>
                )}
                {selectedEvents?.leaves?.length > 0 && (
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:'0.72rem',color:'var(--danger)',fontWeight:700,textTransform:'uppercase',marginBottom:5}}>🚪 Leaving ({selectedEvents.leaves.length})</div>
                    {selectedEvents.leaves.map(m => (
                      <div key={m._id} style={{fontSize:'0.82rem',color:'var(--text2)',padding:'3px 0',borderBottom:'1px dashed var(--border)'}}>
                        {m.name} <span style={{color:'var(--text3)'}}>· Room {m.roomNumber}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!selectedEvents?.joins?.length && !selectedEvents?.leaves?.length && (
                  <div style={{fontSize:'0.82rem',color:'var(--text3)'}}>No joins or leaves this day</div>
                )}
              </div>

              <div className="card">
                <div style={{fontFamily:'Rajdhani',fontWeight:700,fontSize:'1rem',marginBottom:10}}>
                  👥 Active Members ({selectedMembers.length})
                </div>
                {selectedMembers.length === 0 ? (
                  <div style={{fontSize:'0.82rem',color:'var(--text3)'}}>No active members</div>
                ) : (
                  <div style={{maxHeight:280,overflowY:'auto'}}>
                    {selectedMembers.map(m => (
                      <div key={m._id} style={{display:'flex',justifyContent:'space-between',fontSize:'0.82rem',padding:'5px 0',borderBottom:'1px dashed var(--border)'}}>
                        <span style={{color:'var(--text2)'}}>{m.name}</span>
                        <span className="badge badge-blue">R{m.roomNumber}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="card" style={{textAlign:'center',padding:'28px 16px'}}>
              <div style={{fontSize:'2rem',marginBottom:8}}>📅</div>
              <div style={{color:'var(--text3)',fontSize:'0.82rem'}}>Click any date to see<br/>members active that day</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
