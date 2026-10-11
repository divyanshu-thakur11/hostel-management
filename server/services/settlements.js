const Settlement = require('../models/Settlement');

const snapshotOf = (m, extra = {}) => ({
  name: m.name, memberId: m.memberId, mobileNo: m.mobileNo, fathersName: m.fathersName,
  roomNumber: m.roomNumber, roomJoinDate: m.roomJoinDate, roomLeavingDate: m.roomLeavingDate,
  rent: m.rent, advance: m.advance,
  ...extra,
});

// Called when a member is vacated: keep (or start) their settlement record with a
// frozen copy of who they were, so their financial record survives the archive.
// Never throws — vacating must not fail because of this.
async function recordVacate({ hostelId, member, reason, user }) {
  try {
    const memberKey = String(member._id);
    const snap = snapshotOf(member, { vacatedOn: new Date(), vacatedReason: reason || 'Left hostel' });
    const entry = {
      at: new Date(), byName: user?.name || user?.username || '', byRole: user?.role || '',
      action: 'vacated', summary: `Member vacated${member.roomNumber ? ` Room ${member.roomNumber}` : ''}. Settlement record kept.`, reason: reason || '', changes: [],
    };
    const existing = await Settlement.findOne({ hostelId, memberKey });
    if (existing) {
      existing.member = { ...(existing.member?.toObject?.() || existing.member || {}), ...snap };
      existing.history.push(entry);
      await existing.save();
    } else {
      await Settlement.create({ hostelId, memberKey, member: snap, status: 'open', items: [], history: [entry] });
    }
  } catch (e) {
    console.error('[SETTLEMENT VACATE ERROR]', e.message);
  }
}

module.exports = { recordVacate, snapshotOf };
