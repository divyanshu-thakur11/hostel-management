/**
 * HOSTEL MANAGER — Member ID De-duplication Tool
 *
 * Run this ONCE, before (or right after) deploying the update that adds a
 * unique index on Member (hostelId + registrationYear + memberIdNumber).
 *
 * Why: if any two members currently share the same Member ID Number within
 * the same hostel + registration year, MongoDB will refuse to build that
 * unique index — which can leave the index missing (silently, in the
 * background) even though the app itself starts up fine. This script finds
 * any such duplicates and renumbers all but the oldest one to the next free
 * number, so the index can build cleanly.
 *
 * Safe to run any time — if there are no duplicates, it does nothing and
 * just prints "No duplicates found."
 *
 * Usage:
 *   cd server
 *   node migrate-dedupe-member-ids.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/hostel_management';

function line(char = '-', len = 50) { console.log(char.repeat(len)); }

async function main() {
  console.log('');
  line('=');
  console.log('  Member ID De-duplication Tool');
  line('=');
  console.log('');
  console.log('Connecting to database...');

  try {
    await mongoose.connect(MONGODB_URI);
  } catch (e) {
    console.log('❌ Could not connect to the database:', e.message);
    process.exit(1);
  }
  console.log('✅ Connected.\n');

  const Member = mongoose.connection.collection('members');

  // Find groups of members sharing the same (hostelId, registrationYear, memberIdNumber)
  const dupGroups = await Member.aggregate([
    { $match: { memberIdNumber: { $exists: true, $ne: null } } },
    { $group: {
        _id: { hostelId: '$hostelId', registrationYear: '$registrationYear', memberIdNumber: '$memberIdNumber' },
        ids: { $push: '$_id' },
        names: { $push: '$name' },
        createdAts: { $push: '$createdAt' },
        count: { $sum: 1 },
    }},
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  if (dupGroups.length === 0) {
    console.log('✅ No duplicates found — your data is already clean.');
    console.log('   The unique index will build without any issues.\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`⚠ Found ${dupGroups.length} Member ID number(s) shared by more than one member:\n`);

  for (const group of dupGroups) {
    const { hostelId, registrationYear, memberIdNumber } = group._id;
    console.log(`  Member ID ${memberIdNumber} (${registrationYear}) — shared by: ${group.names.join(', ')}`);

    // Keep the OLDEST member (by _id, which is roughly creation order) on the
    // original number; renumber every other member sharing it.
    const sorted = group.ids
      .map((id, i) => ({ id, createdAt: group.createdAts[i], name: group.names[i] }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    const [keep, ...renumber] = sorted;
    console.log(`    → Keeping "${keep.name}" as ${memberIdNumber}`);

    for (const m of renumber) {
      const last = await Member.find({ hostelId, registrationYear })
        .sort({ memberIdNumber: -1 })
        .limit(1)
        .toArray();
      const nextNum = (last[0]?.memberIdNumber || 0) + 1;
      const shortYear = registrationYear;
      const newMemberId = `SS/${shortYear}/${String(nextNum).padStart(3, '0')}`;

      await Member.updateOne(
        { _id: m.id },
        { $set: { memberIdNumber: nextNum, memberId: newMemberId } }
      );
      console.log(`    → Renumbered "${m.name}" to ${nextNum} (${newMemberId})`);
    }
    console.log('');
  }

  console.log('✅ Done — all duplicates resolved. Safe to deploy the unique index now.\n');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => {
  console.log('❌ Unexpected error:', e.message);
  process.exit(1);
});