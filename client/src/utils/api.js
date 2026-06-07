import axios from 'axios';

const api = axios.create({
  baseURL: '/api',           // always relative — works on Render same-origin
  withCredentials: true,     // send HttpOnly cookie on every request
});

// No token management needed — cookie is HttpOnly, browser handles it.
// For hostel switching: owner sends selected hostelId as x-hostel-id header.
// Server ignores this for managers (locked to their JWT hostelId).
api.interceptors.request.use((config) => {
  const hostelId = localStorage.getItem('hm_hostel_id');
  if (hostelId) config.headers['x-hostel-id'] = hostelId;
  return config;
});

// Handle auth errors and DB errors globally
api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Bypass interceptor if the request was deliberately canceled
    if (axios.isCancel(err)) {
      return Promise.reject(err);
    }

    const status = err.response?.status;

    if (status === 401) {
      localStorage.removeItem('hm_user');
      window.location.href = '/';
    }
    
    // 503 = DB not connected — show user-friendly message safely
    if (status === 503) {
      const dbMessage = err.response?.data?.message || 'Database connection offline';
      console.warn('Server DB not ready:', dbMessage);
    }
    
    return Promise.reject(err);
  }
);

export const authAPI = {
  login:           (data)       => api.post('/auth/login', data),
  logout:          ()           => api.post('/auth/logout'),
  me:              ()           => api.get('/auth/me'),
  changePassword:  (data)       => api.post('/auth/change-password', data),
  getUsers:        ()           => api.get('/auth/users'),
  createUser:      (data)       => api.post('/auth/users', data),
  createManager:   (data)       => api.post('/auth/users', data),
  toggleUser:      (id)         => api.put(`/auth/users/${id}/toggle`),
  deleteUser:      (id)         => api.delete(`/auth/users/${id}`),
  getUserActivity: (id)         => api.get(`/auth/users/${id}/activity`),
  resetPassword:   (id, data)   => api.post(`/auth/users/${id}/reset-password`, data), 
};

export const dashboardAPI = {
  get: (params) => api.get('/dashboard', { params }),
};

export const hostelAPI = {
  getAll:  ()           => api.get('/hostels'),
  create:  (data)       => api.post('/hostels', data),
  update:  (id, data)   => api.put(`/hostels/${id}`, data),
};

export const roomsAPI = {
  getAll:     (params)    => api.get('/rooms', { params }),
  getOne:     (n)         => api.get(`/rooms/${n}`),
  update:     (n, data)   => api.put(`/rooms/${n}`, data),
  updateAll:  (rooms)     => api.put('/rooms', { rooms }),
  create:     (data)      => api.post('/rooms', data),
  deleteRoom: (n)         => api.delete(`/rooms/${n}`),
};

export const membersAPI = {
  getAll:          (params) => api.get('/members', { params }),
  getById:         (id)     => api.get(`/members/${id}`),
  getByRoom:       (n)      => api.get(`/members/room/${n}`),
  getNextId:       ()       => api.get('/members/next-id'),
  create:          (data)   => api.post('/members', data),
  update:          (id, d)  => api.put(`/members/${id}`, d),
  vacate:          (id, r)  => api.post(`/members/${id}/vacate`, { reason: r }),
  delete:          (id)     => api.delete(`/members/${id}`),
  getArchived:     (params) => api.get('/members/archived', { params }),
  restoreArchived: (id)     => api.post(`/members/archived/${id}/restore`),
  deleteArchived:  (id)     => api.delete(`/members/archived/${id}`),
};

export const receiptsAPI = {
  getAll:         (params) => api.get('/receipts', { params }),
  getByRoom:      (n)      => api.get(`/receipts/room/${n}`),
  getRoomSummary: (n)      => api.get(`/receipts/room/${n}/summary`),
  getNextNumbers: ()       => api.get('/receipts/next-numbers'),
  resetSerial:    (yearType) => api.post('/receipts/reset-serial', { yearType }),
  create:         (data)   => api.post('/receipts', data),
  delete:         (id)     => api.delete(`/receipts/${id}`),
  clearDue:       (id)     => api.patch(`/receipts/${id}/clear-due`), 
};

export const electricAPI = {
  getAll:      (params) => api.get('/electric', { params }),
  getByRoom:   (n)      => api.get(`/electric/room/${n}`),
  getLastByRoom:(n)     => api.get(`/electric/room/${n}/last`),
  predict:     (n)      => api.get(`/electric/room/${n}/predict`),
  create:      (data)   => api.post('/electric', data),
  update:      (id, d)  => api.put(`/electric/${id}`, d),
  delete:      (id)     => api.delete(`/electric/${id}`),
};

export const salaryAPI = {
  getAll:  (params) => api.get('/salary', { params }),
  create:  (data)   => api.post('/salary', data),
  update:  (id, d)  => api.put(`/salary/${id}`, d),
  delete:  (id)     => api.delete(`/salary/${id}`),
};

export const notificationsAPI = {
  getAll:        (params) => api.get('/notifications', { params }),
  markRead:      (id)     => api.put(`/notifications/${id}/read`),
  markAllRead:   ()       => api.put('/notifications/read-all'),
  getUnreadCount:()       => api.get('/notifications/unread-count'),
  clearRead:     ()       => api.delete('/notifications/clear-read'),
  clearAll:      ()       => api.delete('/notifications/clear-all'),
  deleteOne:     (id)     => api.delete(`/notifications/${id}`),
};

export const auditAPI = {
  getAll: (params) => api.get('/audit', { params }),
};

export const backupAPI = {
  trigger:  ()  => api.post('/backup/trigger'),
  download: ()  => api.get('/backup/export-json', { responseType: 'blob' }),
  list:     ()  => api.get('/backup/list'),
};

export const syncAPI = {
  sheets: () => api.post('/sync-sheets'),
};

export default api;

// ── WhatsApp Messaging ────────────────────────────────────────────────────────
export const whatsapp = {
  sendReceipt: (mobile, receipt) => {
    const num = `91${String(mobile).replace(/\D/g,'').replace(/^91/,'').slice(-10)}`;
    const date = new Date(receipt.receiptDate).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    const paidAmt = receipt.isPartPayment ? (receipt.amountPaid || 0) : (receipt.totalAmount || 0);
    const PKGl = { rent:'Rent / किराया', advance:'Advance / एडवांस', electric:'Electric / बिजली', final:'Final Bill / अंतिम', other:'Other / अन्य' };
    const typeLabel = PKGl[receipt.packageName] || receipt.packageName || '';
    const modeLabel = receipt.modeOfPayment === 'online' ? 'Online / ऑनलाइन' : 'Cash / नगद';
    const membersList = receipt.members?.length > 0 ? receipt.members.map(m=>m.name).join(', ') : (receipt.memberName || '—');
    const lines = [
      `🏠 *HOSTEL RECEIPT*`, `━━━━━━━━━━━━━━━━━━`,
      `📋 Bill No: *${receipt.billNumber || receipt.receiptNumber || '—'}*`,
      `📅 Date: ${date}`, ``,
      `👤 Name: *${membersList}*`,
      `🚪 Room No: *${receipt.roomNumber || '—'}*`,
      `💳 Type: ${typeLabel}`,
      `💵 Mode: ${modeLabel}`, ``,
    ];
    if (receipt.isPartPayment && (receipt.balanceDue || 0) > 0) {
      lines.push(`📊 Total Bill: ₹${(receipt.totalAmount||0).toLocaleString('en-IN')}`);
      lines.push(`✅ Paid Today: *₹${paidAmt.toLocaleString('en-IN')}*`);
      if (receipt.amountInWords) lines.push(`   (${receipt.amountInWords})`);
      lines.push(`❗ *Balance Due: ₹${(receipt.balanceDue||0).toLocaleString('en-IN')}*`);
    } else {
      lines.push(`💰 *Amount: ₹${paidAmt.toLocaleString('en-IN')}*`);
      if (receipt.amountInWords) lines.push(`   (${receipt.amountInWords})`);
    }
    if (receipt.notes) { lines.push(``); lines.push(`📝 Notes: ${receipt.notes}`); }
    lines.push(``); lines.push(`✅ Payment received. Thank you! 🙏`);
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
  },
  sendFinalBill: (mobile, memberName, roomNo, grandTotal, breakdown) => {
    const num = `91${String(mobile).replace(/\D/g,'').replace(/^91/,'').slice(-10)}`;
    const lines = [
      `🏠 *FINAL BILLING STATEMENT*`, `━━━━━━━━━━━━━━━━━━`,
      `👤 ${memberName}`, `🚪 Room No: ${roomNo}`, ``,
      `📊 *Breakdown:*`,
      breakdown.rent     ? `  Rent:     ₹${breakdown.rent}`     : '',
      breakdown.advance  ? `  Advance:  ₹${breakdown.advance}`  : '',
      breakdown.electric ? `  Electric: ₹${breakdown.electric}` : '',
      breakdown.other    ? `  Other:    ₹${breakdown.other}`    : '',
      ``, `💰 *Grand Total: ₹${grandTotal}*`, ``,
      `Please settle all dues before vacating.`, `Thank you 🙏`,
    ].filter(Boolean).join('\n');
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(lines)}`, '_blank');
  },
  sendReminder: (mobile, name, roomNo, amount, type = 'rent') => {
    const num = `91${String(mobile).replace(/\D/g,'').replace(/^91/,'').slice(-10)}`;
    const today = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' });
    const msg = [
      `🏠 *HOSTEL PAYMENT REMINDER*`, `━━━━━━━━━━━━━━━━━━`,
      `📅 Date: ${today}`, ``,
      `Dear *${name}*,`, ``,
      `This is a friendly reminder that your *${type.toUpperCase()}* payment is pending.`, ``,
      amount ? `💰 Amount Due: *₹${Number(amount).toLocaleString('en-IN')}*` : '',
      `🚪 Room No: *${roomNo}*`, ``,
      `Please clear your dues at the earliest.`, ``,
      `⚠️ Late payment attracts a fine of ₹50/- per day.`, ``,
      `Thank you 🙏`, `— Hostel Management`,
    ].filter(Boolean).join('\n');
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
  },
  sendCustom: (mobile, message) => {
    const num = `91${String(mobile).replace(/\D/g,'').replace(/^91/,'').slice(-10)}`;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(message)}`, '_blank');
  },
};