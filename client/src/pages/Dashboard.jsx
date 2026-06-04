import { useHostel } from '../context/HostelContext';
import React, { useEffect, useState, useCallback } from 'react';
import { dashboardAPI, membersAPI } from '../utils/api';
import { whatsapp as wa } from '../utils/api';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

function StatCard({ icon, label, value, color = 'var(--accent)', sub, onClick }) {
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div style={{ width: 48, height: 48, borderRadius: 10, background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>{label}</div>
        <div style={{ fontFamily: 'Rajdhani', fontSize: '1.5rem', fontWeight: 700, color }}>{value}</div>
        {sub && <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { hostelSwitchCount } = useHostel();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showOverdue, setShowOverdue] = useState(false);
  const [showPartPay, setShowPartPay] = useState(false);
  const [showDue, setShowDue] = useState(false);
  const [showExpiring, setShowExpiring] = useState(false);

  const [error, setError] = useState(false);

  const load = useCallback((retrying = false) => {
    setLoading(true);
    setError(false);
    dashboardAPI.get()
      .then(r => { setStats(r.data); setLoading(false); })
      .catch(() => {
        if (!retrying) {
          // Auto-retry once after 2 seconds (handles Render cold start)
          setTimeout(() => load(true), 2000);
        } else {
          setLoading(false);
          setError(true);
        }
      });
  }, [hostelSwitchCount]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ color: 'var(--text2)', padding: 40, textAlign: 'center' }}>⏳ Loading dashboard...</div>;
  if (error || !stats) return (
    <div style={{ color: 'var(--danger)', padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: '2rem', marginBottom: 12 }}>⚠️</div>
      <div style={{ marginBottom: 16 }}>Failed to load dashboard. Check server connection.</div>
      <button className="btn btn-secondary" onClick={() => load()}>🔄 Retry</button>
    </div>
  );

  const maxTrend = Math.max(...(stats.trend || []).map(t => t.amount), 1);
  const occupancyPct = stats.totalRooms > 0 ? Math.round((stats.occupiedRooms / stats.totalRooms) * 100) : 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <button className="btn btn-secondary" onClick={load}>🔄 Refresh</button>
      </div>

      {/* Alert banners */}
      {/* Part Payment Alert Card */}
      {stats.partPaymentCount > 0 && (
        <div style={{ background: 'rgba(155,89,182,0.07)', border: '1px solid rgba(155,89,182,0.3)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', marginBottom: 10 }} onClick={() => setShowPartPay(true)}>
          <span style={{ fontSize: '1.4rem' }}>💳</span>
          <div style={{ flex: 1 }}>
            <strong style={{ color: '#9b59b6' }}>{stats.partPaymentCount} room{stats.partPaymentCount > 1 ? 's' : ''} with outstanding balance</strong>
            <span style={{ color: 'var(--text3)', fontSize: '0.82rem', marginLeft: 8 }}>Total pending: ₹{fmt(stats.totalBalanceDue || 0)}</span>
          </div>
          <span style={{ color: '#9b59b6', fontSize: '0.82rem', fontWeight: 600 }}>View →</span>
        </div>
      )}

            {(stats.overdueCount > 0 || stats.expiringCount > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {stats.overdueCount > 0 && (
            <div style={{ background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setShowOverdue(true)}>
              <span style={{ fontSize: '1.2rem' }}>🚨</span>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--danger)' }}>{stats.overdueCount} overdue member{stats.overdueCount > 1 ? 's' : ''}</strong>
                <span style={{ color: 'var(--text3)', fontSize: '0.82rem', marginLeft: 8 }}>Their stay period has ended. Click to view.</span>
              </div>
            </div>
          )}
          {stats.expiringCount > 0 && (
            <div style={{ background: 'rgba(243,156,18,0.08)', border: '1px solid rgba(243,156,18,0.3)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setShowExpiring(true)}>
              <span style={{ fontSize: '1.2rem' }}>⏰</span>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--accent)' }}>{stats.expiringCount} member{stats.expiringCount > 1 ? 's' : ''} expiring within 7 days</strong>
                <span style={{ color: 'var(--text3)', fontSize: '0.82rem', marginLeft: 8 }}>Click to view and send reminders.</span>
              </div>
            </div>
          )}
          {stats.dueMembersCount > 0 && (
            <div style={{ background: 'rgba(52,152,219,0.06)', border: '1px solid rgba(52,152,219,0.25)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setShowDue(true)}>
              <span style={{ fontSize: '1.2rem' }}>💰</span>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--info)' }}>{stats.dueMembersCount} member{stats.dueMembersCount > 1 ? 's' : ''} haven't paid rent this month</strong>
                <span style={{ color: 'var(--text3)', fontSize: '0.82rem', marginLeft: 8 }}>Estimated due: ₹{fmt(stats.estimatedDue)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Primary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard icon="👥" label="Active Members" value={stats.activeMembers} color="var(--info)" />
        <StatCard icon="🚪" label="Rooms Occupied" value={`${stats.occupiedRooms} / ${stats.totalRooms}`} color="var(--success)" sub={`${stats.vacantRooms} vacant`} />
        <StatCard icon="💰" label="This Month Revenue" value={`₹${fmt(stats.monthRevenue)}`} color="var(--success)" />
        <StatCard icon="📈" label="Total Revenue" value={`₹${fmt(stats.totalRevenue)}`} color="var(--accent)" />
        <StatCard icon="📉" label="Total Expenses" value={`₹${fmt(stats.totalExpenses)}`} color="var(--danger)" />
        <StatCard icon="🏦" label="Net Income" value={`₹${fmt(stats.netIncome)}`} color={stats.netIncome >= 0 ? 'var(--success)' : 'var(--danger)'} />
        <StatCard icon="💵" label="Cash Collected" value={`₹${fmt(stats.cashRevenue)}`} color="var(--text2)" />
        <StatCard icon="📱" label="Online Collected" value={`₹${fmt(stats.onlineRevenue)}`} color="var(--info)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Revenue trend */}
        <div className="card">
          <h3 style={{ fontFamily: 'Rajdhani', fontSize: '0.9rem', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Revenue — Last 6 Months</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
            {(stats.trend || []).map((t, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ fontSize: '0.62rem', color: 'var(--accent)', fontWeight: 600 }}>
                  {t.amount > 0 ? `₹${(t.amount / 1000).toFixed(0)}k` : ''}
                </div>
                <div style={{ width: '100%', height: Math.max(4, (t.amount / maxTrend) * 90), background: i === (stats.trend.length - 1) ? 'var(--accent)' : 'var(--bg3)', borderRadius: '4px 4px 0 0', border: i === (stats.trend.length - 1) ? 'none' : '1px solid var(--border)', transition: 'height 0.3s' }} />
                <div style={{ fontSize: '0.58rem', color: 'var(--text3)', textAlign: 'center', lineHeight: 1.2 }}>{t.month}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Occupancy donut */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <h3 style={{ fontFamily: 'Rajdhani', fontSize: '0.9rem', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.08em', alignSelf: 'flex-start' }}>Occupancy</h3>
          <div style={{ position: 'relative', width: 110, height: 110 }}>
            <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bg3)" strokeWidth="3.5" />
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--accent)" strokeWidth="3.5"
                strokeDasharray={`${occupancyPct} 100`} strokeLinecap="round" />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <div style={{ fontFamily: 'Rajdhani', fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)' }}>{occupancyPct}%</div>
              <div style={{ fontSize: '0.55rem', color: 'var(--text3)' }}>OCCUPIED</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: '0.76rem' }}>
            <span style={{ color: 'var(--accent)' }}>● Occupied: {stats.occupiedRooms}</span>
            <span style={{ color: 'var(--text3)' }}>○ Vacant: {stats.vacantRooms}</span>
          </div>
        </div>
      </div>

      {/* Room Grid */}
      {stats.roomStatus && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontFamily: 'Rajdhani', fontSize: '0.9rem', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Room Status Map</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 6 }}>
            {stats.roomStatus.map(r => (
              <div key={r.roomNumber} style={{
                padding: '8px 4px', borderRadius: 6, textAlign: 'center', fontSize: '0.75rem', fontWeight: 600,
                background: r.status === 'occupied' ? 'rgba(240,165,0,0.15)' : 'var(--bg3)',
                border: `1px solid ${r.status === 'occupied' ? 'rgba(240,165,0,0.35)' : 'var(--border)'}`,
                color: r.status === 'occupied' ? 'var(--accent)' : 'var(--text3)',
              }}>
                <div style={{ fontSize: '0.6rem', opacity: 0.7 }}>R{r.roomNumber}</div>
                <div>{r.status === 'occupied' ? '🟡' : '⚪'}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: '0.72rem', color: 'var(--text3)' }}>
            <span>🟡 Occupied</span><span>⚪ Vacant</span>
          </div>
        </div>
      )}

      {/* Recent Receipts */}
      <div className="card">
        <h3 style={{ fontFamily: 'Rajdhani', fontSize: '0.9rem', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Recent Receipts</h3>
        {!stats.recentReceipts?.length ? (
          <div style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>No receipts yet</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Room</th><th>Member</th><th>Type</th><th>Amount</th><th>Mode</th></tr></thead>
              <tbody>
                {stats.recentReceipts.map(r => (
                  <tr key={r._id}>
                    <td style={{ fontSize: '0.8rem' }}>{r.receiptDate ? new Date(r.receiptDate).toLocaleDateString('en-IN') : '—'}</td>
                    <td><span className="badge badge-blue">R{r.roomNumber}</span></td>
                    <td style={{ color: 'var(--text)', fontWeight: 500 }}>{r.memberName || '—'}</td>
                    <td><span className="badge badge-yellow">{r.packageName || '—'}</span></td>
                    <td style={{ color: 'var(--accent)', fontWeight: 700 }}>₹{fmt(r.totalAmount)}</td>
                    <td><span className={`badge ${r.modeOfPayment === 'online' ? 'badge-blue' : 'badge-green'}`}>{r.modeOfPayment || 'cash'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Overdue Modal */}
      {showOverdue && (
        <Modal title="🚨 Overdue Members" onClose={() => setShowOverdue(false)}>
          {stats.overdueMembers.map(m => (
            <div key={m._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>{m.name}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>Room {m.roomNumber} · Due: {new Date(m.roomLeavingDate).toLocaleDateString('en-IN')}</div>
              </div>
              {m.mobileNo && <button style={{ background: '#25d366', color: 'white', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }} onClick={() => wa.sendReminder(m.mobileNo, m.name, m.roomNumber, m.rent || 0, 'final dues')}>📱 Remind</button>}
            </div>
          ))}
        </Modal>
      )}

      {/* Expiring Modal */}
      {showExpiring && (
        <Modal title="⏰ Expiring Soon" onClose={() => setShowExpiring(false)}>
          {stats.expiringMembers.map(m => (
            <div key={m._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>{m.name}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>Room {m.roomNumber} · Leaves: {new Date(m.roomLeavingDate).toLocaleDateString('en-IN')}</div>
              </div>
              {m.mobileNo && <button style={{ background: '#25d366', color: 'white', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }} onClick={() => wa.sendReminder(m.mobileNo, m.name, m.roomNumber, m.rent || 0, 'stay renewal')}>📱 Remind</button>}
            </div>
          ))}
        </Modal>
      )}

      {/* Due this month Modal */}
      {/* Part Payment Modal */}
      {showPartPay && (
        <Modal title="💳 Outstanding Balances" onClose={() => setShowPartPay(false)}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: 12 }}>
            These rooms have part payments with pending balances. Total due: <strong style={{ color: '#9b59b6' }}>₹{fmt(stats.totalBalanceDue || 0)}</strong>
          </div>
          {(stats.partPaymentReceipts || []).map((r, i) => (
            <div key={i} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>Room {r.roomNumber} — {r.memberName}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text3)', marginTop: 2 }}>
                    Bill: {r.billNumber} · Total: ₹{fmt(r.totalAmount)} · Paid: ₹{fmt(r.amountPaid || 0)}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#9b59b6', fontWeight: 600, marginTop: 2 }}>
                    Balance Due: ₹{fmt(r.balanceDue || 0)}
                  </div>
                </div>
                {r.memberMobile && (
                  <button style={{ background: '#25d366', color: 'white', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, flexShrink: 0 }}
                    onClick={() => wa.sendCustom(r.memberMobile, `🏠 *HOSTEL PAYMENT REMINDER*

Dear ${r.memberName},

You have an outstanding balance of *₹${r.balanceDue}* for Room ${r.roomNumber}.
Bill No: ${r.billNumber}
Total Bill: ₹${r.totalAmount}
Paid: ₹${r.amountPaid || 0}
*Balance Due: ₹${r.balanceDue}*

Please clear this at the earliest.

Thank you 🙏`)}>
                    📱 WhatsApp
                  </button>
                )}
              </div>
            </div>
          ))}
          {(!stats.partPaymentReceipts || stats.partPaymentReceipts.length === 0) && (
            <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 20 }}>No part payment details available</div>
          )}
        </Modal>
      )}

            {showDue && stats.dueMembersCount > 0 && (
        <Modal title="💰 Rent Due This Month" onClose={() => setShowDue(false)}>
          <p style={{ fontSize: '0.82rem', color: 'var(--text3)', marginBottom: 14 }}>These members have no rent receipt recorded for this month.</p>
          {/* We reload due members from stats estimatedDue member list — loaded in dashboard data */}
          <div style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>Total estimated due: <strong style={{ color: 'var(--accent)' }}>₹{fmt(stats.estimatedDue)}</strong></div>
          <div style={{ marginTop: 10, color: 'var(--text3)', fontSize: '0.8rem' }}>Go to Members page → search by room to view individual dues and send WhatsApp reminders.</div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, maxWidth: 480, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontFamily: 'Rajdhani', fontSize: '1.1rem', color: 'var(--text)' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
